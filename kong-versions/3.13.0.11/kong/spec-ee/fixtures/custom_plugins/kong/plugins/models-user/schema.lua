-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local llm_config_schema = require "kong.llm.schemas.init"

return {
  name = "models-user",
  
  supported_partials = {
    ["model"] = {"config.model"}  -- Changed path to llm_config
  },

  fields = {
    {
      config = {
        type = "record",
        fields = {
          { model = llm_config_schema },  -- Use complete LLM config schema
          -- { search = {
          --   type = "record",
          --   fields = {
          --     { threshold = {
          --       type = "number",
          --       default = 0.8,
          --       between = { 0, 1 }
          --     }}
          --   }
          -- }}
        }
      }
    }
  }
}