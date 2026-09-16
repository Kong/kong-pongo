-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local redis = require "kong.enterprise_edition.tools.redis.v2"
local typedefs = require "kong.db.schema.typedefs"

return {
  name = "redis-user",
  supported_partials = {
    ["redis-ee"] = { "config.redis" },
  },
  fields = {
    {
      config = {
        type = "record",
        fields = {
          { header_name = typedefs.header_name { required = true} },
          { redis_key = { type = "string", required = true }},
          { policy = { type = "string", default = "redis", required = true }},
          { redis = redis.config_schema }
        },

        entity_checks = {
          {
            custom_entity_check = {
              field_sources = { "redis" },
              fn = function(entity)
                if entity.redis.port == 18934 then
                  return false, "the port 18934 for redis-user test plugin is forbidden... just for testing reasons"
                end

                return true
              end,
            }
          },
        },
      },
    },
  },
}
