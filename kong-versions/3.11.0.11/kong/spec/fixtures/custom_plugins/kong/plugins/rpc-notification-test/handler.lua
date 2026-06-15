-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local RpcNotificationTestHandler = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function RpcNotificationTestHandler:init_worker()
  kong.rpc.callbacks:register("kong.test.notification", function(node_id, msg)
    ngx.log(ngx.DEBUG, "notification is ", msg)

    local role = kong.configuration.role

    -- cp notify dp back
    if role == "control_plane" then
      local res, err = kong.rpc:notify(node_id, "kong.test.notification", "world")
      assert(res == true)
      assert(err == nil)

      local res, err = kong.rpc:notify(node_id, "kong.test.not_exists_in_dp")
      assert(res == true)
      assert(err == nil)
    end

    -- perr should not get this by notification
    return role
  end)

  local worker_events = assert(kong.worker_events)

  -- if rpc is ready we will start to notify
  worker_events.register(function(capabilities_list)
    -- dp notify cp
    local res, err = kong.rpc:notify("control_plane", "kong.test.notification", "hello")

    assert(res == true)
    assert(err == nil)

    local res, err = kong.rpc:notify("control_plane", "kong.test.not_exists_in_cp")
    assert(res == true)
    assert(err == nil)

  end, "clustering:jsonrpc", "connected")
end


return RpcNotificationTestHandler
