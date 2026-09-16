-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]


-- Fixture for kong/db/schema/vault_loader.lua's expressible-field guard:
-- expressible is a Plugins-only mechanism, so a vault schema marking a field
-- expressible must fail to load, not silently accept an inert `expressions`
-- counterpart.
return {
  name = "expressible-invalid",
  fields = {
    {
      config = {
        type = "record",
        fields = {
          { secret = { type = "string", expressible = true } },
        },
      },
    },
  },
}
