-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local PhaseObserver = {
  VERSION = "0.1-t",
  PRIORITY = 1000,
  SELF_MARKER = "phase-observer-self",
}


function PhaseObserver:certificate(conf)
  local ctx = ngx.ctx

  ctx.phase_observer_certificate = conf.certificate_value
  ctx.phase_observer_self = self.SELF_MARKER

  return "certificate"
end


function PhaseObserver:rewrite(conf)
  local ctx = ngx.ctx
  local connection = ctx.connection

  ctx.phase_observer_rewrite = conf.rewrite_value
  ctx.phase_observer_certificate_seen_in_rewrite =
    ctx.phase_observer_certificate or
    (connection and connection.phase_observer_certificate) or
    "nil"

  return "rewrite"
end


function PhaseObserver:access(conf)
  local ctx = ngx.ctx
  local connection = ctx.connection
  local certificate = ctx.phase_observer_certificate or
                      (connection and connection.phase_observer_certificate) or
                      "nil"
  local self_marker = ctx.phase_observer_self or
                      (connection and connection.phase_observer_self) or
                      "nil"

  kong.service.request.set_header("x-phase-observer-rewrite",
                                  ctx.phase_observer_rewrite or "nil")
  kong.service.request.set_header("x-phase-observer-certificate", certificate)
  kong.service.request.set_header("x-phase-observer-certificate-from-rewrite",
                                  ctx.phase_observer_certificate_seen_in_rewrite or "nil")
  kong.service.request.set_header("x-phase-observer-self", self_marker)
  kong.service.request.set_header("x-phase-observer-access", conf.access_value)
end


return PhaseObserver
