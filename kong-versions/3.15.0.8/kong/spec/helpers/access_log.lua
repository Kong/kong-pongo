-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local cjson = require "cjson"
local pl_file = require "pl.file"
local kongstr = require("kong.tools.string")

--- test helper methods for access log
-- @module spec.helpers.access_log

local _M = {}


--- Resets the log file written by file-log plugin.
-- @param path string: the path to the log file
function _M.reset_log_file(path)
  -- Note: if file is removed instead of trunacted, file-log ends writing to a unlinked file handle
  local file = io.open(path, "w")
  file:close()
end

--- Wait until the log is written by file-log plugin, and returns the JSON entry.
-- @param assert table: the assertion object injected by Busted
-- @param path string: the path to the log file
-- @param n number: the number of entries to wait for, default is 1
function _M.wait_for_json_log_entry(assert, path, n)
  local entries
  if not n then
    n = 1
  end

  assert
    .with_timeout(10)
    .ignore_exceptions(true)
    .eventually(function()
      local data = assert(pl_file.read(path))

      data = kongstr.strip(data)
      assert(#data > 0, "log file is empty")

      entries = {}
      for i, line in ipairs(kongstr.split(data, "\n")) do
        local json = cjson.decode(line)
        table.insert(entries, json)
        if i >= n then
          return true
        end
      end

      return false
    end)
    .is_truthy("log file contains enough JSON entries")

  return entries
end


--- Waits until a file-log JSON entry whose body contains `request_id` has
-- been fully written, then returns the decoded entry. Tolerates partially
-- written or interleaved lines while waiting (multiple Kong workers can
-- share the file via O_APPEND and writes larger than PIPE_BUF are not
-- guaranteed atomic on Linux).
-- @param assert table: the assertion object injected by Busted
-- @param path string: the path to the log file written by file-log
-- @param request_id string: the value to match against (substring search)
-- @param timeout number|nil: max seconds to wait, default 5
-- @return table: the decoded JSON entry
function _M.wait_for_json_log_entry_by_request_id(assert, path, request_id, timeout)
  timeout = timeout or 5
  local entry
  assert
    .with_timeout(timeout)
    .ignore_exceptions(true)
    .eventually(function()
      local fh = io.open(path, "r")
      if not fh then
        return false
      end
      for line in fh:lines() do
        if line:find(request_id, nil, true) then
          local ok, decoded = pcall(cjson.decode, line)
          if ok and decoded then
            fh:close()
            entry = decoded
            return true
          end
          -- partial / interleaved line; keep scanning, retry next tick
        end
      end
      fh:close()
      return false
    end)
    .is_truthy("file-log entry for request_id '" .. request_id ..
               "' not found at " .. path)
  return entry
end

return _M
