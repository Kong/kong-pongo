-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local math = math
local string = string
local os = os

-- Global compressor model name (mock)
local llmlingua_model_name_global = "gpt-3.5-turbo"

local function ceil(x) return math.ceil(x) end

local function count_tokens_mock(text, model_name)
  if model_name ~= "gpt-3.5-turbo" then
    return 0
  end

  -- crude token count: words counted * 1.3 ceiling
  local _, count = string.gsub(text, "%S+", "")
  return ceil(count * 1.3)
end

local function get_compression_value(token_count, compression_ranges)
  for _, range in ipairs(compression_ranges) do
    if token_count >= range.min_tokens and token_count < range.max_tokens then
      return range.value
    end
  end
  return nil
end

local function strip_politeness(text)
  local patterns = {
    "%f[%a]hello%f[%A]", "%f[%a]hi%f[%A]", "%f[%a]hey%f[%A]",
    "%f[%a]please%f[%A]", "%f[%a]could you%f[%A]", "%f[%a]can you%f[%A]",
    "%f[%a]would you%f[%A]", "%f[%a]kindly%f[%A]", "%f[%a]thank you%f[%A]",
    "%f[%a]thanks%f[%A]", "%f[%a]a lot%f[%A]", "%f[%a]regards%f[%A]", "%f[%a]sincerely%f[%A]"
  }
  for _, p in ipairs(patterns) do
    text = text:gsub(p, "")
  end
  text = text:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
  return text
end

local function compress_text_mock(text, compressor_type, compression_value)
  if compressor_type == "rate" then
    local limit = math.floor(#text * compression_value)
    if limit < 0 then limit = 0 end
    return { compressed_prompt = text:sub(1, limit) }
  elseif compressor_type == "target_token" then
    local limit = compression_value
    if limit < 0 then limit = 0 end
    return { compressed_prompt = text:sub(1, limit) }
  else
    return { compressed_prompt = text }
  end
end

local function do_compress_prompt(data, id)
  local start_time = os.time() * 1000

  local messages = data.messages
  if type(messages) ~= "table" then
    error("`messages` must be a list")
  end

  local compressor_type = data.compressor_type
  local compression_ranges = data.compression_ranges
  local model_name = data.model_name
  local advanced_logging = data.advanced_logging or false

  local compress_messages = {}

  for _, message in ipairs(messages) do
    local msg_id = message.msg_id
    if type(msg_id) ~= "number" then
      error("No valid `msg_id` found")
    end
    local raw_content = message.text
    if type(raw_content) ~= "string" then
      error("`text` in the message is not string")
    end

      -- Check for <LLMLINGUA>...</LLMLINGUA> block (case insensitive)
    local llmlingua_start, llmlingua_end, inner_text = string.find(
      raw_content,
      "<[Ll][Ll][Mm][Ll][Ii][Nn][Gg][Uu][Aa][^>]*>(.-)</[Ll][Ll][Mm][Ll][Ii][Nn][Gg][Uu][Aa]>"
    )

    local raw_content_to_compress
    if llmlingua_start then
      raw_content_to_compress = inner_text
    else
      raw_content_to_compress = raw_content
    end

    local original_token_count = count_tokens_mock(raw_content_to_compress, model_name)
    local compression_value = get_compression_value(original_token_count, compression_ranges)

    -- No compression if no compression value or target_token > original tokens
    if compression_value == nil or (compressor_type == "target_token" and compression_value > original_token_count) then
      local no_compress_message = {
        compress_prompt = raw_content_to_compress,
        compressor_results = {
          msg_id = msg_id,
          original_token_count = original_token_count,
          save_token_count = 0,
          information = "No compression was applied because the prompt is too short " ..
                        "or its token count falls outside the defined compression ranges."
        },
        msg_id = msg_id
      }
      if advanced_logging then
        no_compress_message.compressor_results.original_text = raw_content
      end
      table.insert(compress_messages, no_compress_message)
    else
      local raw_content_to_compress_stripped = strip_politeness(raw_content_to_compress)

      local compressed_res = compress_text_mock(raw_content_to_compress_stripped, compressor_type, compression_value)
      local shorter_prompt = compressed_res.compressed_prompt

      if not shorter_prompt then
        error("Missing 'compressed_prompt' in compression result")
      end

      local compress_token_count = count_tokens_mock(shorter_prompt, model_name)
      local saved_tokens = original_token_count - compress_token_count

      local compress_prompt
      if llmlingua_start then
        -- Replace the entire <LLMLINGUA>...</LLMLINGUA> block with compressed text
        compress_prompt = raw_content:sub(1, llmlingua_start - 1)
                        .. shorter_prompt
                        .. raw_content:sub(llmlingua_end + 1)
      else
        -- No <LLMLINGUA> block, just use the compressed text
        compress_prompt = shorter_prompt
      end


      local compressed_message = {
        compress_prompt = compress_prompt,
        compressor_results = {
          msg_id = msg_id,
          original_token_count = original_token_count,
          compress_token_count = compress_token_count,
          save_token_count = saved_tokens,
          compress_value = compression_value,
          compress_type = compressor_type,
          compressor_model = llmlingua_model_name_global,
          information = ("Compression was performed and saved %d tokens"):format(saved_tokens)
        },
        msg_id = msg_id
      }

      if advanced_logging then
        compressed_message.compressor_results.original_text = raw_content_to_compress
        compressed_message.compressor_results.compress_text = compress_prompt
      end

      table.insert(compress_messages, compressed_message)
    end
  end

  local duration = os.time() * 1000 - start_time

  local ret = {
    text = compress_messages,
    duration = duration
  }

  if id then
    return {
      jsonrpc = "2.0",
      result = ret,
      id = id
    }
  else
    return ret
  end
end


local function validate_request_body(data)
  -- Validate text field
  local text = data["text"]
  if type(text) ~= "string" and type(text) ~= "table" then
    error("No valid `text` found")
  end

  -- Build messages table
  local messages
  if type(text) == "string" then
    messages = { { text = text, msg_id = 1 } }
  else
    messages = text
  end

  -- Validate model_name
  local model_name = data["model_name"]
  if model_name == nil then
    error("Error: You must provide 'model_name'.")
  end

  -- Validate advanced_logging (optional boolean)
  local advanced_logging = data["advanced_logging"]
  if advanced_logging ~= nil and type(advanced_logging) ~= "boolean" then
    error("Error: 'advanced_logging' must be a boolean.")
  end

  -- Validate compressor_type
  local compressor_type = data["compressor_type"]
  if compressor_type == nil or (compressor_type ~= "rate" and compressor_type ~= "target_token") then
    error("Error: You must provide 'compressor_type' as 'rate' or 'target_token'.")
  end

  -- Validate compression_ranges (call your own Lua validation function)
  local compression_ranges = data["compression_ranges"]

  return {
    messages = messages,
    compressor_type = compressor_type,
    compression_ranges = compression_ranges,
    advanced_logging = advanced_logging,
    model_name = model_name
  }
end

return {
  compress = do_compress_prompt,
  validate_request_body = validate_request_body
}
