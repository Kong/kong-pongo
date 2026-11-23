-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local typedefs = require "kong.db.schema.typedefs"


return {
  name = "set-upstream-client-cert",
  fields = {
    { protocols = typedefs.protocols_http },
    {
      config = {
        type = "record",
        fields = {
          { cert = { type = "string" }, },
          { key = { type = "string" }, },
          { enable_buffering = { type = "boolean", default = false }, },
          { tls_verify = { type = "boolean" }, },
          { tls_verify_depth = { type = "number" }, },
          { trusted_store_ca_cert = { type = "string" }, },
        },
      },
    },
  },
}
