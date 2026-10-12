-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

--- metrics-record
--
-- Fixture plugin exercising the Metrics PDK (`kong.metrics`): it registers a
-- counter, a histogram, and a gauge, and records values against them on
-- every request, so that tests can assert these custom metrics are exported
-- alongside Kong's built-in OpenTelemetry metrics. It performs no other
-- request/response processing of its own.


local requests_total = kong.metrics.counter("metrics_record.requests.total", {
  description = "Total requests processed by metrics-record",
  unit = "{request}",
})

local requests_duration = kong.metrics.histogram("metrics_record.requests.duration", {
  description = "Duration of requests processed by metrics-record",
  unit = "s",
  explicit_bounds = { 0.01, 0.05, 0.1, 0.5, 1, 5 },
})

local body_size = kong.metrics.gauge("metrics_record.body.size", {
  description = "The size of the request body processed by metrics-record",
  unit = "{By}",
  value_type = kong.metrics.VALUE_TYPE.AS_DOUBLE,
})


-- Returns the service and route attributes of the current request.
-- kong.router.get_service()/get_route() can return nil (e.g. a route with
-- no service) or an entity without a `name`, and attribute values must be
-- strings or numbers -- so a missing/unnamed entity falls back to
-- "unknown" rather than being passed through as nil.
local function get_attributes()
  local service = kong.router.get_service()
  local route = kong.router.get_route()

  local service_name = (service and type(service.name) == "string") and service.name or "unknown"
  local route_name = (route and type(route.name) == "string") and route.name or "unknown"

  return {
    ["kong.service.name"] = service_name,
    ["kong.route.name"] = route_name,
  }
end


local MetricsRecordHandler = {
  PRIORITY = 1000,
  VERSION = "0.0.1",
}


function MetricsRecordHandler:access(conf)
  ngx.ctx.start_time = ngx.now()

  requests_total:add(1, get_attributes())
  body_size:record(2.3)
end


function MetricsRecordHandler:response(conf)
  local start_time = ngx.ctx.start_time
  if not start_time then
    return
  end

  requests_duration:record(ngx.now() - start_time, get_attributes())
end


return MetricsRecordHandler
