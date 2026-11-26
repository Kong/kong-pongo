-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Postgres wire-protocol proxy for tests that need a statement's response held
-- back.
--
-- It only ever forwards *real* bytes produced by the real Postgres backend: it
-- never forges a message and never patches Kong's Lua. The single thing it does
-- is decide *when* a backend message reaches Kong.
--
-- Two hold modes, both edge triggered (not time based), which is what makes the
-- behaviour deterministic:
--
--   arm_set([match])
--     The next connection issuing a matching statement -- by default the
--     `SET SCHEMA ...; SET TIME ZONE ...` the postgres connector sends on every
--     new socket -- has its backend response withheld, so the query hits
--     `pg_timeout`. Because the proxy keeps the bytes buffered the socket stays
--     *quiet*, so nginx does not evict it from the cosocket pool. The held bytes
--     are released the instant that same connection sends its *next* Query,
--     i.e. exactly when the socket has been taken back out of the pool; pgmoon
--     then reads the previous statement's result. One shot: consumes the arm.
--
--   arm_select([match]) / release()
--     Every matching SELECT response -- by default any touching
--     clustering_data_planes -- is withheld until release() is called. Used to
--     park a coroutine on a query while other things happen around it.
--     disarm_select() stops parking new SELECTs while existing holds stay held.
--
-- Sockets are non blocking; sends are drained with select() so large result
-- sets cannot be truncated.

local threads = require "llthreads2.ex"
local socket = require "socket"


local function touch(path)
  local f = assert(io.open(path, "w"))
  f:write("1")
  f:close()
end


local function exists(path)
  local f = io.open(path, "r")
  if not f then
    return false
  end
  f:close()
  return true
end


