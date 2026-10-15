-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local helpers = require "spec.helpers"
local cjson = require "cjson.safe"
local assert = require "luassert"

local sse = {}

function sse.new(opts)
  local self = setmetatable({}, { __index = sse })
  self.http = assert(helpers.http_client(opts))
  self.connected = false
  self._buf = ""        -- Buffer for storing parsed SSE text (after chunk unwrapping)
  self._chunked = false -- Whether using chunked transfer encoding
  return self
end

function sse:request(opts)
  assert(self.http, "not initialized")
  opts.headers = opts.headers or {}
  opts.headers["Accept"] = "text/event-stream"

  local res, err = self.http:send(opts)
  if not res then
    return nil, err
  end

  local ct = assert.response(res).has.header("content-type")
  assert(ct and ct:find("^text/event%-stream"), "Expected text/event-stream content type, got " .. tostring(ct))

  local te = assert.response(res).has.header("transfer-encoding")
  local te_value = type(te) == "table" and te[1] or te
  self._chunked = (te_value == "chunked")

  self.connected = true
  self._buf = ""

  -- Optional: Set read timeout to be shorter (milliseconds) to avoid blocking too long
  if self.http.sock and self.http.sock.settimeouts then
    -- Parameters are connect, send, read (milliseconds); only setting read timeout here
    pcall(self.http.sock.settimeouts, self.http.sock, nil, nil, 2000)
  end

  return res
end

-- Read more raw SSE text (remove chunk wrapper and append to self._buf)
function sse:_read_more()
  local sock = assert(self.http.sock)

  if self._chunked then
    -- Read chunk length line (hexadecimal)
    local len_line, err = sock:receive("*l")
    if not len_line then
      if err == "timeout" then
        return nil, "timeout" -- Non-fatal, let upper layer retry
      end
      self.connected = false
      return nil, err or "closed"
    end

    local len = tonumber(len_line, 16)
    if not len then
      self.connected = false
      return nil, "invalid chunk length: " .. tostring(len_line)
    end

    if len == 0 then
      -- Normal chunked ending; SSE usually doesn't send 0, but defensive
      self.connected = false
      return nil, "eof"
    end

    local data, err2 = sock:receive(len)
    if not data then
      if err2 == "timeout" then
        return nil, "timeout"
      end
      self.connected = false
      return nil, err2 or "closed"
    end

    -- Discard CRLF (no need to check)
    sock:receive(2)

    self._buf = self._buf .. data
    return true
  else
    -- Non-chunked: read line and append newline to get more content
    local line, err = sock:receive("*l")
    if not line then
      if err == "timeout" then
        return nil, "timeout"
      end
      self.connected = false
      return nil, err or "closed"
    end
    self._buf = self._buf .. line .. "\n"
    return true
  end
end

-- Extract a complete SSE event from buffer (without chunk wrapper)
function sse:_extract_event()
  if not self._buf or #self._buf == 0 then
    return nil
  end

  -- Normalize line endings
  local b = self._buf:gsub("\r\n", "\n")

  -- Events are separated by blank lines (\n\n)
  local s, e = b:find("\n\n", 1, true)
  if not s then
    -- No complete event, wait for more data
    return nil
  end

  local event = b:sub(1, s - 1)
  local rest  = b:sub(e + 1)
  self._buf   = rest
  return event
end

-- Parse an event to { data = "...", parsed_data = table? }
local function parse_event_to_msg(event)
  -- Discard comments/heartbeat (like ": keep-alive" / ": connected"), let upper loop skip
  if event:match("^%s*:") then
    return nil, "comment"
  end

  local msg = {}
  local data_parts = {}

  for line in event:gmatch("[^\n]+") do
    local field, value = line:match("^([^:]+):%s*(.*)")
    if field == "data" then
      table.insert(data_parts, value or "")
    elseif field then
      msg[field] = value
    end
  end

  if #data_parts > 0 then
    msg.data = table.concat(data_parts, "\n")

    -- Try to decode if it looks like JSON; don't error on failure
    if msg.data:match("^%s*[%[{]") then
      local ok, obj = pcall(cjson.decode, msg.data)
      if ok then
        msg.parsed_data = obj
      end
    end

    return msg
  end

  return nil, "no-data"
end

---@return table? data
---@return string? err
function sse:receive()
  if not self.connected then
    return nil, "not connected"
  end

  while true do
    -- First try to extract from local buffer
    local event = self:_extract_event()
    if event then
      local msg = parse_event_to_msg(event)
      if msg then
        return msg
      end
    else
      -- No complete event in buffer, read more from socket
      local ok, err = self:_read_more()
      if not ok then
        if err == "timeout" then
          -- Non-fatal timeout, let test loop retry
          return nil, "timeout"
        else
          -- Connection closed/protocol error
          self.connected = false
          return nil, err
        end
      end
      -- Successfully read data, go back to loop top to continue parsing
    end
  end
end

function sse:close()
  if not self.http or not self.connected then
    print("called sse_client:close(), but not connected")
    return
  end
  assert(self.http:close())
  self.connected = false
end

return sse
