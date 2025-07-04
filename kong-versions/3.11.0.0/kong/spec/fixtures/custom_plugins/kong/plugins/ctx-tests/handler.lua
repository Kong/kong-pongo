-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local ngx = ngx
local kong = kong
local type = type
local assert = assert
local subsystem = ngx.config.subsystem
local math = math
local get_phase = ngx.get_phase


local function is_nil(ctx, name)
  if ctx[name] ~= nil then
    return false, "[ctx-tests] " .. name .. " is not a nil"
  end

  return true
end


local function is_true(ctx, name)
  if ctx[name] ~= true then
    return false, "[ctx-tests] " .. name .. " is not true"
  end

  return true
end


local function is_positive_integer(ctx, name)
  local value = ctx[name]
  if type(value) ~= "number" then
    return false, "[ctx-tests] " .. name .. " is not a number"
  end

  if math.floor(value) ~= value then
    return false, "[ctx-tests] " .. name .. " is not an integer"
  end

  if value <= 0 then
    return false, "[ctx-tests] " .. name .. " is not a positive integer"
  end

  return true
end


local function is_non_negative_integer(ctx, name)
  local value = ctx[name]
  if value == 0 then
    return true
  end

  return is_positive_integer(ctx, name)
end


local function is_equal_to_start_time(ctx, name)
  local ok, err = is_positive_integer(ctx, name)
  if not ok then
    return ok, err
  end

  if ctx[name] < ctx.KONG_PROCESSING_START then
    return false, "[ctx-tests] " .. name .. " is less than the processing start"
  end

  if subsystem ~= "stream" then
    if ctx[name] ~= (ngx.req.start_time() * 1000) then
      return false, "[ctx-tests] " .. name .. " is less than the request start time"
    end
  end

  return true
end


local function is_greater_or_equal_to_start_time(ctx, name)
  local ok, err = is_positive_integer(ctx, name)
  if not ok then
    return ok, err
  end

  if ctx[name] < ctx.KONG_PROCESSING_START then
    return false, "[ctx-tests] " .. name .. " is less than the processing start"
  end

  if subsystem ~= "stream" then
    if ctx[name] < (ngx.req.start_time() * 1000) then
      return false, "[ctx-tests] " .. name .. " is less than the request start time"
    end
  end

  return true
end


local function is_greater_or_equal_to_ctx_value(ctx, name, greater_name)
  local ok, err = is_positive_integer(ctx, name)
  if not ok then
    return ok, err
  end

  ok, err = is_positive_integer(ctx, greater_name)
  if not ok then
    return ok, err
  end

  if ctx[greater_name] < ctx[name] then
    return false, "[ctx-tests] " .. name .. " is greater than " .. greater_name
  end

  return true
end


local function has_correct_proxy_latency(ctx)
  local ok, err = is_positive_integer(ctx, "KONG_BALANCER_ENDED_AT")
  if not ok then
    return ok, err
  end

  ok, err = is_non_negative_integer(ctx, "KONG_PROXY_LATENCY")
  if not ok then
    return ok, err
  end

  if ctx.KONG_BALANCER_ENDED_AT < ctx.KONG_PROCESSING_START then
    return false, "[ctx-tests] KONG_BALANCER_ENDED_AT is less than the processing start"
  end


  local latency = ctx.KONG_BALANCER_ENDED_AT - ctx.KONG_PROCESSING_START
  if ctx.KONG_PROXY_LATENCY ~= latency then
    return false, "[ctx-tests] KONG_PROXY_LATENCY is not calculated correctly"
  end

  if subsystem ~= "stream" then
    latency = ctx.KONG_BALANCER_ENDED_AT - ngx.req.start_time() * 1000
    if ctx.KONG_PROXY_LATENCY ~= latency then
      return false, "[ctx-tests] KONG_PROXY_LATENCY is not calculated correctly (request start time)"
    end
  end

  if get_phase() == "log" then
    local log = kong.log.serialize()
    if ctx.KONG_PROXY_LATENCY > log.latencies.kong then
      return false, "[ctx-tests] kong.log.serialize() latency is less than KONG_PROXY_LATENCY"
    end
  end

  return true
