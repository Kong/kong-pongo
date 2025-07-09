-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--- Mocked data plane for testing the control plane.
-- @module spec.helpers.rpc_mock.dp

local helpers = require "spec.helpers"
local rpc_mgr = require("kong.clustering.rpc.manager")
local default_cert = require("spec.helpers.rpc_mock.default").default_cert
local uuid = require("kong.tools.uuid")
local isempty = require("table.isempty")
local constants = require("kong.constants")


local DECLARATIVE_EMPTY_CONFIG_HASH = constants.DECLARATIVE_EMPTY_CONFIG_HASH


local _M = {}


local default_dp_conf = {
  role = "data_plane",
  cluster_control_plane = "localhost:8005",
}

setmetatable(default_dp_conf, { __index = default_cert })
local default_meta = { __index = default_dp_conf, }


local function do_nothing() end


--- Stop the mocked data plane.
-- @function dp:stop
-- @treturn nil
local function dp_stop(rpc_mgr)
  -- a hacky way to stop rpc_mgr from reconnecting
  rpc_mgr.try_connect = do_nothing

  -- this will stop all connections
  for _, socket in pairs(rpc_mgr.clients) do
    for conn in pairs(socket) do
      pcall(conn.stop, conn)
    end
  end
end


--- Check if the mocked data plane is connected to the control plane.
-- @function dp:is_connected
-- @treturn boolean if the mocked data plane is connected to the control plane.
local function dp_is_connected(rpc_mgr)
  for _, socket in pairs(rpc_mgr.clients) do
    if not isempty(socket) then
      return true
    end
  end
  return false
end


--- Wait until the mocked data plane is connected to the control plane.
-- @function dp:wait_until_connected
-- @tparam number timeout The timeout in seconds. Throws If the timeout is reached.
local function dp_wait_until_connected(rpc_mgr, timeout)
  return helpers.wait_until(function()
    return rpc_mgr:is_connected()
  end, timeout or 15)
end


local function parse_service(payload, result)
  result = result or {}
  result.pk = result.pk or {}

  if #payload.deltas == 0 then
    return result
  end

  for _, entity in ipairs(payload.deltas) do
    if entity.type == "services" then
      if entity.entity ~= nil and entity.entity ~= ngx.null then
        local name = entity.entity.name
        result[name] = result[name] or 0
        result[name] = result[name] + 1
        result.pk[entity.entity.id] = name

      else
        local name = result.pk[entity.pk.id]
        result.pk[entity.pk.id] = nil
        if name then
          result[name] = nil
        end
      end
    end
  end
  return result, payload.deltas[#payload.deltas].version
end


local function do_sync(self, page_size, result, step, next_token, version)
  local result = result or {}
  local res, err
  local previous_page_size = 0
  local page_n = 0
  repeat
    assert(previous_page_size <= page_size, previous_page_size)
    res, err = self:call("control_plane", "kong.sync.v2.get_delta",
      { default = {
        version = version or DECLARATIVE_EMPTY_CONFIG_HASH,
        next = next_token
      },}
    )
    assert(res, err)

    local payload = res.default
    next_token = payload.next
    result, version = parse_service(payload, result)

    -- we do not check the last 1 page's size
    -- as fixups may be larger
    previous_page_size = #payload.deltas
    page_n = page_n + 1
  until next_token == nil or step

  if step then
    return result, next_token, version
  else
    return result, page_n, version
  end

end


--- Start to connect the mocked data plane to the control plane.
-- @function dp:start
-- @treturn boolean if the mocked data plane is connected to the control plane.


-- TODO: let client not emits logs as it's expected when first connecting to CP
-- and when CP disconnects
function _M.new(opts)
  opts = opts or {}
  setmetatable(opts, default_meta)
  local ret = rpc_mgr.new(default_dp_conf, opts.name or uuid.uuid())

  ret.stop = dp_stop
  ret.is_connected = dp_is_connected
  ret.start = ret.try_connect
  ret.wait_until_connected = dp_wait_until_connected
  ret.do_sync = do_sync

  return ret
end


return _M
