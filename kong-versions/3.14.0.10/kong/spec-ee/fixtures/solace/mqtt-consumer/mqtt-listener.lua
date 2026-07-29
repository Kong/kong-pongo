-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local mqtt = require("mqtt")
local os = require("os")

local broker = os.getenv("MQTT_BROKER") or "solace"
local port = tonumber(os.getenv("MQTT_PORT") or "1883")
local topics_raw = os.getenv("MQTT_TOPICS") or "example/topic,tutorial/topic,test/topic"
local log_file = os.getenv("LOG_FILE") or "/var/log/mqtt/solace_mqtt.log"
-- Sentinel file written once *every* topic subscription has been SUBACKed by
-- the broker. The test fixture (solace_helper.start) polls for this file
-- before tests run, so the first published message can never race the
-- subscriber registration on the Solace broker. Without this, MQTT QoS-0
-- publishes that occur before SUBSCRIBE+SUBACK are silently dropped and the
-- test sees an empty/missing log file (cf. flake fix on tcp/01-basic_spec).
local ready_file = (log_file:match("(.*)/[^/]+$") or "/var/log/mqtt") .. "/solace_mqtt.ready"

local topics = {}
for t in topics_raw:gmatch("([^,]+)") do topics[#topics+1] = t end

-- Ensure log directory exists and create log file if needed
local function ensure_log_file(filepath)
  -- Extract directory from filepath
  local dir = filepath:match("(.*/)")
  if dir then
    -- Create directory if it doesn't exist
    os.execute("mkdir -p " .. dir)
  end

  -- Try to open file for append, create if doesn't exist
  local file = io.open(filepath, "a")
  if not file then
    -- If still can't open, try to create the file
    os.execute("touch " .. filepath)
    file = io.open(filepath, "a")
  end
  return file
end

local function write_ready_marker()
  -- Remove any stale ready marker from a previous run before signalling.
  os.remove(ready_file)
  local f = io.open(ready_file, "w")
  if f then
    f:write(os.date("!%Y-%m-%dT%H:%M:%SZ") .. "\n")
    f:close()
  end
end

-- Best-effort: clear any stale ready marker on process start so the test
-- fixture never picks up an old "ready" from a previous container lifecycle.
os.remove(ready_file)

local expected_subacks = #topics
local seen_subacks = 0

-- `reconnect = true` keeps the ioloop alive after a transient disconnect:
-- without it, a single `close` event removes the client from the ioloop
-- and the Lua process exits (then the container's `restart: unless-stopped`
-- kicks in, but only after an indeterminate delay). With reconnect=true,
-- luamqtt re-runs `start_connecting()` on every iteration where there is no
-- connection, which in turn fires this `connect` handler again, which
-- re-issues SUBSCRIBE for every topic and writes a fresh ready marker once
-- all SUBACKs arrive. This is the critical guarantee tests rely on: even if
-- the Solace broker briefly drops the MQTT session during a busy strategy
-- lazy_setup (e.g. Kong restart under postgres), the marker is re-asserted.
local client = mqtt.client {
  uri = string.format("%s:%d", broker, port),
  clean = true,
  reconnect = true,
}
client:on {
  connect = function(connack)
    if connack.rc ~= 0 then
      print("connection to broker failed:", connack:reason_string(), connack)
      return
    end
    print("mqtt-listener connected to broker; subscribing to " .. tostring(#topics) .. " topic(s)")
    seen_subacks = 0
    for _, t in ipairs(topics) do
      client:subscribe {
        topic = t,
        qos = 0,
        callback = function()
          seen_subacks = seen_subacks + 1
          if seen_subacks >= expected_subacks then
            write_ready_marker()
            print("mqtt-listener: all SUBACKs received; ready marker written")
          end
        end,
      }
    end
  end,
  error = function(err)
    -- Log broker errors (e.g. PINGRESP timeout, malformed packet) so post-
    -- mortem CI log inspection can attribute marker churn to a specific
    -- cause. Recovery is handled by the `close` callback below (marker
    -- removal) and the reconnect loop (which reissues subscriptions).
    print("mqtt-listener error:", tostring(err))
  end,
  message = function(pkt)
    local logfile = ensure_log_file(log_file)
    assert(logfile, "Failed to open or create log file: " .. log_file)

    local ts = os.date("!%Y-%m-%dT%H:%M:%SZ")

    -- Create detailed log entry with all pkt information
    local log_data = {
      timestamp = ts,
      topic = pkt.topic or "unknown",
      payload = pkt.payload or "",
      qos = pkt.qos or 0,
      retain = pkt.retain or false,
      dup = pkt.dup or false,
      packet_id = pkt.packet_id or "none"
    }

    -- Format detailed log line
    local line = string.format("[%s] Topic: %s | QoS: %d | Retain: %s | DUP: %s | PacketID: %s | Payload: %s\n",
      log_data.timestamp, log_data.topic, log_data.qos,
      tostring(log_data.retain), tostring(log_data.dup),
      tostring(log_data.packet_id), log_data.payload)

    logfile:write(line); logfile:flush()
    logfile:close() -- Close file after each write to ensure it's recreated if deleted
  end,
  close = function(conn)
    -- Treat connection loss as "no longer ready"; the broker subscription
    -- state goes away with the session (clean = true). The ready marker
    -- will be rewritten when the reconnect's full SUBACK set arrives.
    os.remove(ready_file)
    print("mqtt-listener connection closed:", tostring(conn and conn.close_reason or "unknown"))
  end,
}

mqtt.run_ioloop(client)
