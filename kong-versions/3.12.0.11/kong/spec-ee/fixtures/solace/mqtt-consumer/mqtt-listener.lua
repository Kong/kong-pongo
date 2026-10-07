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

local client = mqtt.client { uri = string.format("%s:%d", broker, port), clean = true }
client:on {
  connect = function(connack)
    if connack.rc ~= 0 then
      print("connection to broker failed:", connack:reason_string(), connack)
      return
    end
    for _, t in ipairs(topics) do
      client:subscribe { topic = t, qos = 0 }
    end
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
  end
}

mqtt.run_ioloop(client)
