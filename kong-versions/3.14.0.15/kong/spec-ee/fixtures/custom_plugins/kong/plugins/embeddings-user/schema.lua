-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local llm = require "kong.llm"

return {
  name = "embeddings-user",
  supported_partials = {
    ["embeddings"] = { "config.embeddings" },
  },
  fields = {
    {
      config = {
        type = "record",
        fields = {
          { search = {
            type = "record",
            fields = {
              { threshold = { type = "number", default = 0.8, between = { 0, 1 } }},
            }
          }},
          { embeddings = llm.embeddings_schema }
        },

        entity_checks = {
          {
            custom_entity_check = {
              field_sources = { "embeddings" },
              fn = function(entity)
                -- Test validation: reject if using unsupported provider for testing
                if entity.embeddings and entity.embeddings.provider == "test-forbidden-provider" then
                  return false, "test-forbidden-provider for embeddings-user test plugin is forbidden... just for testing reasons"
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