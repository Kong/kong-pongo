-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local kong = kong

local ConsumerFinderHandler =  {
  VERSION = "1.0.0",
  PRIORITY = 1,
}


-- from plugins-ee/saml/kong/plugins/saml/consumers.lua
local function find_consumer(consumer_id)
  local consumer_cache_key = kong.db.consumers:cache_key(consumer_id)
  return kong.cache:get(consumer_cache_key, nil, kong.client.load_consumer, consumer_id, true)
end


function ConsumerFinderHandler:access()
  local consumer = find_consumer(ngx.var.arg_consumer)
  if consumer then
    return kong.response.exit(200, { message = "find consumer" })
  end

  return kong.response.exit(404, { message = "not found consumer" })
end

return ConsumerFinderHandler
