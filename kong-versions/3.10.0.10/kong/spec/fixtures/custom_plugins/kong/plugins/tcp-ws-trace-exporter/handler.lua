-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local pb = require "pb"
local gzip = require("kong.tools.gzip")
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
  local data = entry.data

  local tcpsock = ngx.socket.tcp()
  tcpsock:settimeouts(10000, 10000, 10000)
  local ok, err = tcpsock:connect(config.host, config.port)
  if not ok then
    kong.log.err("connect err: ".. err .. " host: " .. config.host .. " port: " .. config.port)
    return
  end
  local _, err = tcpsock:send(data .. "\n")
  if err then
    kong.log.err(err)
  end
  tcpsock:close()
  return true
end


function _M:ws_client_frame(config)
  local data = kong.websocket.client.get_frame()
  local unzipped = inflate_gzip(data)
  local decoded = pb.decode("opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest", unzipped)

  -- ignore empty (keepalive) messages
  if #decoded.resource_spans == 0 then
    return
  end

  ngx.ctx.plugin_id = "tcp-ws-trace-exporter"
  local queue_conf = Queue.get_plugin_params("tcp-ws-trace-exporter", config, "tcp-ws-trace-exporter")

  local handler_conf = {
    host = config.host,
    port = config.port,
  }

  Queue.enqueue(queue_conf, push_data, handler_conf, {
    data = ngx.encode_base64(unzipped),
  })
end

return _M
