-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local kong = kong

local VectorDBUser = {
  PRIORITY = 0,
  VERSION = "1.0",
}

function VectorDBUser:access(conf)
  -- Validate vectordb configuration is present
  if not conf.vectordb then
    return kong.response.exit(500, {
      message = "VectorDB configuration not found", 
      config = conf 
    })
  end

  -- Simple test: return vectordb configuration to verify partial was applied
  local provider = conf.vectordb.provider
  local dimensions = conf.vectordb.dimensions
  local threshold = conf.search and conf.search.threshold or 0.8
  
  if not provider then
    return kong.response.exit(400, {
      message = "VectorDB provider not configured",
      config = conf
    })
  end

  return kong.response.exit(200, {
    message = "VectorDB partial test successful",
    provider = provider,
    dimensions = dimensions,
    search_threshold = threshold,
    config = conf
  })
end

return VectorDBUser