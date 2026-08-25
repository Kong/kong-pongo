-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local pb = require "pb"
local gzip = require "kong.tools.gzip"
local Queue = require "kong.tools.queue"

local inflate_gzip = gzip.inflate_gzip

local ngx = ngx
local kong = kong

local _M = {
  PRIORITY = 1001,
  VERSION = "1.0",
}


local function push_data(config, batch)
  local entry = batch[1]
  local signal_type = entry.signal_type
  local data = entry.data

  local tcpsock = ngx.socket.tcp()
  tcpsock:settimeouts(10000, 10000, 10000)

  local host, port
  if signal_type == "traces" then
    host = config.traces_host
    port = config.traces_port

  elseif signal_type == "logs" then
    host = config.logs_host
    port = config.logs_port

  else
    return false, "unknown signal type: " .. config.signal_type
  end

  if not host or not port then
    ngx.log(ngx.INFO, "no host or port configured for signal type: " .. signal_type)
    return true
  end

  local ok, err = tcpsock:connect(host, port)
  if not ok then
    return false, "connect err: ".. err .. " host: " .. host .. " port: " .. port
  end
  local _, err = tcpsock:send(data .. "\n")
  if err then
    return false, err
  end
  tcpsock:close()
  return true
end


function _M:ws_client_frame(config)
  local data = kong.websocket.client.get_frame()
  local unzipped = inflate_gzip(data)
  local path = kong.request.get_path()
  local decoded, signal_type
  if path == "/v1/analytics/tracing" then
    signal_type = "traces"
    decoded = pb.decode("opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest", unzipped)
  elseif path == "/v1/analytics/session-logs" then
    signal_type = "logs"
    decoded = pb.decode("opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest", unzipped)
  else
    return
  end

  -- ignore empty (keepalive) messages
  if (not decoded.resource_spans or #decoded.resource_spans == 0) and
     (not decoded.resource_logs or #decoded.resource_logs == 0) then
    return
  end

  ngx.ctx.plugin_id = "tcp-ws-trace-exporter"
  local queue_conf = Queue.get_plugin_params("tcp-ws-trace-exporter", config, "tcp-ws-trace-exporter")

  local handler_conf = {
    traces_host = config.traces_host,
    traces_port = config.traces_port,
    logs_host = config.logs_host,
    logs_port = config.logs_port,
  }

  Queue.enqueue(queue_conf, push_data, handler_conf, {
    signal_type = signal_type,
    data = ngx.encode_base64(unzipped),
  })
end

return _M
