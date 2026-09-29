-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local typedefs = require "kong.db.schema.typedefs"

return {
  name = "tcp-ws-trace-exporter",
  fields = {
    {
      config = {
        type = "record",
        fields = {
          { traces_host = typedefs.host({ required = false }), },
          { traces_port = typedefs.port({ required = false }), },
          { logs_host = typedefs.host({ required = false }), },
          { logs_port = typedefs.port({ required = false }), },
          { queue = typedefs.queue {
            default = {
              max_batch_size = 1,
              concurrency_limit = -1,
            },
          } },
        }
      }
    }
  }
}
