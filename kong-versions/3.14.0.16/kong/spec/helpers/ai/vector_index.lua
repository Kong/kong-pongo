-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Observing the vector search indexes an AI plugin instance owns. FT commands
-- are issued the way the plugins issue them, see
-- kong/llm/vectordb/strategies/redis/base.lua.

local redis = require "resty.redis"
-- required modules get the plain Lua `assert`, not the luassert table busted
-- installs for spec files, so the assertion API has to be pulled in by name
local assert = require "luassert"

local WAIT_TIMEOUT = 20
local CONNECT_TIMEOUT = 2000


local _M = {}


-- Both env vars are exported by scripts/dependency_services and by CI, so the
-- literals below only apply to a hand-started stock redis endpoint.
_M.host = os.getenv("KONG_SPEC_TEST_REDIS_STACK_HOST") or "127.0.0.1"
_M.port = tonumber(os.getenv("KONG_SPEC_TEST_REDIS_STACK_PORT") or 6379)


-- Returns nil instead of raising: callers poll, and assert.eventually aborts on
-- a raised error rather than retrying it.
function _M.connect()
  local red = redis:new()
  red:set_timeout(CONNECT_TIMEOUT)

  if not red:connect(_M.host, _M.port) then
    return nil
  end

  return red
end


-- Index names of one plugin instance, one per namespace suffix.
function _M.names(prefix, plugin_id, suffixes)
  local names = {}

  for i, suffix in ipairs(suffixes) do
    names[i] = prefix .. plugin_id .. ":" .. suffix
  end

  return names
end


-- The set of indexes the vector database currently holds, or nil when it could
-- not be reached or answered with something other than the expected table.
function _M.live()
  local red = _M.connect()
  if not red then
    return nil
  end

  local res = red["FT._LIST"](red)
  red:close()

  if type(res) ~= "table" then
    return nil
  end

  local set = {}
  for _, name in ipairs(res) do
    set[name] = true
  end

  return set
end


-- Waits until every name is present, or until every name is absent. A vector
-- database that cannot be listed yet counts as "not ready", so that it is
-- retried instead of failing the spec on the first hiccup.
function _M.wait_for(names, present, description)
  assert.eventually(function()
    local live = _M.live()
    if not live then
      return false
    end

    for _, name in ipairs(names) do
      if (live[name] or false) ~= present then
        return false
      end
    end

    return true
  end)
  .with_timeout(WAIT_TIMEOUT)
  .is_truthy(("%s should be %s"):format(description,
                                        present and "present" or "absent"))
end


-- How many times the server executed a command, from INFO commandstats.
--
-- Returns 0 when the command never ran, so the reading fails open: callers MUST
-- pair a "did not happen" assertion with a positive control that some other FT
-- command's count did rise, otherwise a purge that never reached the vector
-- database at all would satisfy the assertion.
function _M.command_calls(command)
  local red = assert(_M.connect(), "vector database is unreachable")

  local res, err = red["INFO"](red, "commandstats")
  red:close()

  assert.is_nil(err, "could not read commandstats")

  return tonumber(res:match("cmdstat_" .. command:gsub("%.", "%%.") .. ":calls=(%d+)")) or 0
end


-- Drops the given indexes and their records, ignoring the ones already gone.
-- Specs must clean up after themselves: leaked indexes eventually wedge a
-- backend that caps how many may exist, which is what these specs cover.
function _M.drop(names)
  local red = _M.connect()
  if not red then
    return
  end

  for _, name in ipairs(names) do
    red["FT.DROPINDEX"](red, name, "DD")
  end

  red:close()
end


return _M
