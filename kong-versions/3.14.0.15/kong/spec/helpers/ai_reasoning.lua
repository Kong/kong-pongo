-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local helpers = require "spec.helpers"
local cjson = require("cjson.safe")
local pl_file = require "pl.file"
local strip = require("kong.tools.string").strip
local http = require("resty.http")

local _M = {}


function _M.truncate_file(path)
  local file = io.open(path, "w")
  file:close()
end


function _M.wait_for_capture(assertion, path)
  local capture

  assertion
    .with_timeout(5)
    .ignore_exceptions(true)
    .eventually(function()
      local data = assertion(pl_file.read(path))
      data = strip(data)
      assertion(#data > 0, "reasoning capture is empty")
      capture = assertion(cjson.decode(data))
    end)
    .has_no_error("reasoning capture was written")

  return capture
end


function _M.consume_stream_response(assertion, path, body)
  local httpc = http.new()

  local ok, err = httpc:connect({
    scheme = "http",
    host = helpers.mock_upstream_host,
    port = helpers.get_proxy_port(),
  })
  if not ok then
    assertion.is_nil(err)
  end

  local res, req_err = httpc:request({
    path = path,
    body = body,
    headers = {
      ["content-type"] = "application/json",
      ["accept"] = "application/json",
    },
  })
  if not res then
    assertion.equals("closed", req_err)
    return nil, false
  end

  local reader = res.body_reader
  local saw_buffer = false

  repeat
    local buffer, read_err = reader(8192)
    if read_err then
      assertion.is_falsy(read_err and read_err ~= "closed")
    end

    if buffer then
      saw_buffer = true
    end
  until not buffer

  return res, saw_buffer
end


-- Like consume_stream_response but also returns the accumulated body string.
-- Use this when tests need to inspect the SSE frames themselves (e.g. to
-- validate usage tokens inside the stream).
function _M.read_stream_response(assertion, path, body)
  local httpc = http.new()

  local ok, err = httpc:connect({
    scheme = "http",
    host = helpers.mock_upstream_host,
    port = helpers.get_proxy_port(),
  })
  if not ok then
    assertion.is_nil(err)
  end

  local res, req_err = httpc:request({
    path = path,
    body = body,
    headers = {
      ["content-type"] = "application/json",
      ["accept"] = "application/json",
    },
  })
  if not res then
    assertion.equals("closed", req_err)
    return nil, nil
  end

  local reader = res.body_reader
  local full_body = ""

  repeat
    local buffer, read_err = reader(8192)
    if read_err then
      assertion.is_falsy(read_err and read_err ~= "closed")
    end

    if buffer then
      full_body = full_body .. buffer
    end
  until not buffer

  return res, full_body
end


-- Parse the usage object from the final SSE event in a streaming response body.
-- Handles both:
--   * OpenAI/xAI SSE format:  "data: {..., usage: {...}}"
--   * Gemini JSON-array format: each chunk is a raw JSON object (not SSE)
--   * OpenAI Responses API SSE: "event: response.completed\ndata: {...,response:{usage:{...}}}"
-- Returns nil when no usage frame is found.
function _M.find_stream_usage(body)
  if type(body) ~= "string" then
    return nil
  end

  local usage

  -- Try SSE format first (data: {...})
  for line in body:gmatch("[^\n]+") do
    line = line:match("^%s*(.-)%s*$") -- strip
    if line:sub(1, 6) == "data: " then
      local raw = line:sub(7)
      if raw ~= "[DONE]" then
        local ok, parsed = pcall(cjson.decode, raw)
        if ok and type(parsed) == "table" then
          if type(parsed.usage) == "table" then
            usage = parsed.usage
          elseif type(parsed.response) == "table" and type(parsed.response.usage) == "table" then
            usage = parsed.response.usage
          end
        end
      end
    else
      -- Try raw JSON object (Gemini streaming format)
      local ok, parsed = pcall(cjson.decode, line)
      if ok and type(parsed) == "table" and type(parsed.usageMetadata) == "table" then
        -- Gemini carries usage in usageMetadata; convert to OpenAI-style
        local meta = parsed.usageMetadata
        usage = {
          prompt_tokens = meta.promptTokenCount,
          completion_tokens = meta.candidatesTokenCount,
          total_tokens = meta.totalTokenCount,
          prompt_tokens_details = meta.cachedContentTokenCount and {
            cached_tokens = meta.cachedContentTokenCount,
          } or nil,
        }
      end
    end
  end

  return usage
end


return _M
