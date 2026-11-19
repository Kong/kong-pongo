-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local deepcopy = require "pl.tablex".deepcopy
local string_rep = string.rep
local table_sort = table.sort
local insert = table.insert
local find = string.find
local ipairs = ipairs
local max = math.max
local min = math.min
local ngx_md5 = ngx.md5


local ANONYMIZE_MAP = {
  general = { "PERSON", "LOCATION", "ORGANIZATION" },
  phone = { "PHONE_NUMBER" },
  credential = { "PASSWORD" },
  custom = { "CUSTOM" },
}

local _M = {}

_M.ANONYMIZE_MAP = ANONYMIZE_MAP

local function anonymize(content, analyzer_results, conf)
  local function do_redact(input, analyzer_results)
    local anonymized_content = input

    table_sort(analyzer_results, function(a, b) return a.start < b.start end)

    for _, result in ipairs(analyzer_results) do
      local start_idx = result.start
      local stop_idx = result["end"]
      local redact_text = result.redact_text
      local redact_length = #redact_text
      stop_idx = min(#anonymized_content, stop_idx)

      anonymized_content = anonymized_content:sub(1, start_idx - 1)
        .. redact_text
        .. anonymized_content:sub(stop_idx + 1)

      local original_length = stop_idx - start_idx + 1
      local delta = redact_length - original_length

      for i = _ + 1, #analyzer_results do
        local next_result = analyzer_results[i]
        if next_result.start > stop_idx then
            next_result.start = next_result.start + delta
            next_result["end"] = next_result["end"] + delta
        end
      end
    end

    return anonymized_content
  end

  local function do_hash(input, analyzer_results)
    local anonymized_content = input

    table_sort(analyzer_results, function(a, b) return a.start < b.start end)

    for _, result in ipairs(analyzer_results) do
        local start_idx = result.start
        local stop_idx = result["end"]
        local original_text = anonymized_content:sub(start_idx, stop_idx)
        local hash_mask = ngx_md5(original_text)

        anonymized_content = anonymized_content:sub(1, start_idx - 1)
            .. hash_mask
            .. anonymized_content:sub(stop_idx + 1)

        local hash_length = #hash_mask
        local original_length = stop_idx - start_idx + 1
        local delta = hash_length - original_length

        for i = _ + 1, #analyzer_results do
            local next_result = analyzer_results[i]
            if next_result.start > stop_idx then
                next_result.start = next_result.start + delta
                next_result["end"] = next_result["end"] + delta
            end
        end
    end

    return anonymized_content
  end

  local function do_mask(input, analyzer_results, conf)
    local anonymized_content = input
    local mask_char = conf.mask_char or "*"
    local chars_to_mask = conf.chars_to_mask or 6
    local from_end = conf.from_end

    for _, result in ipairs(analyzer_results) do
      local start_idx = result.start
      local stop_idx = result["end"]

      local segment_length = stop_idx - start_idx + 1
      local mask_length = min(chars_to_mask, segment_length)
      local mask_string = string_rep(mask_char, mask_length)
      if from_end then
        start_idx = stop_idx - mask_length + 1
      else
        stop_idx = start_idx + mask_length - 1
      end

      start_idx = max(1, start_idx)
      stop_idx = min(#anonymized_content, stop_idx)

      anonymized_content = anonymized_content:sub(1, start_idx - 1)
        .. mask_string
        .. anonymized_content:sub(stop_idx + 1)
    end

    return anonymized_content
  end

  local anonymize_type = conf.anonymize_type
  if anonymize_type == "mask" then
    return do_mask(content, analyzer_results, conf)

  elseif anonymize_type == "hash" then
    return do_hash(content, analyzer_results)

  elseif anonymize_type == "redact"
    or anonymize_type == "redact_and_recover" then
    return do_redact(content, analyzer_results)

  else
    return nil, "unknown anonymize type"
  end
end

local function analyze(text, p_list)
  local result = {}

  for _, p in ipairs(p_list) do
    local start_pos = 1

    while true do
      local escaped_text = p.text:gsub("([%+%-%(%)])", "%%%1")
      local s, e = find(text, escaped_text, start_pos)

      if s then
        local match_result = {
            start = s,
            ["end"] = e,
            original_text = p.text,
            entity_type = p.entity_type,
            redact_text = p.redact_text,
        }

        insert(result, match_result)
        start_pos = e + 1

      else
          break
      end
    end
  end

  -- Return the list of results
  return result
end

local function get_sorted_anonymize_keys(values)
  local keys = {}
  local keys_map = {}
  for _, value in pairs(values) do
    for map_key, map_values in pairs(ANONYMIZE_MAP) do
      local found = false
      for _, map_value in ipairs(map_values) do
        if value == map_value and not keys_map[map_value] then
          insert(keys, map_key)
          keys_map[map_value] = true
          found = true
          break
        end
      end

      if found then
        break
      end
    end
  end

  table_sort(keys)
  return keys
end

function _M.validate_request_body(request)
  if not request then
    return false, "request is required"
  end

  local method = request.method
  if not method then
    return false, "method is required"
  end

  local params = request.params
  if not params then
    return false, "params is required"
  end

  local id = request.id
  if not id then
    return false, "id is required"
  end

  return true
end

_M.analyze = analyze

-- mimite a sanitizer service:
-- the pii locates in the `pii_list` fields of the request body
function _M.sanitize(payload, options)
  local pii_list = deepcopy(payload.pii_list)
  local conf = {
    anonymize_type = options.type or "redact",
    redact_type = options.redact_type or "synthetic",
  }

  local identified_pii_map = {}
  local anonymized_pii_map = {}
  local identified_pii = {}
  local anonymized_pii = {}
  for _, pii in ipairs(pii_list) do
    if not identified_pii_map[pii.entity_type] then
      identified_pii_map[pii.entity_type] = true
      insert(identified_pii, pii.entity_type)
    end

    if not anonymized_pii_map[pii.entity_type] and pii.redact_text then
      anonymized_pii_map[pii.entity_type] = true
      insert(anonymized_pii, pii.entity_type)
    end
  end
  identified_pii = get_sorted_anonymize_keys(identified_pii)
  anonymized_pii = get_sorted_anonymize_keys(anonymized_pii)


  local dectected_language = payload.language or "en"
  local sanitized_messages = {}
  for _, message in ipairs(payload.text) do
    local analyzer_results = analyze(message.text, pii_list)

    local recongizer_results = {}
    for _, result in ipairs(analyzer_results) do
      if result.redact_text then
        insert(recongizer_results, result)
      end
    end

    local sanitized_text = anonymize(message.text, deepcopy(recongizer_results), conf)
    insert(sanitized_messages, {
      sanitized_text = sanitized_text,
      msg_id = message.msg_id,
      analyzer_results = recongizer_results,
      dectected_language = dectected_language,
    })
  end

  return {
    text = sanitized_messages,
    identified_pii = identified_pii,
    anonymized_pii = anonymized_pii,
    duration = 10,
  }
end

return _M
