-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local RpcCallAllTestHandler = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function RpcCallAllTestHandler:init_worker()
  kong.rpc.callbacks:register("kong.test.call_all", function(node_id, msg)
    ngx.log(ngx.INFO, node_id, ":dp:kong.test.call_all called: ", msg)
    return "world"
  end)

  local node_table = {}

  kong.rpc.callbacks:register("kong.test.notify_new_version", function(node_id)
    local method = "kong.test.call_all"

    table.insert(node_table, node_id)
    if #node_table < 2 then
      -- skip until all DPs have been called?
      return true
    end

    local res = kong.rpc:call("all", method, "call,")
    assert(2 == res.count)
    assert(0 == res.failures)
    assert("world" == res.results[1].result)
    assert("world" == res.results[2].result)
    ngx.log(ngx.INFO, "kong.test.call_all call ok")

    local res = kong.rpc:notify("all", method, "notify,")
    assert(2 == res.count)
    assert(0 == res.failures)
    assert(true == res.results[1].result)
    assert(true == res.results[2].result)
    ngx.log(ngx.INFO, "kong.test.call_all notify ok")
    return true
  end)

  local worker_events = assert(kong.worker_events)
  -- if rpc is ready we will send test calls
  worker_events.register(function(capabilities_list)
    -- trigger cp's test
    ngx.log(ngx.DEBUG, "dp:kong.test.notify_new_version")
    local res, err = kong.rpc:call("control_plane", "kong.test.notify_new_version")
    assert(res == true)
    assert(not err)

    ngx.log(ngx.INFO, "kong.test.notify_new_version ok")

  end, "clustering:jsonrpc", "connected")
end


return RpcCallAllTestHandler
