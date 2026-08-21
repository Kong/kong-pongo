-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--
-- imports
--

local cjson = require("cjson.safe")
local ffi = require("ffi")

local mocker = require("spec.fixtures.mocker")

--
-- private vars
--

-- the error message to force on the next Redis call
local forced_error_msg = nil

--
-- private functions
--

-- the default precision to round to during conversion
local default_precision = 1e-6

-- Redis requires a vector to be converted to a byte string, this function reverses
-- that process so that we can compare vectors.
--
-- @param bytes the byte string to convert
-- @param precision the precision to round to (optional)
-- @return the vector
local function convert_bytes_to_vector(bytes, precision)
  precision = precision or default_precision
  local float_size = ffi.sizeof("float")
  local num_floats = #bytes / float_size
  local float_array = ffi.cast("float*", bytes)
  local vector = {}
  for i = 0, num_floats - 1 do
    local value = float_array[i]
    value = math.floor(value / precision + 0.5) * precision -- round to precision
    table.insert(vector, value)
  end
  return vector
end

-- Searches for the cosine distance between two vectors, and compares it
-- against a threshold.
--
-- @param v1 the first vector
-- @param v2 the second vector
-- @param threshold the threshold to compare against
-- @return true if the vectors are within the threshold, false otherwise
-- @return the distance between the vectors
local function cosine_distance(v1, v2, threshold)
  local dot_product = 0.0
  local magnitude_v1 = 0.0
  local magnitude_v2 = 0.0

  for i = 1, #v1 do
    dot_product = dot_product + v1[i] * v2[i]
    magnitude_v1 = magnitude_v1 + v1[i] ^ 2
    magnitude_v2 = magnitude_v2 + v2[i] ^ 2
  end

  magnitude_v1 = math.sqrt(magnitude_v1)
  magnitude_v2 = math.sqrt(magnitude_v2)

  local cosine_similarity = dot_product / (magnitude_v1 * magnitude_v2)
  local cosine_distance = 1 - cosine_similarity

  return cosine_distance <= threshold, cosine_distance
end

-- Searches for the euclidean distance between two vectors, and compares it
-- against a threshold.
--
-- @param v1 the first vector
-- @param v2 the second vector
-- @param threshold the threshold to compare against
-- @return true if the vectors are within the threshold, false otherwise
-- @return the distance between the vectors
local function euclidean_distance(v1, v2, threshold)
  local distance = 0.0
  for i = 1, #v1 do
    distance = distance + (v1[i] - v2[i]) ^ 2
  end

  distance = math.sqrt(distance)

  return distance <= threshold, distance
end

local function find_arg(args, name)
  for i = 1, #args - 1 do
    if args[i] == name then
      return args[i + 1]
    end
  end
end

local function find_knn_k(query)
  if type(query) ~= "string" then
    return nil
  end

  local k = query:match("KNN%s+(%d+)%s+@vector")
  if not k then
    k = query:match("KNN%s+(%d+)")
  end

  return k and tonumber(k) or nil
end

local function encode_payload(payload)
  return cjson.encode(payload)
end

local data = {}
local indexes = {}
local ttl = {}

--
-- public functions
--

