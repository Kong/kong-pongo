-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- busted-ci-helper.lua
local busted = require 'busted'

do
  local shutdown_timers = require("kong.cmd.utils.timer").shutdown
  assert(type(shutdown_timers) == "function")

  -- shutdown lua-resty-timer-ng to allow the nginx worker to stop quickly
  busted.subscribe({ 'exit' }, function()
    shutdown_timers()

    -- second return value must be `true`, or else all other callbacks for this
    -- event will be skipped
    return nil, true
  end)
end

local BUSTED_EVENT_PATH = os.getenv("BUSTED_EVENT_PATH")
if BUSTED_EVENT_PATH then
  -- needed before requiring 'socket.unix'
  require 'socket'

  local cjson = require 'cjson'
  local socket_unix = require 'socket.unix'

  -- Function to recursively copy a table, skipping keys associated with functions
  local function copyTable(original, copied, cache, max_depth, current_depth)
    copied        = copied or {}
    cache         = cache  or {}
    max_depth     = max_depth or 5
    current_depth = current_depth or 1

    if cache[original] then return cache[original] end
    cache[original] = copied

    for key, value in pairs(original) do
      if type(value) == "table" then
        if current_depth < max_depth then
          copied[key] = copyTable(value, {}, cache, max_depth, current_depth + 1)
        end
      elseif type(value) == "userdata" then
        copied[key] = tostring(value)
      elseif type(value) ~= "function" then
        copied[key] = value
      end
    end

    return copied
  end

  local sock = assert(socket_unix())
  assert(sock:connect(BUSTED_EVENT_PATH))

  local events = {{ 'suite', 'reset' },
                  { 'suite', 'start' },
                  { 'suite', 'end' },
                  { 'file', 'start' },
                  { 'file', 'end' },
                  { 'test', 'start' },
                  { 'test', 'end' },
                  { 'pending' },
                  { 'failure', 'it' },
                  { 'error', 'it' },
                  { 'failure' },
                  { 'error' }}

  for _, event in ipairs(events) do
    busted.subscribe(event, function (...)
      local args = {}
      for i, original in ipairs{...} do
        if type(original) == "table" then
          args[i] = copyTable(original)
        elseif type(original) == "userdata" then
          args[i] = tostring(original)
        elseif type(original) ~= "function" then
          args[i] = original
        end
      end

      sock:send(cjson.encode({ event = event[1] .. (event[2] and ":" .. event[2] or ""), args = args }) .. "\n")
      return nil, true --continue
    end)
  end
end
