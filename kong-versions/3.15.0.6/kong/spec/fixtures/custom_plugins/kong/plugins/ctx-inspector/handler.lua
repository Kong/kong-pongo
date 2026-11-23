-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Test fixture: reads ctx.KONG_ERROR_CTX and exposes the attribution fields
-- either as response headers or by writing a marker line to the error log.

local kong = kong
local ngx  = ngx


local CtxInspectorHandler = {
  PRIORITY = 0,
  VERSION  = "0.1.0",
}


function CtxInspectorHandler:header_filter(conf)
  if conf.mode == "error_log" then
    return
  end

  local ec = ngx.ctx.KONG_ERROR_CTX
  if not ec then
    return
  end
  kong.response.set_header("X-Kong-EA-Code-Origin",  ec.code_origin  or "nil")
  kong.response.set_header("X-Kong-EA-Error-Class",  ec.error_class  or "nil")
  kong.response.set_header("X-Kong-EA-Surface",      ec.execution_surface or "nil")
  kong.response.set_header("X-Kong-EA-Phase",        ec.phase        or "nil")
end


function CtxInspectorHandler:log(conf)
  if conf.mode ~= "error_log" then
    return
  end

  local ec = ngx.ctx.KONG_ERROR_CTX
  if not ec then
    return
  end

  kong.log.notice(
    "EA_CTX_LOG label=", conf.label,
    " code_origin=", ec.code_origin or "nil",
    " execution_surface=", ec.execution_surface or "nil",
    " phase=", ec.phase or "nil",
    " error_class=", ec.error_class or "nil"
  )
end


return CtxInspectorHandler
