-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- Test helpers for ai-rag-injector plugin
--

local cjson = require("cjson.safe")
local assert = require "luassert"

local _M = {}

-- Check if pgvector database is available
-- Returns true if connection succeeds, false otherwise
function _M.is_pgvector_available()
  local host = os.getenv("KONG_SPEC_TEST_PGVECTOR_HOST") or "127.0.0.1"
  local port = tonumber(os.getenv("KONG_SPEC_TEST_PGVECTOR_PORT")) or 15432

  -- Try to connect via socket
  local socket = require("socket")
  local tcp = socket.tcp()
  tcp:settimeout(1)  -- 1 second timeout

  local ok, err = tcp:connect(host, port)
  tcp:close()

  if not ok then
    return false, string.format("pgvector not available at %s:%d - %s", host, port, err or "connection failed")
  end

  return true
end

-- Get pgvector connection config from environment variables
function _M.get_pgvector_config()
  return {
    host = os.getenv("KONG_SPEC_TEST_PGVECTOR_HOST") or "127.0.0.1",
    port = tonumber(os.getenv("KONG_SPEC_TEST_PGVECTOR_PORT")) or 15432,
    user = "kong",
    password = "kong",
    database = "kong",
    ssl = false,
    timeout = 5000
  }
end

-- Helper function to decode body string to table
-- @param body_str string JSON string to decode
-- @return table, string|nil Decoded body or nil with error
local function decode_body(body_str)
  if not body_str then
    return nil, "No body string provided"
  end

  local body, err = cjson.decode(body_str)
  if not body then
    return nil, "Failed to decode: " .. tostring(err)
  end

  return body, nil
end

---
-- Create a consumer with consumer groups and keyauth credentials
-- @param bp Blueprint object from helpers.get_db_utils()
-- @param username string Consumer username
-- @param groups table Array of consumer group names
-- @param key string API key for keyauth
-- @param created_groups table Optional cache of created groups (indexed by name)
-- @return table Consumer entity
function _M.setup_consumer_with_groups(bp, username, groups, key, created_groups)
  local consumer = bp.consumers:insert { username = username }

  for _, group_name in ipairs(groups or {}) do
    local group = created_groups and created_groups[group_name]

    if not group then
      error("Consumer group '" .. group_name
        .. "' not found. Groups must be pre-created and passed via created_groups parameter.")
    end

    bp.consumer_group_consumers:insert {
      consumer = { id = consumer.id },
      consumer_group = { id = group.id }
    }
  end

  if key then
    bp.keyauth_credentials:insert {
      key = key,
      consumer = { id = consumer.id }
    }
  end

  return consumer
end

---
-- Configure RAG plugin with ACL settings
-- @param bp Blueprint object
-- @param route_id string Route ID to attach plugin to
-- @param vectordb_config table Vector database configuration
-- @param acl_config table ACL configuration
-- @param collection_acl_config table Collection-specific ACL overrides (optional)
-- @param filter_config table Filter configuration (optional)
-- @return table Plugin entity
function _M.setup_rag_plugin_with_acl(bp, route_id, vectordb_config, acl_config, collection_acl_config, filter_config)
  local config = {
    vectordb = vectordb_config or {
      strategy = "pgvector",
      dimensions = 4,  -- Match test embeddings
      distance_metric = "cosine",
      pgvector = {
        host = os.getenv("KONG_SPEC_TEST_PGVECTOR_HOST") or "127.0.0.1",
        port = tonumber(os.getenv("KONG_SPEC_TEST_PGVECTOR_PORT")) or 15432,
        user = "kong",
        password = "kong",
        database = "kong",
        ssl = false,
        timeout = 5000
      }
    },
    embeddings = {
      auth = {
        header_name = "Authorization",
        header_value = "Bearer test-key"
      },
      model = {
        provider = "openai",
        name = "text-embedding-3-small"
      }
    },
    inject_as_role = "system",
    inject_template = "Context: <CONTEXT>\n\nQuestion: <PROMPT>",
    fetch_chunks_count = 5,
  }

  -- Add ACL config if provided
  if acl_config then
    config.global_acl_config = acl_config
  end

  -- Add collection overrides if provided
  if collection_acl_config then
    config.collection_acl_config = collection_acl_config
  end

  -- Add filter config if provided
  if filter_config then
    config.filter_mode = filter_config.filter_mode
    config.stop_on_filter_error = filter_config.stop_on_filter_error
    config.max_filter_clauses = filter_config.max_filter_clauses
    config.consumer_identifier = filter_config.consumer_identifier
  end

  return bp.plugins:insert {
    name = "ai-rag-injector",
    route = { id = route_id },
    config = config
  }
