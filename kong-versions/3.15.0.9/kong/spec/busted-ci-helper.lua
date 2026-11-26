-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- busted-ci-helper.lua

---@param busted _busted
local function shutdown_timers_on_exit(busted)
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


-- The integration specs share a fixed set of listen ports ("1st digit is 9
-- for our test instances", see spec/kong_tests.conf). A Kong instance from an
-- earlier spec file is normally stopped by its lazy_teardown, but when that
-- stop is incomplete (e.g. a hybrid-mode instance started from a timer-ng
-- job), its nginx processes keep holding those ports and every
-- helpers.start_kong in the next file scheduled on the same runner fails with
-- "nginx: [emerg] bind() ... Address already in use", failing all tests of
-- that file before any of their own assertions run.

local TEST_PORTS = {
  9000, 9001, 9002, 9003, 9004, -- plain listeners
  9443, 9444, 9445, 9446, 9447, -- ssl listeners
}

local function listening_inodes(ports)
  local want = {}
  for _, port in ipairs(ports) do
    want[port] = true
  end

  local inodes = {}
  for _, path in ipairs({ "/proc/net/tcp", "/proc/net/tcp6" }) do
    local fh = io.open(path)
    if fh then
      for line in fh:lines() do
        local tokens = {}
        for token in line:gmatch("%S+") do
          tokens[#tokens + 1] = token
        end
        -- columns: sl local_address rem_address st ... uid timeout inode
        if tokens[4] == "0A" then -- LISTEN
          local port = tokens[2] and tokens[2]:match(":(%x+)$")
          local num = port and tonumber(port, 16)
          if num and want[num] then
            inodes[tokens[10]] = true
          end
        end
      end
      fh:close()
    end
  end
  return inodes
end

local function pid_cmdline(pid)
  local fh = io.open("/proc/" .. pid .. "/cmdline")
  if not fh then
    return nil
  end
  local contents = fh:read("*a") or ""
  fh:close()
  return contents
end

-- only nginx processes are returned: test Kong instances are nginx, and any
-- other process that happens to listen on these ports must be left alone
local function nginx_pids_holding_inodes(inodes)
  local pids = {}
  if not next(inodes) then
    return pids
  end

  local lfs = require("lfs")
  for entry in lfs.dir("/proc") do
    local pid = tonumber(entry)
    if pid then
      local fd_dir = "/proc/" .. entry .. "/fd"
      local held = false
      pcall(function()
        for fd in lfs.dir(fd_dir) do
          local target = lfs.symlinkattributes(fd_dir .. "/" .. fd, "target")
          local inode = target and target:match("^socket:%[(%d+)%]$")
          if inode and inodes[inode] then
            held = true
            return
          end
        end
      end)

      if held then
        local cmdline = pid_cmdline(pid)
        if cmdline and cmdline:find("nginx", 1, true) then
          pids[#pids + 1] = pid
        end
      end
    end
  end
  return pids
end

-- a leaked nginx master that does not hold the listening socket itself would
-- respawn the workers we kill, so add its master to the kill list
local function with_nginx_parents(pids)
  local all, seen = {}, {}
  for _, pid in ipairs(pids) do
    all[#all + 1] = pid
    seen[pid] = true
  end

  for _, pid in ipairs(pids) do
    local fh = io.open("/proc/" .. pid .. "/status")
    if fh then
      local ppid = tonumber(fh:read("*a"):match("^PPid:%s+(%d+)"))
      fh:close()
      if ppid and ppid > 1 and not seen[ppid] then
        local cmdline = pid_cmdline(ppid)
        if cmdline and cmdline:find("nginx", 1, true) then
          seen[ppid] = true
          all[#all + 1] = ppid
        end
      end
    end
  end
  return all
end

local function kill_leaked_test_kong()
  local inodes = listening_inodes(TEST_PORTS)
  if not next(inodes) then
    return
  end

  -- ports are held: give a previous file's in-flight graceful stop a short
  -- chance to release them before force-killing
  require("socket").sleep(0.5)

  inodes = listening_inodes(TEST_PORTS)
  local pids = nginx_pids_holding_inodes(inodes)
  if #pids == 0 then
    -- ports are held by a non-test process; not ours to kill
    return
  end

  for _, pid in ipairs(with_nginx_parents(pids)) do
    os.execute(("kill -9 %d 2>/dev/null"):format(pid))
  end
  print("[busted-ci-helper] killed leaked test Kong nginx process(es): " ..
    table.concat(pids, ", "))
end


---@param busted _busted
local function forward_events(busted)
  local BUSTED_EVENT_PATH = os.getenv("BUSTED_EVENT_PATH")
  if not BUSTED_EVENT_PATH then
    return
  end

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


---@param busted _busted # this is the "real" busted runtime instance and exposes more APIs than what is returned by `require("busted")`
---@param _helper string # name of the helper library/file
---@param options table # parsed busted CLI options
return function(busted, _helper, options)
  -- make these things available to other test code
  busted.exportApi("context", busted.context)
  busted.exportApi("options", options)

  require("spec.internal.log").set_verbose(options.verbose)
  require("spec.busted.env").busted_init()

  shutdown_timers_on_exit(busted)
  forward_events(busted)

  -- free the fixed test ports from any instance leaked by the previous spec
  -- file before this file's lazy_setup calls helpers.start_kong
  busted.subscribe({ 'file', 'start' }, function()
    kill_leaked_test_kong()

    -- second return value must be `true`, or else all other callbacks for
    -- this event will be skipped
    return nil, true
  end)

  -- expected by busted
  return true
end
