-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local typedefs = require "kong.db.schema.typedefs"

return {
  name = "lic_required_vault",
  fields = {
    {
      config = {
        type = "record",
        fields = {
          { prefix = { type = "string", match = [[^[%a_][%a%d_]*$]] } },
          { port   = typedefs.port { required = true, default = 8200 } },
          { ttl           = typedefs.ttl },
          { neg_ttl       = typedefs.ttl },
          { resurrect_ttl = typedefs.ttl },
        },
      },
    },
  },
}
