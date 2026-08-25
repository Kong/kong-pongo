-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local llm = require "kong.llm"

return {
  name = "vectordb-user",
  supported_partials = {
    ["vectordb"] = { "config.vectordb" },
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
          { vectordb = llm.vectordb_schema }
        },

        entity_checks = {
          {
            custom_entity_check = {
              field_sources = { "vectordb" },
              fn = function(entity)
                -- Test validation: reject if dimensions > 10000
                if entity.vectordb and entity.vectordb.dimensions and entity.vectordb.dimensions > 10000 then
                  return false, "dimensions > 10000 for vectordb-user test plugin is forbidden... just for testing reasons"
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