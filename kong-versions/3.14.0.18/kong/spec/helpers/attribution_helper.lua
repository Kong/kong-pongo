-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local helpers = require "spec.helpers"
local io_open = io.open


local TIMEOUT = 10
local CUSTOM_VAULT_PATH = "./spec/fixtures/custom_vaults/?.lua;./spec/fixtures/custom_vaults/?/init.lua;;"
local BUNDLED_VAULT_SECRET = "EA_BUNDLED_VAULT_SECRET"

local DOWNSTREAM_PHASE_CASES = {
  {
    phase = "header_filter",
    prefix = "ea-hf",
    service = "ea-hf-svc",
    error_status = 500,
  },
  {
    phase = "body_filter",
    prefix = "ea-bf",
    service = "ea-bf-svc",
    error_status = 500,
  },
  {
    phase = "log",
    prefix = "ea-log",
    service = "ea-log-svc",
    error_status = 200,
  },
}


local function scrape_metrics(admin_client)
  local res = admin_client:get("/metrics")
  if not res then
    return nil
  end

  return res:read_body()
end


local function wait_for_metric(admin_client, expected)
  helpers.wait_until(function()
    local body = scrape_metrics(admin_client)
    return body and body:find(expected, nil, true)
  end, TIMEOUT)
end


local function metric_count(body, pattern)
  local str = body:match(pattern)
  return str and tonumber(str)
end


local function wait_for_count(admin_client, pattern, expected)
  helpers.wait_until(function()
    local body = scrape_metrics(admin_client)
    if not body then
      return false
    end

    local n = metric_count(body, pattern)
    return n and n >= expected
  end, TIMEOUT)
end


local function wait_for_error_log(pattern)
  helpers.wait_until(function()
    local logs = helpers.get_running_conf().nginx_err_logs
    local file = io_open(logs, "r")
    if not file then
      return false
    end

    local content = file:read("*a")
    file:close()

    return content:find(pattern, nil, true) ~= nil
  end, TIMEOUT)
end


return {
  TIMEOUT = TIMEOUT,
  CUSTOM_VAULT_PATH = CUSTOM_VAULT_PATH,
  BUNDLED_VAULT_SECRET = BUNDLED_VAULT_SECRET,
  DOWNSTREAM_PHASE_CASES = DOWNSTREAM_PHASE_CASES,
  scrape_metrics = scrape_metrics,
  wait_for_metric = wait_for_metric,
  wait_for_count = wait_for_count,
  wait_for_error_log = wait_for_error_log,
}
