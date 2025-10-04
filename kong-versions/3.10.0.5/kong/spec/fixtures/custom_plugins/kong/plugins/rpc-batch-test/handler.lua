-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local RpcBatchTestHandler = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function RpcBatchTestHandler:init_worker()
  kong.rpc.callbacks:register("kong.test.batch", function(node_id, greeting)
    ngx.log(ngx.DEBUG, "kong.test.batch called: ", greeting)
    return "hello ".. greeting
  end)

  local worker_events = assert(kong.worker_events)

  -- if rpc is ready we will start to batch call
  worker_events.register(function(capabilities_list)
    kong.rpc:__set_batch(1)

    local res = assert(kong.rpc:call("control_plane", "kong.test.batch", "world"))

    ngx.log(ngx.DEBUG, "kong.test.batch called: ", res)

    kong.rpc:__set_batch(2)
    assert(kong.rpc:notify("control_plane", "kong.test.batch", "kong"))
    assert(kong.rpc:notify("control_plane", "kong.test.batch", "gateway"))

    ngx.log(ngx.DEBUG, "kong.test.batch ok")
  end, "clustering:jsonrpc", "connected")
end


return RpcBatchTestHandler
