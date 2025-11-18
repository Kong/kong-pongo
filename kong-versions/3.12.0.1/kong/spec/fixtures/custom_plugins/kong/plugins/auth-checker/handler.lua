-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local AuthChecker =  {
  VERSION = "1.0.0",
  PRIORITY = 900,
}


-- This plugin adds headers to the response with authentication info
function AuthChecker:access()

  local consumer = kong.client.get_consumer()
  local consumer_id = consumer and consumer.id or "none"
  kong.response.set_header("X-Auth-Checker-Consumer-ID", consumer_id)

  local credential = kong.client.get_credential()
  -- credentials are freeform tables, so we just indicate presence
  -- even a .id field is not guaranteed for all plugins
  kong.response.set_header("X-Auth-Checker-Credential", not not credential)

  local consumer_groups = kong.client.get_consumer_groups()
  local consumer_group_ids
  if consumer_groups and next(consumer_groups) then
    local ids={}
    for i=1,#consumer_groups do
      table.insert(ids, consumer_groups[i].id)
    end
    consumer_group_ids=table.concat(ids,",")
  else
    consumer_group_ids="none"
  end
  kong.response.set_header("X-Auth-Checker-Consumer-Groups", consumer_group_ids)
end

return AuthChecker