local function thread_main(listen_port, up_host, up_port,
                           arm_set_file, arm_select_file, release_file,
                           stop_file, log_file)
  local socket = require "socket"

  local logf = io.open(log_file, "a")

  local function log(msg)
    if logf then
      logf:write(string.format("%.3f %s\n", socket.gettime(), msg))
      logf:flush()
    end
  end

  local function u32(s, i)
    local a, b, c, d = s:byte(i, i + 3)
    if not d then
      return nil
    end
    return a * 16777216 + b * 65536 + c * 256 + d
  end

  local function file_exists(path)
    local f = io.open(path, "r")
    if not f then
      return false
    end
    f:close()
    return true
  end

  local function read_file(path)
    local f = io.open(path, "r")
    if not f then
      return nil
    end
    local content = f:read("*a")
    f:close()
    return content
  end

  -- default matcher: the `SET SCHEMA ...; SET TIME ZONE ...` reconnect() sends
  local function is_set_sql(sql)
    return sql:match("^%s*[Ss][Ee][Tt]%s") ~= nil
  end

  local function is_select(sql)
    return sql:match("^%s*[Ss][Ee][Ll][Ee][Cc][Tt]") ~= nil
  end

  -- non blocking, never truncating send
  local function send_all(sock, data)
    local i = 1
    local total = #data
    while i <= total do
      local ok, err, last = sock:send(data, i)
      if ok then
        return true
      end
      if err ~= "timeout" and err ~= "wantwrite" then
        return nil, err
      end
      i = (last or (i - 1)) + 1
      socket.select(nil, { sock }, 0.5)
    end
    return true
  end

  local server = assert(socket.tcp())
  server:setoption("reuseaddr", true)
  assert(server:bind("127.0.0.1", listen_port))
  assert(server:listen(64))
  server:settimeout(0)

  local conns = {}       -- socket -> conn
  local conn_list = {}   -- array of conn
  local next_id = 0

  local function socks()
    local list = { server }
    for i = 1, #conn_list do
      local conn = conn_list[i]
      if not conn.closed then
        list[#list + 1] = conn.client
        list[#list + 1] = conn.up
      end
    end
    return list
  end

  local function close_conn(conn)
    if conn.closed then
      return
    end
    conn.closed = true
    conns[conn.client] = nil
    conns[conn.up] = nil
    pcall(conn.client.close, conn.client)
    pcall(conn.up.close, conn.up)
    log(("conn %d closed (hold=%s held=%d)")
        :format(conn.id, tostring(conn.hold), #conn.held))
    for i = #conn_list, 1, -1 do
      if conn_list[i] == conn then
        table.remove(conn_list, i)
      end
    end
  end

  local function flush_held(conn, why)
    if conn.held == "" then
      conn.hold = nil
      return
    end
    local n = #conn.held
    local ok, err = send_all(conn.client, conn.held)
    conn.held = ""
    conn.hold = nil
    log(("conn %d released %d held bytes (%s)%s")
        :format(conn.id, n, why, ok and "" or (" send error: " .. tostring(err))))
  end

  local function accept()
    local client = server:accept()
    if not client then
      return
    end
    local up = socket.tcp()
    up:settimeout(3)
    local ok = up:connect(up_host, up_port)
    if not ok then
      pcall(client.close, client)
      return
    end
    client:settimeout(0)
    up:settimeout(0)
    next_id = next_id + 1
    local conn = {
      id = next_id,
      client = client,
      up = up,
      fbuf = "",
      bbuf = "",
      startup_done = false,
      authed = false,
      hold = nil,
      held = "",
      closed = false,
    }
    conns[client] = conn
    conns[up] = conn
    conn_list[#conn_list + 1] = conn
    log(("conn %d accepted"):format(conn.id))
  end

  -- frontend (Kong -> PG): forward verbatim, extract simple Query statements
  local function on_frontend(conn, data)
    local ok, err = send_all(conn.up, data)
    if not ok then
      log(("conn %d upstream send failed: %s"):format(conn.id, tostring(err)))
      close_conn(conn)
      return
    end

    conn.fbuf = conn.fbuf .. data

    while true do
      if not conn.startup_done then
        -- untyped packet: int32 length (incl. itself) + body
        if #conn.fbuf < 4 then
          break
        end
        local len = u32(conn.fbuf, 1)
        if not len or len < 4 or #conn.fbuf < len then
          break
        end
        conn.fbuf = conn.fbuf:sub(len + 1)
        -- an 8 byte packet is SSLRequest/GSSENCRequest; a real startup follows
        if len ~= 8 then
          conn.startup_done = true
        end

      else
        if #conn.fbuf < 5 then
          break
        end
        local typ = conn.fbuf:sub(1, 1)
        local len = u32(conn.fbuf, 2)
        if not len or len < 4 then
          break
        end
        local total = 1 + len
        if #conn.fbuf < total then
          break
        end
        local msg = conn.fbuf:sub(1, total)
        conn.fbuf = conn.fbuf:sub(total + 1)

        if typ == "Q" and conn.authed then
          local sql = msg:sub(6):match("^([^%z]*)") or ""

          if conn.hold == "set" then
            -- Kong pulled the dirty socket back out of the pool and is now
            -- reading. Hand it the previous statement's result.
            log(("conn %d reused for: %s"):format(conn.id, sql:sub(1, 60)))
            flush_held(conn, "next query on reused socket")

          elseif not conn.hold then
            -- the arm file holds an optional substring the statement must
            -- contain; empty means "the SET statements reconnect() sends"
            local want = read_file(arm_set_file)
            if want and (want == "" and is_set_sql(sql)
                         or want ~= "" and sql:find(want, 1, true)) then
              conn.hold = "set"
              os.remove(arm_set_file)
              log(("conn %d holding response to: %s")
                  :format(conn.id, sql:gsub("%s+", " "):sub(1, 80)))

            else
              -- the arm file holds an optional substring (the node id) so a
              -- stray data plane cannot steal the hold
              local sel = read_file(arm_select_file)
              if sel and is_select(sql)
                 and (sel == "" and sql:find("clustering_data_planes", 1, true)
                      or sel ~= "" and sql:find(sel, 1, true)) then
                conn.hold = "select"
                log(("conn %d holding clustering_data_planes SELECT"):format(conn.id))
              end
            end
          end
        end
      end
    end
  end

  -- backend (PG -> Kong): frame messages so a hold captures whole messages
  local function on_backend(conn, data)
    conn.bbuf = conn.bbuf .. data

    while #conn.bbuf >= 5 do
      local typ = conn.bbuf:sub(1, 1)
      local len = u32(conn.bbuf, 2)
      if not len or len < 4 then
        break
      end
      local total = 1 + len
      if #conn.bbuf < total then
        break
      end
      local msg = conn.bbuf:sub(1, total)
      conn.bbuf = conn.bbuf:sub(total + 1)

      if not conn.authed then
        local ok, err = send_all(conn.client, msg)
        if not ok then
          log(("conn %d client send failed: %s"):format(conn.id, tostring(err)))
          close_conn(conn)
          return
        end
        if typ == "Z" then
          conn.authed = true
        end

      elseif conn.hold then
        conn.held = conn.held .. msg

      else
        local ok, err = send_all(conn.client, msg)
        if not ok then
          log(("conn %d client send failed: %s"):format(conn.id, tostring(err)))
          close_conn(conn)
          return
        end
      end
    end
  end

  log(("proxy listening on 127.0.0.1:%d -> %s:%d"):format(listen_port, up_host, up_port))

  while not file_exists(stop_file) do
    local readable = socket.select(socks(), nil, 0.05)

    for i = 1, #readable do
      local s = readable[i]
      if s == server then
        accept()

      else
        local conn = conns[s]
        if conn and not conn.closed then
          local data, rerr, partial = s:receive(65536)
          data = data or partial
          if data and #data > 0 then
            if s == conn.client then
              on_frontend(conn, data)
            else
              on_backend(conn, data)
            end
          end
          if rerr == "closed" then
            close_conn(conn)
          end
        end
      end
    end

    if file_exists(release_file) then
      for i = #conn_list, 1, -1 do
        local conn = conn_list[i]
        if conn.hold == "select" then
          flush_held(conn, "release requested")
        end
      end
    end
  end

  for i = #conn_list, 1, -1 do
    close_conn(conn_list[i])
  end
  pcall(server.close, server)
  log("proxy stopped")
  if logf then
    logf:close()
  end
end


local function start(opts)
  assert(opts and opts.listen_port and opts.upstream_host and opts.upstream_port)

  local base = opts.base or os.tmpname()
  os.remove(base)

  local files = {
    arm_set = base .. ".arm_set",
    arm_select = base .. ".arm_select",
    release = base .. ".release",
    stop = base .. ".stop",
    log = base .. ".log",
  }
  for _, path in pairs(files) do
    os.remove(path)
  end

  local thread = threads.new({ thread_main },
                             opts.listen_port, opts.upstream_host, opts.upstream_port,
                             files.arm_set, files.arm_select, files.release,
                             files.stop, files.log)
  thread:start()

  local deadline = socket.gettime() + 5
  local up = false
  while socket.gettime() < deadline do
    local c = socket.tcp()
    c:settimeout(0.2)
    local ok = c:connect("127.0.0.1", opts.listen_port)
    c:close()
    if ok then
      up = true
      break
    end
    socket.sleep(0.05)
  end
  assert(up, "pg-delay-proxy failed to listen on port " .. tostring(opts.listen_port))

  return {
    listen_port = opts.listen_port,

    -- `match` is an optional substring the statement must contain; omit it to
    -- hold the SET statements reconnect() sends on every new socket
    arm_set = function(match)
      local f = assert(io.open(files.arm_set, "w"))
      f:write(match or "")
      f:close()
    end,

    -- true while the arm file is still waiting for a SET to latch onto
    set_pending = function()
      return exists(files.arm_set)
    end,

    -- `match` is an optional substring the SELECT must contain (a node id), so
    -- an unrelated data plane cannot latch onto the hold
    arm_select = function(match)
      os.remove(files.release)
      local f = assert(io.open(files.arm_select, "w"))
      f:write(match or "")
      f:close()
    end,

    -- how many connections the proxy has parked so far
    holds = function()
      local f = io.open(files.log, "r")
      if not f then
        return 0
      end
      local content = f:read("*a")
      f:close()
      local count, pos = 0, 1
      while true do
        local from = content:find("holding clustering_data_planes SELECT", pos, true)
        if not from then
          return count
        end
        count = count + 1
        pos = from + 1
      end
    end,

    -- stop parking new SELECTs without flushing the ones already held
    disarm_select = function()
      os.remove(files.arm_select)
    end,

    release = function()
      os.remove(files.arm_select)
      touch(files.release)
    end,

    disarm = function()
      os.remove(files.arm_set)
      os.remove(files.arm_select)
      touch(files.release)
    end,

    read_log = function()
      local f = io.open(files.log, "r")
      if not f then
        return ""
      end
      local content = f:read("*a")
      f:close()
      return content
    end,

    stop = function()
      touch(files.stop)
      local c = socket.tcp()
      c:settimeout(0.2)
      pcall(c.connect, c, "127.0.0.1", opts.listen_port)
      c:close()
      pcall(thread.join, thread, 3)
      for _, path in pairs(files) do
        if path ~= files.log then
          os.remove(path)
        end
      end
    end,
  }
end


return {
  start = start,
}
