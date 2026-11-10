-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Observes, in the stream preread phase, how the request ctx relates to the
-- connection-scoped ctx from the ssl_certificate phase. A stream-TLS test greps
-- the reported line to assert the isolation from FTI-7631.

local ngx = ngx
local kong = kong
local type = type
local tostring = tostring
local getmetatable = getmetatable


local CtxConnectionTester = {
  VERSION = "1.0",
  PRIORITY = 1000,
}


function CtxConnectionTester:preread()
  local ctx = ngx.ctx
  local conn = ctx.connection

  kong.log.notice(
    "ctx-iso",
    " has_mt=",          tostring(getmetatable(ctx) ~= nil),
    " connection_type=", type(conn),
    " nested=",          tostring((conn ~= nil and conn.connection ~= nil) or false))
end


return CtxConnectionTester