end


local function has_correct_waiting_time(ctx)
  local err
  local ok = is_positive_integer(ctx, "KONG_RESPONSE_START")
  if not ok then
    ok, err = is_positive_integer(ctx, "KONG_HEADER_FILTER_START")
    if not ok then
      return ok, err
    end
  end

  ok, err = is_positive_integer(ctx, "KONG_BALANCER_ENDED_AT")
  if not ok then
    return ok, err
  end

  local waiting_time = (ctx.KONG_RESPONSE_START or ctx.KONG_HEADER_FILTER_START) -
                        ctx.KONG_BALANCER_ENDED_AT

  if ctx.KONG_WAITING_TIME ~= waiting_time then
    return false, "[ctx-tests] KONG_WAITING_TIME is not calculated correctly"
  end

  return true
end


local function has_correct_receive_time(ctx)
  local ok, err = is_positive_integer(ctx, "KONG_BODY_FILTER_ENDED_AT")
  if not ok then
    return ok, err
  end

  ok, err = is_positive_integer(ctx, "KONG_HEADER_FILTER_START")
  if not ok then
    return ok, err
  end

  local receive_time = ctx.KONG_BODY_FILTER_ENDED_AT -
                      (ctx.KONG_RESPONSE_START or ctx.KONG_HEADER_FILTER_START)

  if ctx.KONG_RECEIVE_TIME ~= receive_time then
    return false, "[ctx-tests] KONG_RECEIVE_TIME is not calculated correctly"
  end

  return true
end


local CtxTests = {
  PRIORITY = -1000000,
  VERSION = "1.0",
}


local function has_correct_upstream_dns_time(ctx)
  local ok, err = is_positive_integer(ctx, "KONG_UPSTREAM_DNS_END_AT")
  if not ok then
    return ok, err
  end

  ok, err = is_positive_integer(ctx, "KONG_UPSTREAM_DNS_START")
  if not ok then
    return ok, err
  end

  local upstream_dns_time = ctx.KONG_UPSTREAM_DNS_END_AT - ctx.KONG_UPSTREAM_DNS_START

  if ctx.KONG_UPSTREAM_DNS_TIME ~= upstream_dns_time then
    return false, "[ctx-tests] KONG_UPSTREAM_DNS_TIME is not calculated correctly"
  end

  return true
end


