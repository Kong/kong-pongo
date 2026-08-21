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

local data = {}
local indexes = {}
local ttl = {}

-- The field array of a search result, as observed on different MemoryDB
-- versions. The drivers must read the fields by name, so every shape has to
-- work:
--   * document_first: the JSON document, then the distance under the query alias
--   * score_first:    the distance under the generated name, then the document
--   * no_score:       only the JSON document, without a distance
local search_response_shapes = {
  document_first = function(document, distance)
    return { "$", document, "score", tostring(distance) }
  end,
  score_first = function(document, distance)
    return { "__vector_score", tostring(distance), "$", document }
  end,
  no_score = function(document)
    return { "$", document }
  end,
}

local search_response_shape = "document_first"

-- an optional cap on the returned rows, to emulate a server that returns fewer
-- rows than the number of matches it reports
local max_search_rows = nil

-- Parse the FT.SEARCH clauses that the drivers use.
--
-- @param table args the arguments after the index name
-- @treturn number|nil the row count of the LIMIT clause
-- @treturn table the PARAMS name/value pairs
local function parse_search_args(args)
  local limit_count, params = nil, {}
  local i = 2 -- args[1] is the query expression

  while i <= #args do
    local token = args[i]

    if token == "LIMIT" then
      limit_count = tonumber(args[i + 2])
      i = i + 3

    elseif token == "PARAMS" then
      local nargs = tonumber(args[i + 1]) or 0
      for j = i + 2, i + nargs, 2 do
        params[args[j]] = args[j + 1]
      end
      i = i + 2 + nargs

    else
      i = i + 1
    end
  end

  return limit_count, params
end

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
                "index_definition", {"key_type", "JSON", "prefixes", { index }, "default_score", "1" },
                "attributes", {
                  { "identifier", "$.vector", "attribute", "vector", "type", "VECTOR", "algorithm", "FLAT", "data_type", "FLOAT32", "dim", 4, "distance_metric", indexes[index].metric, }
              } })
            end,
            ["FT.DROPINDEX"] = function(red, index, DD, ...)
              if forced_error_msg then
                return red:ret(false, forced_error_msg)
              end

              if DD == "DD" then
                data = {}
              end

              if not indexes[index] then
                return red:ret(false, "Index not found")
              end

              indexes[index] = nil
              return red:ret(true, nil)
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
              local limit_count, params = parse_search_args(args)
              local is_knn = type(args[1]) == "string" and args[1]:find("KNN", 1, true) ~= nil

              -- a KNN query bounds the results with k, a range query with the threshold
              local threshold = tonumber(params.range)
              local k = tonumber(params.k)
              red.last_threshold_received = threshold

              local search_vector = convert_bytes_to_vector(params.query_vector)

              -- The caller can override the response with mock_next_search to set this next_response_key
              -- and that will force a specific payload to be returned, if desired.
              local payload = data[red.next_response_key]
              if payload then
                -- reset the override
                local key = red.next_response_key
                red.next_response_key = nil
                return red:ret({ 1, key, { {}, {}, "score", "1.0" } })
              end

              -- if the payload wasn't forced with an override, we'll do a vector search.
              -- we won't try to fully emulate Redis' vector search but we can do a simple
              -- distance comparison to emulate it.
              local matches = {}
              for _key, value in pairs(data) do
                local decoded_payload, err = cjson.decode(value)
                if err then
                  return red:ret(nil, err)
                end

                -- check the proximity of the found vector
                local found_vector = decoded_payload.vector
                local proximity_match, distance
                -- a KNN query has no threshold, so every vector is a candidate
                local range = threshold or math.huge
                if distance_metric == "COSINE" then
                  proximity_match, distance = cosine_distance(search_vector, found_vector, range)
                elseif distance_metric == "L2" then
                  proximity_match, distance = euclidean_distance(search_vector, found_vector, range)
                else
                  error("unknown metric " .. distance_metric)
                end

                -- a KNN query returns the k closest vectors, whatever their distance
                if is_knn or proximity_match then
                  table.insert(matches, { key = _key, distance = distance, document = value })
                end
              end

              table.sort(matches, function(a, b)
                return a.distance < b.distance
              end)

              if is_knn and k and #matches > k then
                for i = #matches, k + 1, -1 do
                  table.remove(matches, i)
                end
              end

              -- MemoryDB returns nothing when there are no keys in the index prefix
              if #matches < 1 then
                return red:ret({})
              end

              -- The first element is the number of matches. It is not the number
              -- of returned rows: the LIMIT clause can return fewer rows.
              local res = { #matches }
              local rows = math.min(#matches, limit_count or 10, max_search_rows or math.huge)
              local build_fields = search_response_shapes[search_response_shape]

              for i = 1, rows do
                table.insert(res, matches[i].key)
                -- MemoryDB returns the JSON document of a match inside an array
                table.insert(res, build_fields("[" .. matches[i].document .. "]", matches[i].distance))
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
                return red:ret("redis_version:6.2.6\nused_memory:123456\nused_memory_rss:123456\nos:Amazon MemoryDB\n")
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
  search_response_shape = "document_first"
  max_search_rows = nil
end

-- Select the field array shape that FT.SEARCH returns.
--
-- @param string shape one of the keys of search_response_shapes
local function set_search_response_shape(shape)
  assert(search_response_shapes[shape], "unknown search response shape " .. tostring(shape))
  search_response_shape = shape
end

-- Cap the rows that FT.SEARCH returns, without changing the reported number of
-- matches. This emulates a server that truncates the result set.
--
-- @param number|nil rows the maximum number of rows, or nil to remove the cap
local function set_max_search_rows(rows)
  max_search_rows = rows
end

--
-- module
--

return {
  -- functions
  setup = setup,
  clear = clear,
  set_search_response_shape = set_search_response_shape,
  set_max_search_rows = set_max_search_rows,
}
