-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local typedefs = require "kong.db.schema.typedefs"


return {
  name = "slow-configure",
  fields = {
    {
      protocols = typedefs.protocols { default = { "http", "https", "tcp", "tls", "grpc", "grpcs" } },
    },
    {
      config = {
        type = "record",
        fields = {
          -- Delay used by configure() race tests.
          { latency = { type = "number", default = 0 } },
          -- A vault reference can delay iterator construction.
          { secret = { type = "string", required = false, referenceable = true } },
        },
      },
    },
  },
}
