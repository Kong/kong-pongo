-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local http = require "resty.http"
local cjson = require "cjson"

local _M = {}

local SOLACE_HOST = os.getenv("KONG_SPEC_TEST_SOLACE_SEMP_HOST") or "localhost"
local SOLACE_PORT = os.getenv("KONG_SPEC_TEST_SOLACE_SEMP_PORT_8080") or "8080"
local SOLACE_DEFAULT_VPN_NAME = "default"
local SOLACE_ADMIN_USERNAME = "admin"
local SOLACE_ADMIN_PASSWORD = "admin"

-- Default Solace SEMP API configuration
local DEFAULT_SEMP_CONFIG = {
  host = SOLACE_HOST,
  port = tonumber(SOLACE_PORT),
  username = SOLACE_ADMIN_USERNAME,
  password = SOLACE_ADMIN_PASSWORD,
  vpn_name = SOLACE_DEFAULT_VPN_NAME,
}

-- Create a new Solace client instance
function _M.new(config)
  local self = {}

  -- Merge user-provided configuration with defaults
  if config then
    self.SEMP_CONFIG = {}
    for k, v in pairs(DEFAULT_SEMP_CONFIG) do
      self.SEMP_CONFIG[k] = config[k] or v
    end
  else
    self.SEMP_CONFIG = DEFAULT_SEMP_CONFIG
  end

  -- Count messages from queue
  function self.count_msg_from_queue(queue_name, timeout)
    local client = http.new()

    -- SEMP V2 monitor API for viewing queue messages
    local monitor_url = string.format("http://%s:%s/SEMP/v2/monitor/msgVpns/%s/queues/%s/msgs",
      self.SEMP_CONFIG.host, self.SEMP_CONFIG.port, self.SEMP_CONFIG.vpn_name, queue_name)
    local res, err = client:request_uri(monitor_url, {
      method = "GET",
      headers = {
        ["Authorization"] = "Basic " .. ngx.encode_base64(self.SEMP_CONFIG.username .. ":" .. self.SEMP_CONFIG.password),
      }
    })

    if not res then
      return nil, "Failed to connect to Solace: " .. (err or "unknown error")
    end

    if res.status ~= 200 then
      return nil, "Failed to count messages: HTTP " .. res.status .. ", " .. (res.body or "")
    end
    -- Parse the response body to get the message count
    local data = cjson.decode(res.body)

    return data and data.meta.count or nil
  end

  -- Delete queue
  function self.delete_queue(queue_name)
    local client = http.new()

    local delete_url = string.format("http://%s:%s/SEMP/v2/config/msgVpns/%s/queues/%s",
      self.SEMP_CONFIG.host, self.SEMP_CONFIG.port, self.SEMP_CONFIG.vpn_name, queue_name)

    client:request_uri(delete_url, {
      method = "DELETE",
      headers = {
        ["Authorization"] = "Basic " .. ngx.encode_base64(self.SEMP_CONFIG.username .. ":" .. self.SEMP_CONFIG.password)
      }
    })
  end

  -- Create queue
  function self.create_queue(queue_name, options)
    local client = http.new()
    options = options or {}

    local queue_config = {
      queueName = queue_name,
      accessType = options.access_type or "non-exclusive",
      maxMsgSpoolUsage = options.max_spool_usage or 1000,
      ingressEnabled = options.ingress_enabled == nil and true or options.ingress_enabled,
      egressEnabled = options.egress_enabled == nil and true or options.egress_enabled,
    }

    if options.owner then
      queue_config.owner = options.owner
    end

    if options.permission then
      queue_config.permission = options.permission
    end

    local create_queue_url = string.format("http://%s:%s/SEMP/v2/config/msgVpns/%s/queues",
      self.SEMP_CONFIG.host, self.SEMP_CONFIG.port, self.SEMP_CONFIG.vpn_name)

    local res, err = client:request_uri(create_queue_url, {
      method = "POST",
      headers = {
        ["Authorization"] = "Basic " .. ngx.encode_base64(self.SEMP_CONFIG.username .. ":" .. self.SEMP_CONFIG.password),
        ["Content-Type"] = "application/json"
      },
      body = cjson.encode(queue_config)
    })

    if not res then
      return nil, "Failed to connect to Solace: " .. (err or "unknown error")
    end

    if res.status < 200 or res.status > 299 then
      return nil, "Failed to create queue: HTTP " .. res.status .. ", " .. (res.body or "")
    end

    return cjson.decode(res.body), nil
  end

  -- Add topic subscription to queue
  function self.add_queue_subscription(queue_name, topic)
    local client = http.new()

    local subscription_url = string.format("http://%s:%s/SEMP/v2/config/msgVpns/%s/queues/%s/subscriptions",
      self.SEMP_CONFIG.host, self.SEMP_CONFIG.port, self.SEMP_CONFIG.vpn_name, queue_name)

    local res, err = client:request_uri(subscription_url, {
      method = "POST",
      headers = {
        ["Authorization"] = "Basic " .. ngx.encode_base64(self.SEMP_CONFIG.username .. ":" .. self.SEMP_CONFIG.password),
        ["Content-Type"] = "application/json"
      },
      body = cjson.encode({
        subscriptionTopic = topic
      })
    })

    if not res then
      return nil, "Failed to connect to Solace: " .. (err or "unknown error")
    end

    if res.status < 200 or res.status > 299 then
      return nil, "Failed to add subscription: HTTP " .. res.status .. ", " .. (res.body or "")
    end

    return cjson.decode(res.body), nil
  end

  return self, self.SEMP_CONFIG
end

-- For backward compatibility, create a default instance
local default_client, DEFAULT_CONFIG = _M.new()

-- Copy default instance methods to module level
for k, v in pairs(default_client) do
  _M[k] = v
end

-- Expose configuration
_M.SEMP_CONFIG = DEFAULT_CONFIG

return _M
