-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local c = {}

c.plugins = {
  -- HACK: when adding correlation-id plugin through the admin api
  -- restrict it as an enterprise plugin
  "correlation-id",
  "kafka-upstream",
}

-- This is a mock of the distributions_constants.lua file.
-- Additionally, full_expired and free are now the same, so if making a change to
-- one, make sure to also change the other.
c.featureset = {
  full = {
    conf = {},
  },
  full_expired = {
    conf = {},
    allow_admin_api = {
      ["/licenses"] = { ["*"] = true },
      ["/licenses/:licenses"] = { ["*"] = true },
    },
    allow_ee_entity = { READ = true, WRITE = false },
    disabled_ee_entities = {
      ["workspaces"] = true,
      ["event_hooks"] = true,
      ["consumer_groups"] = true,
      ["consumer_group_plugins"] = true,
      ["rbac_role_endpoints"] = true,
      ["rbac_role_entities"] = true,
      ["rbac_roles"] = true,
      ["rbac_user_roles"] = true,
      ["rbac_users"] = true,
    },
  },
  -- Free is the same as full_expired
  free = {
    conf = {},
    allow_admin_api = {
      ["/licenses"] = { ["*"] = true },
      ["/licenses/:licenses"] = { ["*"] = true },
    },
    allow_ee_entity = { READ = true, WRITE = false },
    disabled_ee_entities = {
      ["workspaces"] = true,
      ["event_hooks"] = true,
      ["consumer_groups"] = true,
      ["consumer_group_plugins"] = true,
      ["rbac_role_endpoints"] = true,
      ["rbac_role_entities"] = true,
      ["rbac_roles"] = true,
      ["rbac_user_roles"] = true,
      ["rbac_users"] = true,
      ["rbac_user_groups"] = true,
    },
  },
}

-- This is a flag is being used to indicate a generated release
c.release = false

return setmetatable(c, {__index = function() return {} end })