local function setup(finally)
  mocker.setup(finally, {
    modules = {
      { "resty.redis.connector", {
        new = function()
          return {
            -- function mocks
            set_timeouts = function() end,
            connect = function(red)
              if forced_error_msg then
                return false, forced_error_msg
              end
              return red
            end,
            auth = function()
              if forced_error_msg then
                return false, forced_error_msg
              end
              return true
            end,
            ping = function()
              if forced_error_msg then
                return false, forced_error_msg
              end
              return true
            end,
            set_keepalive = function()
              if forced_error_msg then
                return false, forced_error_msg
              end
              return true
            end,

            init_pipeline = function(red)
              red.in_pipeline = true
              red.pipeline_results = {}
            end,

            commit_pipeline = function(red)
              red.in_pipeline = false
              return red.pipeline_results
            end,

            -- either return or saved in pipeline results
            ret = function(red, ret, err)
              if red.in_pipeline then
                if err then
                  table.insert(red.pipeline_results, {ret, err})
                else
                  table.insert(red.pipeline_results, ret)
                end
                return true
              end

              return ret, err
            end,

            -- raw command mocks
            ["FT.CREATE"] = function(red, index, ...)
              if forced_error_msg then
                return red:ret(false, forced_error_msg)
              end

              if not index or index == "idx:_vss" then
                return red:ret(false, "Invalid index name")
              end

              -- gather the distance metric
              local args = { ... }
              local distance_metric
              for _, k in pairs(args) do
                distance_metric = k
              end
              if distance_metric ~= "L2" and distance_metric ~= "COSINE" then
                return red:ret(false, "Invalid distance metric " .. (distance_metric or "nil"))
              end

              indexes[index] = {
                metric = distance_metric,
              }
              return red:ret(true, nil)
            end,
             ["FT.INFO"] = function(red, index, ...)
              if forced_error_msg then
                return red:ret(false, forced_error_msg)
              end

              if not index or index == "idx:_vss" then
                return red:ret(false, "Invalid index name")
              end

              if not indexes[index] then
                return red:ret(nil)
              end

              return red:ret({ "index_name", index,
                "index_options", {},
                "index_definition", { "key_type", "JSON", "prefixes", { index }, "default_score", "1" },
                "attributes", {
                  { "identifier", "$.vector", "attribute", "vector", "type", "VECTOR",
                    "index", { "capacity", 100, "dimensions", 4, "distance_metric", indexes[index].metric } }
              } })
            end,
            -- Valkey FT.DROPINDEX does not support DD option unlike Redis Stack.
            -- It only drops the index, not the associated keys.
            ["FT.DROPINDEX"] = function(red, index, ...)
              if forced_error_msg then
                return red:ret(false, forced_error_msg)
              end

              if not indexes[index] then
                return red:ret(false, "Index not found")
              end

              indexes[index] = nil
              return red:ret(true, nil)
            end,
            -- scan command to iterate over keys matching a pattern
            ["scan"] = function(red, cursor, ...)
              if forced_error_msg then
                return red:ret(nil, forced_error_msg)
              end

              local args = { ... }
              local pattern
              for i = 1, #args - 1, 2 do
                if args[i] == "MATCH" then
                  pattern = args[i + 1]
                  break
                end
              end

              local matching_keys = {}
              if pattern then
                -- Convert glob pattern to Lua pattern
                local lua_pattern = "^" .. pattern:gsub("%*", ".*") .. "$"
                for key, _ in pairs(data) do
                  if key:match(lua_pattern) then
                    table.insert(matching_keys, key)
                  end
                end
              end

              -- Return all matching keys in one batch (cursor "0" means done)
              return red:ret({ "0", matching_keys })
            end,
            -- del command to delete one or more keys
            ["del"] = function(red, ...)
              if forced_error_msg then
                return red:ret(nil, forced_error_msg)
              end

              local keys = { ... }
              local deleted_count = 0
              for _, key in ipairs(keys) do
                if data[key] then
                  data[key] = nil
                  red.key_count = red.key_count - 1
                  deleted_count = deleted_count + 1
                end
              end

              return red:ret(deleted_count)
            end,
            ["FT.SEARCH"] = function(red, index, ...)
              if forced_error_msg then
                return red:ret(nil, forced_error_msg)
              end

              -- verify whether the index for the search is valid,
              -- and determine whether the index was configured
              -- with euclidean or cosine distance
              local distance_metric = indexes[index].metric
              if not distance_metric then
                return red:ret(nil, "Index not found")
              end

              local args = { ... }
              local query = args[1]
              local is_knn_query = type(query) == "string" and query:find("KNN", 1, true)

              if is_knn_query and query:find("=>%s+%[") then
                return red:ret(nil, "Invalid filter format. Missing =>")
              end

              -- The caller can override the response with mock_next_search to set this next_response_key
              -- and that will force a specific payload to be returned, if desired.
              local payload = data[red.next_response_key]
              if payload then
                -- reset the override
                local key = red.next_response_key
                red.next_response_key = nil
                local decoded_payload = cjson.decode(payload)
                local payload_json = decoded_payload and encode_payload(decoded_payload.payload)
                return red:ret({ 1, key, { "score", "1.0", "payload", payload_json } })
              end

              local vector_bytes = find_arg(args, "query_vector")
              if not vector_bytes then
                return red:ret(nil, "missing query_vector")
              end

              local search_vector = convert_bytes_to_vector(vector_bytes)

              if is_knn_query then
                local k_param = find_arg(args, "k")
                local k = k_param and tonumber(k_param) or find_knn_k(query) or 0
                local payloads = {}
                for key, value in pairs(data) do
                  local decoded_payload, err = cjson.decode(value)
                  if err then
                    return red:ret(nil, err)
                  end

                  local found_vector = decoded_payload.vector
                  local _, distance
                  if distance_metric == "COSINE" then
                    _, distance = cosine_distance(search_vector, found_vector, math.huge)
                  elseif distance_metric == "L2" then
                    _, distance = euclidean_distance(search_vector, found_vector, math.huge)
                  else
                    error("unknown metric " .. distance_metric)
                  end

                  payloads[#payloads + 1] = {
                    key = key,
                    distance = distance,
                    payload_json = encode_payload(decoded_payload.payload),
                  }
                end

                table.sort(payloads, function(a, b)
                  return a.distance < b.distance
                end)

                local count = k < #payloads and k or #payloads
                if count < 1 then
                  return red:ret({ 0 })
                end

                local res = { count }
                for i = 1, count do
                  local entry = payloads[i]
                  table.insert(res, entry.key)
                  table.insert(res, { "score", tostring(entry.distance), "payload", entry.payload_json })
                end

                return red:ret(res, nil)
              end

              local range_param = find_arg(args, "range")
              local threshold = range_param and tonumber(range_param) or 0
              red.last_threshold_received = threshold

              -- if the payload wasn't forced with an override, we'll do a vector search.
              -- we won't try to fully emulate Redis' vector search but we can do a simple
              -- distance comparison to emulate it.
              local payloads = {}
              for key, value in pairs(data) do
                local decoded_payload, err = cjson.decode(value)
                if err then
                  return red:ret(nil, err)
                end

                -- check the proximity of the found vector
                local found_vector = decoded_payload.vector
                local proximity_match, distance
                if distance_metric == "COSINE" then
                  proximity_match, distance = cosine_distance(search_vector, found_vector, threshold)
                elseif distance_metric == "L2" then
                  proximity_match, distance = euclidean_distance(search_vector, found_vector, threshold)
                else
                  error("unknown metric " .. distance_metric)
                end

                if proximity_match then
                  payloads[#payloads + 1] = {
                    key = key,
                    distance = distance,
                    payload_json = encode_payload(decoded_payload.payload),
                  }
                end
              end

              table.sort(payloads, function(a, b)
                return a.distance < b.distance
              end)

              -- if no payloads were found, just return red:ret(an empty table to emulate cache miss)
              if #payloads < 1 then
                return red:ret({})
              end

              -- the structure Redis would respond with, but we only care about the proximity and payload
              local res = { #payloads }
              for i = 1, #payloads do
                local entry = payloads[i]
                table.insert(res, entry.key)
                table.insert(res, { "score", tostring(entry.distance), "payload", entry.payload_json })
              end

              return red:ret(res, nil)
            end,
            ["JSON.GET"] = function(red, key, path)
              if forced_error_msg then
                return red:ret(nil, forced_error_msg)
              end

              local ret = data[key] and cjson.decode(data[key])
              if ret and path == ".payload" then
                ret = cjson.encode(ret.payload)
              elseif path then
                error("unsupported path other than .payload, got " .. path)
              end

              return red:ret(ret, nil)
            end,
            ["JSON.SET"] = function(red, key, _path, payload) -- currently, path is not used because we only set cache at root
              if forced_error_msg then
                return red:ret(false, forced_error_msg)
              end

              red.key_count = red.key_count + 1
              data[key] = payload

              return red:ret(true, nil)
            end,
            ["JSON.DEL"] = function(red, key, path)
              if forced_error_msg then
                return red:ret(false, forced_error_msg)
              end

              red.key_count = red.key_count - 1
              data[key] = nil

              return red:ret(true, nil)
            end,
            ["FLUSHALL"] = function(red)
              data = {}
              return red:ret(true, nil)
            end,
            ["INFO"] = function (red, section)
              if forced_error_msg then
                return red:ret(nil, forced_error_msg)
              end
              if not section or section == "server" then
                return red:ret("server_name:valkey\nvalkey_version:7.2.4\nredis_version:7.2.4\nused_memory:123456\nused_memory_rss:123456\n")
              end

              if section ~= "memory" then
                return red:ret(nil, "unsupported section " .. section)
              end

              -- return a mock memory info response
              return red:ret("used_memory:123456\nused_memory_rss:123456\n")
            end,
            ["expire"] = function(red, key, t)
              ngx.update_time()
              ttl[key] = t + ngx.now()
              return red:ret(true)
            end,
            ["ttl"] = function(red, key)
              ngx.update_time()
              local t = ttl[key]
              if not t then
                return red:ret(-1)
              end
              return red:ret(t - ngx.now())
            end,

            -- internal tracking
            indexes = {},
            key_count = 0,
            cache = {},
            next_response_key = nil,
            last_threshold_received = 0.0,
            pipeline_results = {},
          }
        end,
        mock_next_search = function(red, key)
          red.next_response_key = key
        end,
        forced_failure = function(err_msg)
          forced_error_msg = err_msg
        end,
      } },
    }
  })
end

local function clear()
  data = {}
  indexes = {}
  ttl = {}
end

--
-- module
--

return {
  -- functions
  setup = setup,
  clear = clear,
}
