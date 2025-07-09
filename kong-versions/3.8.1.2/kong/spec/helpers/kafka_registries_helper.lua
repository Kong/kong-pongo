-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local cjson = require "cjson"
local consumer = require "kong.resty.kafka.consumer"

local function create_topic(broker_list, topic)
  local c, err = consumer:new(broker_list)
  if not c then
    return nil, err
  end
  local ok, err = c:create_topics({ { name = topic } })
  if not ok then
    return nil, err
  end
  return true
end

local function consume_record(topic)
  -- setup a consumer and poll latest messages
  local c, err = consumer:new({ { host = "localhost", port = 9092 } })
  if not c then
    return nil, err
  end

  -- Define topics configuration with schema registry settings per topic
  local topics_config = {
    {
      name = topic,
      schema_registry = {}
    }
  }

  local sub_ok, sub_err = c:subscribe("test-topic-group-1", topics_config,
    {
      commit_strategy = "auto",
      auto_offset_reset = "latest",
      schema_registry = {
        confluent = {
          url = "http://localhost:8081",
          authentication = {
            mode = "none",
          },
        },
      },
      topics = topics_config,
    })
  if not sub_ok then
    return nil, sub_err
  end
  local records, err = c:poll()
  if err then
    return nil, err
  end
  return records
end

local function find_record(records, topic)
  -- Check if topic exists in results
  if not records[topic] or not records[topic].partitions then
    return nil
  end
  if not records[topic].partitions[0] then
    return nil
  end
  if not records[topic].partitions[0].records then
    return nil
  end
  if #records[topic].partitions[0].records > 0 then
    return records[topic].partitions[0].records[1]
  end
  return nil
end

local function register_schema(http_client, subject, schema_type, schema)
  local res = assert(http_client:send {
    method = "POST",
    path = "/subjects/" .. subject .. "/versions",
    headers = {
      ["Content-Type"] = "application/vnd.schemaregistry.v1+json",
    },
    body = cjson.encode({
      schema = cjson.encode(schema),
      schemaType = schema_type,
    })
  })

  local body = res:read_body()
  local decoded = cjson.decode(body)
  assert(decoded)
  return decoded.id
end

return {
  consume_record = consume_record,
  find_record = find_record,
  register_schema = register_schema,
  create_topic = create_topic,
}
