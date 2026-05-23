-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local c = {}

c.plugins = {
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
      ["/config"] = { ["*"] = true },
      ["/licenses"] = { ["*"] = true },
      ["/licenses/:licenses"] = { ["*"] = true },
      ["/keyring/recover"] = { ["*"] = true },
      ["/keyring/import"] = { ["*"] = true },
      ["/keyring/import/raw"] = { ["*"] = true },
    },
    allow_entity = { READ = true, WRITE = false },
  },
  -- Free (no license configured): admin API is read-only except /licenses,
  -- and the proxy data plane is suspended (router + plugins iterator empty)
  -- until a license is uploaded.
  free = {
    conf = {},
    allow_admin_api = {
      ["/config"] = { ["*"] = true },
      ["/licenses"] = { ["*"] = true },
      ["/licenses/:licenses"] = { ["*"] = true },
      ["/keyring/recover"] = { ["*"] = true },
      ["/keyring/import"] = { ["*"] = true },
      ["/keyring/import/raw"] = { ["*"] = true },
    },
    allow_entity = { READ = false, WRITE = false },
  },
}

-- This is a flag is being used to indicate a generated release
c.release = false

return setmetatable(c, {__index = function() return {} end })
