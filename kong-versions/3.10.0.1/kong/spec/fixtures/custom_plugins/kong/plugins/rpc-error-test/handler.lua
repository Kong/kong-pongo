-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local cjson = require("cjson")


local RpcErrorTestHandler = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function RpcErrorTestHandler:init_worker()
  kong.rpc.callbacks:register("kong.test.exception", function(node_id)
    return nil  -- no error message, default jsonrpc.SERVER_ERROR
  end)

  kong.rpc.callbacks:register("kong.test.error", function(node_id)
    return nil, "kong.test.error"
  end)

  -- XXX EE [[
  -- this rpc method will throw an error
  kong.rpc.callbacks:register("kong.test.xpcall", function(node_id)
    error("should be caught by xpcall")
  end)
  -- XXX EE ]]

  local worker_events = assert(kong.worker_events)
  local node_id = "control_plane"

  -- if rpc is ready we will start to call
  worker_events.register(function(capabilities_list)
    local res, err = kong.rpc:call(node_id, "kong.test.not_exist")
    assert(not res)
    assert(err == "Method not found")

    local res, err = kong.rpc:call(node_id, "kong.test.exception")
    assert(not res)
    assert(err == "Server error")

    local res, err = kong.rpc:call(node_id, "kong.test.error")
    assert(not res)
    assert(err == "kong.test.error")

    -- XXX EE [[
    -- rpc error should be caught and return to caller
    local res, err = kong.rpc:call(node_id, "kong.test.xpcall")
    assert(not res)
    assert(string.find(err, "should be caught by xpcall", nil, true))
    -- XXX EE ]]

    ngx.log(ngx.DEBUG, "test #1 ok")

  end, "clustering:jsonrpc", "connected")

  -- if rpc is ready we will start to send raw msg
  worker_events.register(function(capabilities_list)
    local s = next(kong.rpc.clients[node_id])

    -- send an empty array
    local msg = setmetatable({}, cjson.array_mt)
    assert(s:push_request(msg))

    -- send an invalid msg
    local msg = setmetatable({"invalid_request"}, cjson.array_mt)
    assert(s:push_request(msg))

    ngx.log(ngx.DEBUG, "test #2 ok")

  end, "clustering:jsonrpc", "connected")

end


return RpcErrorTestHandler