function CtxTests:preread()
  local ctx = ngx.ctx
  assert(is_equal_to_start_time(ctx, "KONG_PROCESSING_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PROCESSING_START", "KONG_PREREAD_START"))
  assert(is_nil(ctx, "KONG_PREREAD_ENDED_AT"))
  assert(is_nil(ctx, "KONG_PREREAD_TIME"))
  assert(is_nil(ctx, "KONG_REWRITE_START"))
  assert(is_nil(ctx, "KONG_REWRITE_ENDED_AT"))
  assert(is_nil(ctx, "KONG_REWRITE_TIME"))
  assert(is_nil(ctx, "KONG_ACCESS_START"))
  assert(is_nil(ctx, "KONG_ACCESS_ENDED_AT"))
  assert(is_nil(ctx, "KONG_ACCESS_TIME"))
  assert(is_nil(ctx, "KONG_BALANCER_START"))
  assert(is_nil(ctx, "KONG_BALANCER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_BALANCER_TIME"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_START"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_END_AT"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_TIME"))
  assert(is_nil(ctx, "KONG_RESPONSE_START"))
  assert(is_nil(ctx, "KONG_RESPONSE_ENDED_AT"))
  assert(is_nil(ctx, "KONG_RESPONSE_TIME"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_START"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_START"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_LOG_START"))
  assert(is_nil(ctx, "KONG_LOG_ENDED_AT"))
  assert(is_nil(ctx, "KONG_LOG_TIME"))
  assert(is_nil(ctx, "KONG_PROXIED"))
  assert(is_nil(ctx, "KONG_PROXY_LATENCY"))
  assert(is_nil(ctx, "KONG_RESPONSE_LATENCY"))
  assert(is_nil(ctx, "KONG_WAITING_TIME"))
  assert(is_nil(ctx, "KONG_RECEIVE_TIME"))
  assert(is_positive_integer(ctx, "host_port"))
end


function CtxTests:rewrite()
  local ctx = ngx.ctx
  assert(is_equal_to_start_time(ctx, "KONG_PROCESSING_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PROCESSING_START", "KONG_REWRITE_START"))
  assert(is_greater_or_equal_to_start_time(ctx, "KONG_REWRITE_START", "KONG_REWRITE_ENDED_AT"))
  assert(is_nil(ctx, "KONG_PREREAD_START"))
  assert(is_nil(ctx, "KONG_PREREAD_ENDED_AT"))
  assert(is_nil(ctx, "KONG_PREREAD_TIME"))
  assert(is_nil(ctx, "KONG_REWRITE_ENDED_AT"))
  assert(is_nil(ctx, "KONG_REWRITE_TIME"))
  assert(is_nil(ctx, "KONG_ACCESS_START"))
  assert(is_nil(ctx, "KONG_ACCESS_ENDED_AT"))
  assert(is_nil(ctx, "KONG_ACCESS_TIME"))
  assert(is_nil(ctx, "KONG_BALANCER_START"))
  assert(is_nil(ctx, "KONG_BALANCER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_BALANCER_TIME"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_START"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_END_AT"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_TIME"))
  assert(is_nil(ctx, "KONG_RESPONSE_START"))
  assert(is_nil(ctx, "KONG_RESPONSE_ENDED_AT"))
  assert(is_nil(ctx, "KONG_RESPONSE_TIME"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_START"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_START"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_LOG_START"))
  assert(is_nil(ctx, "KONG_LOG_ENDED_AT"))
  assert(is_nil(ctx, "KONG_LOG_TIME"))
  assert(is_nil(ctx, "KONG_PROXIED"))
  assert(is_nil(ctx, "KONG_PROXY_LATENCY"))
  assert(is_nil(ctx, "KONG_RESPONSE_LATENCY"))
  assert(is_nil(ctx, "KONG_WAITING_TIME"))
  assert(is_nil(ctx, "KONG_RECEIVE_TIME"))
  assert(is_positive_integer(ctx, "host_port"))
end


function CtxTests:access(config)
  if config.buffered then
    kong.service.request.enable_buffering()
  end

  local ctx = ngx.ctx
  assert(is_equal_to_start_time(ctx, "KONG_PROCESSING_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PROCESSING_START", "KONG_REWRITE_START"))
  assert(is_greater_or_equal_to_start_time(ctx, "KONG_REWRITE_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_REWRITE_START", "KONG_REWRITE_ENDED_AT"))
  assert(is_non_negative_integer(ctx, "KONG_REWRITE_TIME"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_REWRITE_ENDED_AT", "KONG_ACCESS_START"))
  assert(is_nil(ctx, "KONG_PREREAD_START"))
  assert(is_nil(ctx, "KONG_PREREAD_ENDED_AT"))
  assert(is_nil(ctx, "KONG_PREREAD_TIME"))
  assert(is_nil(ctx, "KONG_ACCESS_ENDED_AT"))
  assert(is_nil(ctx, "KONG_ACCESS_TIME"))
  assert(is_nil(ctx, "KONG_BALANCER_START"))
  assert(is_nil(ctx, "KONG_BALANCER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_BALANCER_TIME"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_START"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_END_AT"))
  assert(is_nil(ctx, "KONG_UPSTREAM_DNS_TIME"))
  assert(is_nil(ctx, "KONG_RESPONSE_START"))
  assert(is_nil(ctx, "KONG_RESPONSE_ENDED_AT"))
  assert(is_nil(ctx, "KONG_RESPONSE_TIME"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_START"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_START"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_LOG_START"))
  assert(is_nil(ctx, "KONG_LOG_ENDED_AT"))
  assert(is_nil(ctx, "KONG_LOG_TIME"))
  assert(is_nil(ctx, "KONG_PROXIED"))
  assert(is_nil(ctx, "KONG_PROXY_LATENCY"))
  assert(is_nil(ctx, "KONG_RESPONSE_LATENCY"))
  assert(is_nil(ctx, "KONG_WAITING_TIME"))
  assert(is_nil(ctx, "KONG_RECEIVE_TIME"))
  assert(is_positive_integer(ctx, "host_port"))
end


function CtxTests:header_filter(config)
  local ctx = ngx.ctx
  assert(is_equal_to_start_time(ctx, "KONG_PROCESSING_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PROCESSING_START", "KONG_REWRITE_START"))
  assert(is_greater_or_equal_to_start_time(ctx, "KONG_REWRITE_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_REWRITE_START", "KONG_REWRITE_ENDED_AT"))
  assert(is_non_negative_integer(ctx, "KONG_REWRITE_TIME"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_REWRITE_ENDED_AT", "KONG_ACCESS_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_ACCESS_START", "KONG_ACCESS_ENDED_AT"))
  assert(is_non_negative_integer(ctx, "KONG_ACCESS_TIME"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_ACCESS_ENDED_AT", "KONG_BALANCER_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_START", "KONG_BALANCER_ENDED_AT"))
  assert(is_non_negative_integer(ctx, "KONG_BALANCER_TIME"))
  if config.buffered then
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_RESPONSE_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_RESPONSE_START", "KONG_RESPONSE_ENDED_AT"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_RESPONSE_ENDED_AT", "KONG_HEADER_FILTER_START"))
    assert(is_non_negative_integer(ctx, "KONG_RESPONSE_TIME"))
  else
    assert(is_nil(ctx, "KONG_RESPONSE_START"))
    assert(is_nil(ctx, "KONG_RESPONSE_ENDED_AT"))
    assert(is_nil(ctx, "KONG_RESPONSE_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_HEADER_FILTER_START"))
  end
  assert(is_true(ctx, "KONG_PROXIED"))
  assert(has_correct_proxy_latency(ctx))
  assert(has_correct_waiting_time(ctx))
  assert(is_nil(ctx, "KONG_PREREAD_START"))
  assert(is_nil(ctx, "KONG_PREREAD_ENDED_AT"))
  assert(is_nil(ctx, "KONG_PREREAD_TIME"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_HEADER_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_START"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_LOG_START"))
  assert(is_nil(ctx, "KONG_LOG_ENDED_AT"))
  assert(is_nil(ctx, "KONG_LOG_TIME"))
  assert(is_nil(ctx, "KONG_RESPONSE_LATENCY"))
  assert(is_nil(ctx, "KONG_RECEIVE_TIME"))
  assert(is_positive_integer(ctx, "host_port"))
end


function CtxTests:body_filter(config)
  if not ngx.arg[2] then
    return
  end

  local ctx = ngx.ctx
  assert(is_equal_to_start_time(ctx, "KONG_PROCESSING_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PROCESSING_START", "KONG_REWRITE_START"))
  assert(is_greater_or_equal_to_start_time(ctx, "KONG_REWRITE_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_REWRITE_START", "KONG_REWRITE_ENDED_AT"))
  assert(is_non_negative_integer(ctx, "KONG_REWRITE_TIME"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_REWRITE_ENDED_AT", "KONG_ACCESS_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_ACCESS_START", "KONG_ACCESS_ENDED_AT"))
  assert(is_non_negative_integer(ctx, "KONG_ACCESS_TIME"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_ACCESS_ENDED_AT", "KONG_BALANCER_START"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_START", "KONG_BALANCER_ENDED_AT"))
  assert(is_non_negative_integer(ctx, "KONG_BALANCER_TIME"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_HEADER_FILTER_START"))
  if config.buffered then
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_RESPONSE_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_RESPONSE_START", "KONG_RESPONSE_ENDED_AT"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_RESPONSE_ENDED_AT", "KONG_HEADER_FILTER_START"))
    assert(is_non_negative_integer(ctx, "KONG_RESPONSE_TIME"))
  else
    assert(is_nil(ctx, "KONG_RESPONSE_START"))
    assert(is_nil(ctx, "KONG_RESPONSE_ENDED_AT"))
    assert(is_nil(ctx, "KONG_RESPONSE_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_HEADER_FILTER_START"))
  end
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_HEADER_FILTER_START", "KONG_HEADER_FILTER_ENDED_AT"))
  assert(is_non_negative_integer(ctx, "KONG_HEADER_FILTER_TIME"))
  assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_HEADER_FILTER_ENDED_AT", "KONG_BODY_FILTER_START"))
  assert(is_true(ctx, "KONG_PROXIED"))
  assert(has_correct_proxy_latency(ctx))
  assert(has_correct_waiting_time(ctx))
  assert(is_nil(ctx, "KONG_PREREAD_START"))
  assert(is_nil(ctx, "KONG_PREREAD_ENDED_AT"))
  assert(is_nil(ctx, "KONG_PREREAD_TIME"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_ENDED_AT"))
  assert(is_nil(ctx, "KONG_BODY_FILTER_TIME"))
  assert(is_nil(ctx, "KONG_LOG_START"))
  assert(is_nil(ctx, "KONG_LOG_ENDED_AT"))
  assert(is_nil(ctx, "KONG_LOG_TIME"))
  assert(is_nil(ctx, "KONG_RESPONSE_LATENCY"))
  assert(is_nil(ctx, "KONG_RECEIVE_TIME"))
  assert(is_positive_integer(ctx, "host_port"))
end


function CtxTests:log(config)
  local ctx = ngx.ctx
  if subsystem == "stream" then
    assert(is_equal_to_start_time(ctx, "KONG_PROCESSING_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PROCESSING_START", "KONG_PREREAD_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PREREAD_START", "KONG_PREREAD_ENDED_AT"))
    assert(is_non_negative_integer(ctx, "KONG_PREREAD_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PREREAD_ENDED_AT", "KONG_BALANCER_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_START", "KONG_BALANCER_ENDED_AT"))
    assert(is_non_negative_integer(ctx, "KONG_BALANCER_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_LOG_START"))
    if (not is_nil(ctx, "KONG_UPSTREAM_DNS_START") and not is_nil(ctx, "KONG_BALANCER_ENDED_AT")) then
      assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_UPSTREAM_DNS_START", "KONG_UPSTREAM_DNS_END_AT"))
      assert(is_non_negative_integer(ctx, "KONG_UPSTREAM_DNS_TIME"))
      assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_UPSTREAM_DNS_END_AT", "KONG_LOG_START"))
      assert(has_correct_upstream_dns_time(ctx))
    end
    assert(is_true(ctx, "KONG_PROXIED"))
    assert(has_correct_proxy_latency(ctx))
    assert(is_nil(ctx, "KONG_REWRITE_START"))
    assert(is_nil(ctx, "KONG_REWRITE_ENDED_AT"))
    assert(is_nil(ctx, "KONG_REWRITE_TIME"))
    assert(is_nil(ctx, "KONG_ACCESS_START"))
    assert(is_nil(ctx, "KONG_ACCESS_ENDED_AT"))
    assert(is_nil(ctx, "KONG_ACCESS_TIME"))
    assert(is_nil(ctx, "KONG_RESPONSE_START"))
    assert(is_nil(ctx, "KONG_RESPONSE_ENDED_AT"))
    assert(is_nil(ctx, "KONG_RESPONSE_TIME"))
    assert(is_nil(ctx, "KONG_HEADER_FILTER_START"))
    assert(is_nil(ctx, "KONG_HEADER_FILTER_ENDED_AT"))
    assert(is_nil(ctx, "KONG_HEADER_FILTER_TIME"))
    assert(is_nil(ctx, "KONG_BODY_FILTER_START"))
    assert(is_nil(ctx, "KONG_BODY_FILTER_ENDED_AT"))
    assert(is_nil(ctx, "KONG_BODY_FILTER_TIME"))
    assert(is_nil(ctx, "KONG_LOG_ENDED_AT"))
    assert(is_nil(ctx, "KONG_LOG_TIME"))
    assert(is_nil(ctx, "KONG_RESPONSE_LATENCY"))

    -- TODO: ngx.var.upstream_first_byte_time?
    assert(is_nil(ctx, "KONG_WAITING_TIME"))


    -- TODO: ngx.ctx.KONG_LOG_START - (ngx.ctx.BALANCER_ENDED_AT + ngx.var.upstream_first_byte_time)?
    assert(is_nil(ctx, "KONG_RECEIVE_TIME"))

  else
    assert(is_equal_to_start_time(ctx, "KONG_PROCESSING_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_PROCESSING_START", "KONG_REWRITE_START"))
    assert(is_greater_or_equal_to_start_time(ctx, "KONG_REWRITE_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_REWRITE_START", "KONG_REWRITE_ENDED_AT"))
    assert(is_non_negative_integer(ctx, "KONG_REWRITE_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_REWRITE_ENDED_AT", "KONG_ACCESS_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_ACCESS_START", "KONG_ACCESS_ENDED_AT"))
    assert(is_non_negative_integer(ctx, "KONG_ACCESS_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_ACCESS_ENDED_AT", "KONG_BALANCER_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_START", "KONG_BALANCER_ENDED_AT"))
    assert(is_non_negative_integer(ctx, "KONG_BALANCER_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_HEADER_FILTER_START"))
    if config.buffered then
      assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_RESPONSE_START"))
      assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_RESPONSE_START", "KONG_RESPONSE_ENDED_AT"))
      assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_RESPONSE_ENDED_AT", "KONG_HEADER_FILTER_START"))
      assert(is_non_negative_integer(ctx, "KONG_RESPONSE_TIME"))
    else
      assert(is_nil(ctx, "KONG_RESPONSE_START"))
      assert(is_nil(ctx, "KONG_RESPONSE_ENDED_AT"))
      assert(is_nil(ctx, "KONG_RESPONSE_TIME"))
      assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BALANCER_ENDED_AT", "KONG_HEADER_FILTER_START"))
    end
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_HEADER_FILTER_START", "KONG_HEADER_FILTER_ENDED_AT"))
    assert(is_non_negative_integer(ctx, "KONG_HEADER_FILTER_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_HEADER_FILTER_ENDED_AT", "KONG_BODY_FILTER_START"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BODY_FILTER_START", "KONG_BODY_FILTER_ENDED_AT"))
    assert(is_non_negative_integer(ctx, "KONG_BODY_FILTER_TIME"))
    assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_BODY_FILTER_ENDED_AT", "KONG_LOG_START"))
    if (not is_nil(ctx, "KONG_UPSTREAM_DNS_START") and not is_nil(ctx, "KONG_BALANCER_ENDED_AT")) then
      assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_UPSTREAM_DNS_START", "KONG_UPSTREAM_DNS_END_AT"))
      assert(is_non_negative_integer(ctx, "KONG_UPSTREAM_DNS_TIME"))
      assert(is_greater_or_equal_to_ctx_value(ctx, "KONG_UPSTREAM_DNS_END_AT", "KONG_LOG_START"))
      assert(has_correct_upstream_dns_time(ctx))
    end
    assert(is_true(ctx, "KONG_PROXIED"))
    assert(has_correct_proxy_latency(ctx))
    assert(has_correct_waiting_time(ctx))
    assert(has_correct_receive_time(ctx))
    assert(is_nil(ctx, "KONG_PREREAD_START"))
    assert(is_nil(ctx, "KONG_PREREAD_ENDED_AT"))
    assert(is_nil(ctx, "KONG_PREREAD_TIME"))
    assert(is_nil(ctx, "KONG_LOG_ENDED_AT"))
    assert(is_nil(ctx, "KONG_LOG_TIME"))
  end

  assert(is_positive_integer(ctx, "host_port"))
end


return CtxTests