end

---
-- Create a request body with filter parameters
-- @param prompt string User prompt/question
-- @param filters table Filter structure (optional)
-- @param filter_mode string Filter mode: "compatible" or "strict" (optional)
-- @param stop_on_filter_error boolean Stop on filter errors (optional)
-- @return table Request body
function _M.create_filter_request(prompt, filters, filter_mode, stop_on_filter_error)
  local body = {
    messages = {
      { role = "user", content = prompt or "Test query" }
    }
  }

  -- OpenAI SDK merges extra_body at root level, so "ai-rag-injector" appears at root
  if filters or filter_mode or stop_on_filter_error ~= nil then
    body["ai-rag-injector"] = {}

    if filters then
      body["ai-rag-injector"].filters = filters
    end

    if filter_mode then
      body["ai-rag-injector"].filter_mode = filter_mode
    end

    if stop_on_filter_error ~= nil then
      body["ai-rag-injector"].stop_on_filter_error = stop_on_filter_error
    end
  end

  return body
end

---
-- Assert filter error response (for strict mode or stop_on_filter_error)
-- @param response HTTP response object
-- @param error_pattern string Pattern to match in error message (optional)
-- @return table Parsed response body
function _M.assert_filter_error(response, error_pattern)
  local body_str = assert.res_status(400, response)
  local body, err = decode_body(body_str)
  if not body then
    error("Failed to decode response body: " .. tostring(err), 2)
  end

  if not body.message then
    error("Response should contain error message", 2)
  end

  if error_pattern then
    if not string.find(body.message, error_pattern, 1, true) then
      error("Error message should match pattern: " .. error_pattern, 2)
    end
  end

  return body
end

---
-- Create Admin API ingest request body
-- @param content string Content to ingest
-- @param metadata table Optional metadata fields
-- @return table Request body
function _M.create_api_ingest_request(content, metadata)
  local body = {
    content = content
  }

  if metadata then
    body.metadata = metadata
  end

  return body
end

---
-- Create Admin API lookup request body
-- @param prompt string Search prompt
-- @param filters table Optional filters structure
-- @param options table Optional settings (collection, filter_mode, stop_on_filter_error, exclude_contents)
-- @return table Request body
function _M.create_api_lookup_request(prompt, filters, options)
  options = options or {}

  local body = {
    prompt = prompt
  }

  if filters then
    body.filters = filters
  end

  if options.collection then
    body.collection = options.collection
  end

  if options.filter_mode then
    body.filter_mode = options.filter_mode
  end

  if options.stop_on_filter_error ~= nil then
    body.stop_on_filter_error = options.stop_on_filter_error
  end

  if options.exclude_contents ~= nil then
    body.exclude_contents = options.exclude_contents
  end

  return body
end

---
-- Assert Admin API error response body structure
-- @param body_str string JSON response body string
-- @param error_pattern string Optional pattern to match in error message
-- @return table Parsed response body
function _M.assert_api_error_body(body_str, error_pattern)
  local body, err = decode_body(body_str)
  if not body then
    error("Failed to decode response body: " .. tostring(err) .. ", raw: " .. tostring(body_str), 2)
  end

  if not body.message then
    error("API error response should contain 'message' field", 2)
  end

  if error_pattern then
    if not string.find(body.message, error_pattern, 1, true) then
      error("Error message '" .. body.message .. "' should match pattern: " .. error_pattern, 2)
    end
  end

  return body
end

---
-- Clean up GIN index for a given namespace
-- @param namespace string The vectordb namespace used by the plugin
-- @return boolean, string Success status and optional error message
function _M.cleanup_gin_index(namespace)
  local pgmoon = require("pgmoon")
  local pgvector_config = _M.get_pgvector_config()
  local pg = pgmoon.new(pgvector_config)

  local ok, err = pg:connect()
  if not ok then
    return false, "failed to connect to pgvector for cleanup: " .. (err or "unknown")
  end

  -- Compute table name (same logic as API)
  local table_name = "idx__vss_" .. namespace:gsub("[^%w]", "_")
  if #table_name > 63 then
    table_name = table_name:sub(1, 63)
  end

  -- Compute index name (same logic as API)
  local index_name = "idx_" .. table_name .. "_payload"
  if #index_name > 63 then
    index_name = index_name:sub(1, 63)
  end

  -- Drop index if exists (ignore errors if it doesn't exist)
  pg:query(string.format("DROP INDEX IF EXISTS %s", pg:escape_identifier(index_name)))
  pg:keepalive()

  return true
end

return _M
