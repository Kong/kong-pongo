-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local RpcHelloTestHandler = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function RpcHelloTestHandler:init_worker()
  kong.rpc.callbacks:register("kong.test.hello", function(node_id, greeting)
    return "hello ".. greeting
  end)
end


function RpcHelloTestHandler:access()
  local greeting = kong.request.get_headers()["x-greeting"]
  if not greeting then
    kong.response.exit(400, "Greeting header is required")
  end

  local res, err = kong.rpc:call("control_plane", "kong.test.hello", greeting)
  if not res then
    return kong.response.exit(500, err)
  end

  return kong.response.exit(200, res)
end


return RpcHelloTestHandler
