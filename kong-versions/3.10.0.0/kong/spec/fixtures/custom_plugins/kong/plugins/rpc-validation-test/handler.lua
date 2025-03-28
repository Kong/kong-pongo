-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local fmt = string.format


local RpcSyncV2ValidationHandler = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function RpcSyncV2ValidationHandler:init_worker()
  -- mock function on cp side
  kong.rpc.callbacks:register("kong.sync.v2.get_delta", function(node_id, current_versions)
    local latest_version = fmt("v02_%028x", 10)

    local fake_uuid = "00000000-0000-0000-0000-111111111111"

    -- a basic config data,
    -- it has no field "name",
    -- and will cause validation error
    local deltas = {
      {
        entity = {
          id = fake_uuid,
          meta = "wrong", -- should be a record,
          config = 100, -- should be a record,
        },
        type = "workspaces",
        version = latest_version,
        ws_id = fake_uuid,
      },
      {
        entity = {
          key = 100, -- should be a string
          value = {}, -- should be a string
        },
        type = "parameters",
        version = latest_version,
        ws_id = fake_uuid,
      },
    }

    ngx.log(ngx.DEBUG, "kong.sync.v2.get_delta ok")

    return { default = { deltas = deltas, full_sync = true, }, }
  end)

end


return RpcSyncV2ValidationHandler
