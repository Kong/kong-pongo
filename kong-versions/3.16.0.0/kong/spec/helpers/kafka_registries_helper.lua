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

local function consume_record(topic, group)
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

  local sub_ok, sub_err = c:subscribe(group or "test-topic-group-1", topics_config,
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
  local topic_records = records[topic]
  if not topic_records or not topic_records.partitions then
    return nil
  end
  -- Scan every partition, not only partition 0. A keyless message can land on
  -- any partition, so on a multi-partition topic (broker default > 1) a
  -- partition-0-only check hides the record and the test flakes.
  for _, partition in pairs(topic_records.partitions) do
    if partition.records and #partition.records > 0 then
      return partition.records[1]
    end
  end
  return nil
end

-- Verify a record reached `topic`. Use this for positive ("should produce")
-- assertions inside an eventually() loop.
--
-- consume_record uses auto_offset_reset=latest, so on a cold consumer group it
-- starts at the log end and never reads a record that the log phase produced
-- just before the consume began — the assertion then times out (this is the CI
-- flake). This helper reads from "earliest" with a fresh, unique group each call
-- (a solo consumer, so no rebalance), so the result does not depend on
-- offset-commit timing or which partition a keyless message landed on.
--
-- Do NOT use it for the negative ("must not produce") case: reading from the
-- start would also see records from earlier tests on the same topic.
local verify_seq = 0
local function has_produced_record(topic, group_prefix)
  verify_seq = verify_seq + 1
  local c = consumer:new({ { host = "localhost", port = 9092 } })
  if not c then
    return false
  end
  local topics_config = { { name = topic, schema_registry = {} } }
  local ok = c:subscribe((group_prefix or "verify") .. "-" .. verify_seq, topics_config, {
    commit_strategy = "auto",
    auto_offset_reset = "earliest",
    schema_registry = {
      confluent = {
        url = "http://localhost:8081",
        authentication = { mode = "none" },
      },
    },
    topics = topics_config,
  })
  if not ok then
    return false
  end
  return find_record(c:poll() or {}, topic) ~= nil
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

local function remove_schema(http_client, subject)
  local res = assert(http_client:send {
    method = "DELETE",
    path = "/subjects/" .. subject,
  })
  res:read_body()
  assert(res.status == 200)

  res = assert(http_client:send {
    method = "DELETE",
    path = "/subjects/" .. subject .. "?permanent=true",
  })
  res:read_body()
  assert(res.status == 200)
end

return {
  consume_record = consume_record,
  find_record = find_record,
  has_produced_record = has_produced_record,
  register_schema = register_schema,
  remove_schema = remove_schema,
  create_topic = create_topic,
}
