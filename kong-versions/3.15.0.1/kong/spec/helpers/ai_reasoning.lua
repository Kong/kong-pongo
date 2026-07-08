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


return _M
