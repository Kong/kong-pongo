-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

return {
  ["/rpc-hello-test"] = {
    resource = "rpc-hello-test",

    GET = function()
      local headers = kong.request.get_headers()
      local greeting = headers["x-greeting"]
      local node_id = headers["x-node-id"]
      if not greeting or not node_id then
        kong.response.exit(400, "Greeting header is required")
      end
    
      local res, err = kong.rpc:call(node_id, "kong.test.hello", greeting)
      if not res then
        return kong.response.exit(500, err)
      end
    
      return kong.response.exit(200, res)
    end
  },
}