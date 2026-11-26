-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--- Helpers for specs that rotate a Redis password stored as a vault reference.
--
-- The helper creates an ACL user on every master of the test Redis Cluster. It also
-- registers a vault whose secrets are a Lua table, so a spec can rotate the secret
-- the way a secrets manager does, and can count the reads.
--
-- Usage:
--   local rotation = require "spec-ee.helpers.redis_rotation"
--   local ctx
--   lazy_setup(function() ctx = rotation.new() end)
--   lazy_teardown(function() ctx:teardown() end)
--
--   local account = ctx:new_account()
--   -- build a plugin or strategy config from account.username, account.password, account.references
--   account:rotate()
--   luassert.equal(1, ctx:reads_since(mark))

local ee_helpers = require "spec-ee.helpers"
local luassert = require "luassert"
local redis = require "resty.redis"
local utils = require "kong.tools.utils"

local fmt = string.format
local find = string.find
local match = string.match


local _M = {}
local ctx_mt = { __index = _M }
local account_mt = { __index = {} }


-- Redis does not copy ACL rules to the other nodes, and the masters can change after a
-- failover. Ask the cluster for its nodes instead of assuming which ones they are.
--
-- The library authenticates against the first seed node, and it does not try the next seed
-- when AUTH fails. The ACL user must exist on every node, because a failover can move the
-- seed to a former replica.
local function find_nodes()
  local cluster_nodes

  -- A node can be down after a failover, so ask the next one.
  for _, contact in ipairs(ee_helpers.redis_cluster_nodes) do
    local red = assert(redis.new())
    red:set_timeouts(2000, 2000, 2000)

    if red:connect(contact.ip, contact.port) then
      cluster_nodes = red:cluster("nodes")
      red:close()

      if cluster_nodes then
        break
      end
    end
  end

  assert(cluster_nodes, "no node of the Redis Cluster answers")

  local masters, nodes = {}, {}
  for line in cluster_nodes:gmatch("[^\n]+") do
    -- <id> <ip>:<port>@<cport>[,<hostname>] <flags> <master-id> ...
    local address, flags = match(line, "^%S+ (%S+) (%S+)")
    if address and not find(flags, "fail", 1, true) then
      local host, port = match(address, "^([^:]+):(%d+)")
      local hostname = match(address, ",([^,]+)$")
      local node = { ip = hostname or host, port = tonumber(port) }

      nodes[#nodes + 1] = node

      if find(flags, "master", 1, true) then
        masters[#masters + 1] = node
      end
    end
  end

  assert(#masters > 0, "the Redis Cluster has no master")

  return masters, nodes
end


--- Register the vault and initialize the PDK. Call it from `lazy_setup()`.
-- `opts.masters` lists the servers that get the ACL rules, for a test with a standalone
-- Redis. Without it, the helper asks the Redis Cluster for its nodes.
function _M.new(opts)
  opts = opts or {}

  local masters, nodes
  if opts.masters then
    masters, nodes = opts.masters, opts.masters
  else
    masters, nodes = find_nodes()
  end

  local self = setmetatable({
    vault_name = opts.vault_name or "rotation",
    secrets = {},
    reads = 0,
    users = {},
    masters = masters,
    -- Every node gets the ACL user, because the library authenticates against a seed node.
    nodes = nodes,
    pool_n = 0,
    saved_kong = _G.kong,
  }, ctx_mt)

  -- `kong.vault` loads a strategy with `require "kong.vaults.<name>"`.
  package.loaded["kong.vaults." .. self.vault_name] = {
    VERSION = "1.0.0",
    init = function() end,
    get = function(_, resource)
      self.reads = self.reads + 1
      return self.secrets[resource]
    end,
  }

  package.loaded["kong.vaults." .. self.vault_name .. ".schema"] = {
    name = self.vault_name,
    fields = { { config = { type = "record", fields = {} } } },
  }

  local kong_global = require "kong.global"
  _G.kong = kong_global.new()
  kong_global.init_pdk(_G.kong, { loaded_vaults = { [self.vault_name] = true } })

  return self
end


function _M:each_master(fn)
  for _, node in ipairs(self.masters) do
    local red = assert(redis.new())
    red:set_timeouts(2000, 2000, 2000)
    assert(red:connect(node.ip, node.port))

    local ok, err = fn(red, node)

    red:close()

    assert(ok, err)
  end
end


function _M:acl(...)
  local args = { ... }

  for _, node in ipairs(self.nodes) do
    local red = assert(redis.new())
    red:set_timeouts(2000, 2000, 2000)
    assert(red:connect(node.ip, node.port))

    local ok, err = red:acl(unpack(args))

    red:close()

    assert(ok, err)
  end
end


--- The number of vault reads so far. Take a mark before the step you measure.
function _M:mark()
  return self.reads
end


function _M:reads_since(mark)
  return self.reads - mark
end


--- A pool name that no connection uses yet. Pooled connections skip AUTH, so a spec
-- that wants the next call to authenticate again gives the client a new pool.
function _M:new_pool()
  self.pool_n = self.pool_n + 1

  return fmt("rotation-pool-%s-%d", utils.uuid(), self.pool_n)
end


--- Add a secret to the vault. Returns its resource name and its reference.
function _M:new_secret(value)
  local resource = "secret-" .. utils.uuid()

  self.secrets[resource] = value

  local reference = fmt("{vault://%s/%s}", self.vault_name, resource)

  -- Warm the secrets cache, as the loading of a plugin configuration does.
  luassert.equal(value, _G.kong.vault.get(reference))

  return resource, reference
end


--- Create an ACL user on every master. The secret holds its password.
function _M:new_account()
  local username = "rotation-" .. utils.uuid()
  local resource = "password-" .. utils.uuid()
  local password = "pw-1-" .. utils.uuid()

  self.secrets[resource] = password
  self.users[username] = true

  self:acl("setuser", username, "on", "~*", "+@all", ">" .. password)

  local reference = fmt("{vault://%s/%s}", self.vault_name, resource)

  -- Warm the secrets cache, as the loading of a plugin configuration does.
  luassert.equal(password, _G.kong.vault.get(reference))

  return setmetatable({
    ctx = self,
    username = username,
    resource = resource,
    password = password,
    -- The shape of a Kong plugin configuration: the resolved value, and the reference in `$refs`.
    references = { password = reference },
  }, account_mt)
end


--- Change the password on every master and in the vault. Returns the new password.
function account_mt.__index.rotate(account)
  local ctx = account.ctx
  local password = "pw-" .. utils.uuid()

  ctx:acl("setuser", account.username, "resetpass", ">" .. password)
  ctx.secrets[account.resource] = password
  account.password = password

  return password
end


--- Change the password on every master only. The vault keeps the old value, as it does
-- when a secrets manager has not caught up yet.
function account_mt.__index.rotate_redis_only(account)
  local password = "pw-" .. utils.uuid()

  account.ctx:acl("setuser", account.username, "resetpass", ">" .. password)

  return password
end


--- Delete the ACL users and reset the PDK. Call it from `lazy_teardown()`.
function _M:teardown()
  -- One missing user must not stop the cleanup of the other users and nodes.
  for username in pairs(self.users) do
    for _, node in ipairs(self.nodes) do
      local red = redis.new()
      if red then
        red:set_timeouts(2000, 2000, 2000)
        if red:connect(node.ip, node.port) then
          pcall(red.acl, red, "deluser", username)
        end
        red:close()
      end
    end
  end

  package.loaded["kong.vaults." .. self.vault_name] = nil
  package.loaded["kong.vaults." .. self.vault_name .. ".schema"] = nil

  _G.kong = self.saved_kong
end


return _M
