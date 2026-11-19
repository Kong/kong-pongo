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

return _M
