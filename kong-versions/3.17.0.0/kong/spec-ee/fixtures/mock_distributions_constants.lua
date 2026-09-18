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
c.featureset = {
  full = {
    conf = {},
  },
  full_expired = {
    conf = {},
    allow_admin_api = {
      ["/auth"] = { ["*"] = true },
      ["/config"] = { ["*"] = true },
      ["/licenses"] = { ["*"] = true },
      ["/licenses/:licenses"] = { ["*"] = true },
      ["/keyring/recover"] = { ["*"] = true },
      ["/keyring/import"] = { ["*"] = true },
      ["/keyring/import/raw"] = { ["*"] = true },
    },
    allow_entity = { READ = true, WRITE = false },
  },
  -- Free (no license configured) behaves like full_expired: the proxy data
  -- plane keeps serving configured traffic, but the Admin API is read-only
  -- except for the whitelisted endpoints below (so a license can still be
  -- uploaded / recovered).
  free = {
    conf = {},
    allow_admin_api = {
      ["/auth"] = { ["*"] = true },
      ["/config"] = { ["*"] = true },
      ["/licenses"] = { ["*"] = true },
      ["/licenses/:licenses"] = { ["*"] = true },
      ["/keyring/recover"] = { ["*"] = true },
      ["/keyring/import"] = { ["*"] = true },
      ["/keyring/import/raw"] = { ["*"] = true },
    },
    allow_entity = { READ = true, WRITE = false },
  },
}

-- This is a flag is being used to indicate a generated release
c.release = false

return setmetatable(c, {__index = function() return {} end })
