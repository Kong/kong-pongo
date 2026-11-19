-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local kong = kong

local ModelsUser = {
  PRIORITY = 0,
  VERSION = "1.0",
}

function ModelsUser:access(conf)
  -- The model partial now includes the complete LLM config structure
  -- Validate that the LLM config is present
  if not conf.llm_config then
    return kong.response.exit(500, {
      message = "LLM configuration not found", 
      config = conf 
    })
  end

  local llm_config = conf.llm_config
  
  -- Validate model configuration
  if not llm_config.model then
    return kong.response.exit(500, {
      message = "Model configuration not found in LLM config",
      config = conf
    })
  end

  -- Extract configuration details
  local route_type = llm_config.route_type
  local auth = llm_config.auth
  local model = llm_config.model
  local logging = llm_config.logging
  local threshold = conf.search and conf.search.threshold or 0.8
  
  -- Validate required fields
  if not route_type then
    return kong.response.exit(400, {
      message = "Route type not configured",
      config = conf
    })
  end
  
  if not model.provider then
    return kong.response.exit(400, {
      message = "Model provider not configured",
      config = conf
    })
  end

  -- Return complete configuration to verify partial was applied correctly
  return kong.response.exit(200, {
    message = "Model partial test successful",
    route_type = route_type,
    provider = model.provider,
    model_name = model.name,
    temperature = model.options and model.options.temperature,
    max_tokens = model.options and model.options.max_tokens,
    auth_configured = (auth and auth.header_name) and true or false,
    logging_statistics = logging and logging.log_statistics,
    logging_payloads = logging and logging.log_payloads,
    search_threshold = threshold,
    config = conf
  })
end

return ModelsUser