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


-- Connect over an ngx.thread light thread instead of the stock ngx.timer path.
-- connect() parks in socket:join() for the whole connection life; under busted
-- Kong caps the timer-ng pool at 32 threads (globalpatches.lua), so only 32 mock
-- DPs could ever stay connected in one worker. Light threads lift that wall.
-- Overriding try_connect also keeps reconnects (connect() calls it) off timers.
local function dp_try_connect(rpc_mgr, reconnection_delay)
  rpc_mgr._connect_threads = rpc_mgr._connect_threads or {}
  local co = ngx.thread.spawn(function()
    if reconnection_delay and reconnection_delay > 0 then
      ngx.sleep(reconnection_delay)
    end
    -- A reconnect can fire during teardown, after the worker starts exiting and
    -- the `kong` global is gone; pcall keeps that from logging a thread abort.
    if ngx.worker.exiting() then
      return
    end
    local ok, err = pcall(rpc_mgr.connect, rpc_mgr,
          false,
          "control_plane",
          rpc_mgr.conf.cluster_control_plane,
          "/v2/outlet",
          rpc_mgr.cluster_cert.cdata,
          rpc_mgr.cluster_cert_key)
    -- Log a real connect failure. Without this the pcall hides everything but
    -- the worker-exiting case, so a genuine error looks like a plain downstream
    -- connect timeout.
    if not ok and not ngx.worker.exiting() then
      ngx.log(ngx.WARN, "[rpc_mock] mock DP connect failed: ", err)
    end
  end)
  rpc_mgr._connect_threads[#rpc_mgr._connect_threads + 1] = co
end


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

  -- reap the connect light threads spawned by dp_try_connect
  for _, co in ipairs(rpc_mgr._connect_threads or {}) do
    pcall(ngx.thread.kill, co)
  end
  rpc_mgr._connect_threads = nil
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

  -- Connect over ngx.thread instead of ngx.timer only when the caller asks. The
  -- stock timer path caps at 32 threads under busted (globalpatches.lua), so a
  -- fleet larger than 32 needs the light-thread path (see dp_try_connect).
  -- Single-DP specs leave it off and keep the stock timer reconnect scheduling.
  -- Override before wiring `start`.
  if opts.thread_connect then
    ret.try_connect = dp_try_connect
  end

  ret.stop = dp_stop
  ret.is_connected = dp_is_connected
  ret.start = ret.try_connect
  ret.wait_until_connected = dp_wait_until_connected
  ret.do_sync = do_sync

  return ret
end


return _M
