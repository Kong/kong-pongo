-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local rep = string.rep
local fmt = string.format


-- copy from kong/clustering/services/sync/strategies/postgres.lua
-- version string should look like: "v02_0000"
local VER_PREFIX = "v02_"
local VERSION_FMT = VER_PREFIX .. "%028x"


local RpcSyncV2CoalescingDeltaTestHandler = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function RpcSyncV2CoalescingDeltaTestHandler:init_worker()
  local worker_events = assert(kong.worker_events)

  -- if rpc is ready we will send test calls
  -- cp's version now is "v02_00000"
  worker_events.register(function(capabilities_list)
    local node_id = "control_plane"
    local method = "kong.sync.v2.get_delta"

    -- dp's version is 0
    local msg = { default = { version = "v02_" .. rep("0", 28), }, }
    local res, err = kong.rpc:call(node_id, method, msg)

    assert(type(res) == "table")
    if #res.default.deltas == 2 then
      -- POST and DELETE -> POST and DELETE
      assert(res.default.deltas[1].pk.id == res.default.deltas[2].pk.id)
      assert(res.default.latest_version == fmt(VERSION_FMT, 2))
      assert(type(res.default.deltas[1].entity) == "table")
      -- ngx.null is DELETE
      assert(res.default.deltas[2].entity == ngx.null)
    elseif #res.default.deltas == 1 then
      -- POST and PUT -> PUT
      assert(type(res.default.deltas[1].entity) == "table")
      assert(res.default.latest_version == fmt(VERSION_FMT, 2))
    else
      -- shall not be here
      assert(false)
    end
    assert(res.default.full_sync == false)
    assert(not err)

    ngx.log(ngx.DEBUG, "kong.sync.v2.get_delta ok")

  end, "clustering:jsonrpc", "connected")
end


return RpcSyncV2CoalescingDeltaTestHandler
