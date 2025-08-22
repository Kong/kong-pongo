-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local http = require "resty.http"
local cjson = require "cjson"
local assert = require "luassert"

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

local function get_auth_header(semp_config)
  return "Basic " .. ngx.encode_base64(semp_config.username .. ":" .. semp_config.password)
end

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

  -- Create a shared HTTP client instance
  self.http_client = http.new()

  -- Helper function to ensure HTTP client is ready
  local function get_http_client()
    if not self.http_client then
      self.http_client = http.new()
    end
    return self.http_client
  end

  local function handle_request(method, path, body, status_code)
    local httpc = get_http_client()
    local url = string.format("http://%s:%s/SEMP/v2/%s", self.SEMP_CONFIG.host, self.SEMP_CONFIG.port, path)

    local res, err = httpc:request_uri(url, {
      method = method,
      body = body and cjson.encode(body) or nil,
      headers = {
        ["Authorization"] = get_auth_header(self.SEMP_CONFIG),
        ["Content-Type"] = "application/json",
        ["Accept"] = "application/json"
      }
    })

    assert(res, "HTTP request failed: " .. (err or "unknown error"))
    assert.res_status(200 or status_code, res, "HTTP request failed: " .. (err or "unknown error"))
    return res
  end

  -- Count messages from queue
  function self.count_msg_from_queue(queue_name, timeout)
    -- SEMP V2 monitor API for viewing queue messages
    local monitor_url = string.format("monitor/msgVpns/%s/queues/%s/msgs", self.SEMP_CONFIG.vpn_name, queue_name)
    local res = handle_request("GET", monitor_url)
    -- Parse the response body to get the message count
    local data = cjson.decode(res.body)

    return data and data.meta.count or nil
  end

  -- Delete queue
  function self.delete_queue(queue_name)
    local delete_url = string.format("config/msgVpns/%s/queues/%s", self.SEMP_CONFIG.vpn_name, queue_name)
    handle_request("DELETE", delete_url)
  end

  -- Create queue
  function self.create_queue(queue_name, options)
    options = options or {}

    local queue_config = {
      queueName = queue_name,
      accessType = options.access_type or "non-exclusive",
      permission = "consume",
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

    local create_queue_url = string.format("config/msgVpns/%s/queues", self.SEMP_CONFIG.vpn_name)

    local res = handle_request("POST", create_queue_url, queue_config)
    return cjson.decode(res.body)
  end

  -- Add topic subscription to queue
  function self.add_queue_subscription(queue_name, topic)
    local subscription_url = string.format("config/msgVpns/%s/queues/%s/subscriptions", self.SEMP_CONFIG.vpn_name, queue_name)
    local res = handle_request("POST", subscription_url, {
      subscriptionTopic = topic
    })

    -- ===============================
    -- REST Delivery Point (RDP) Management Functions
    -- ===============================

    -- Create a REST Delivery Point (RDP) for message verification
    function self.create_rdp_for_verification(rdp_name, consumer_host, consumer_port, queue_name, options)
      options = options or {}

      -- Step 1: Create the RDP
      local rdp_config = {
        restDeliveryPointName = rdp_name,
        clientProfileName = options.client_profile or "default",
        enabled = true,
      }

      local create_rdp_url = string.format("config/msgVpns/%s/restDeliveryPoints", self.SEMP_CONFIG.vpn_name)
      handle_request("POST", create_rdp_url, rdp_config)

      -- Step 2: Create REST Consumer within the RDP with correct configuration
      local consumer_name = options.consumer_name or "test-consumer"

      -- Use proper REST consumer configuration based on Solace documentation
      local consumer_config = {
        restConsumerName = consumer_name,
        remoteHost = consumer_host or "localhost",
        remotePort = consumer_port or "8001",
        enabled = true,
        tlsEnabled = false,
      }

      local create_consumer_url = string.format("config/msgVpns/%s/restDeliveryPoints/%s/restConsumers",
        self.SEMP_CONFIG.vpn_name, rdp_name)
      handle_request("POST", create_consumer_url, consumer_config)
      -- Step 3: Create Queue Binding if queue is specified
      if queue_name then
        local binding_config = {
          -- Use a proper post request target for the queue binding
          postRequestTarget = options.post_request_target or "/webhook/consume",
          requestTargetEvaluation = "none",
        }

        local create_binding_url = string.format("config/msgVpns/%s/restDeliveryPoints/%s/queueBindings/%s",
          self.SEMP_CONFIG.vpn_name, rdp_name, queue_name)
        handle_request("PUT", create_binding_url, binding_config)
      end

      return {
        rdp_name = rdp_name,
        consumer_name = consumer_name,
        queue_binding = queue_name,
        host = consumer_host,
        port = consumer_port
      }, nil
    end

    -- Delete a REST Delivery Point (RDP)
    function self.delete_rdp(rdp_name)
      local delete_url = string.format("config/msgVpns/%s/restDeliveryPoints/%s", self.SEMP_CONFIG.vpn_name,
        rdp_name)
      -- Use DELETE method to remove the RDP
      handle_request("DELETE", delete_url)
      -- Successfully deleted or already does not exist
      print("Deleted RDP: " .. rdp_name)
      return true, nil
    end

    -- Get RDP statistics and status
    function self.get_rdp_stats(rdp_name)
      -- Get RDP status and stats
      local stats_url = string.format("monitor/msgVpns/%s/restDeliveryPoints/%s", self.SEMP_CONFIG.vpn_name,
        rdp_name)

      local res = handle_request("GET", stats_url)
      local data = cjson.decode(res.body)
      local rdp_data = data.data

      -- Also get consumer stats if available
      local consumer_stats_url = string.format("monitor/msgVpns/%s/restDeliveryPoints/%s/restConsumers",
        self.SEMP_CONFIG.vpn_name, rdp_name)
      local consumer_res = handle_request("GET", consumer_stats_url)

      local consumer_data = {}
      if consumer_res and consumer_res.status == 200 then
        local consumer_response = cjson.decode(consumer_res.body)
        if consumer_response and consumer_response.data then
          consumer_data = consumer_response.data
        end
      end

      return {
        rdp_name = rdp_data.restDeliveryPointName,
        enabled = rdp_data.enabled,
        up = rdp_data.up,
        client_profile = rdp_data.clientProfileName,
        consumers = consumer_data,
        stats = {
          rx_msgs = rdp_data.rxMsgCount or 0,
          tx_msgs = rdp_data.txMsgCount or 0,
          rx_bytes = rdp_data.rxByteCount or 0,
          tx_bytes = rdp_data.txByteCount or 0,
        }
      }, nil
    end

    -- Create a complete RDP setup for testing (RDP + Consumer + Queue Binding)
    function self.create_rdp_client(name, queue_name, options)
      options = options or {}
      local rdp_name = string.format("test-rdp-%s-%d", name, os.time())

      -- Use a reliable external endpoint for REST consumer testing
      local consumer_host = options.consumer_host
      local consumer_port = options.consumer_port

      -- Create RDP with complete configuration including REST consumer and queue binding
      local rdp_info, err = self.create_rdp_for_verification(rdp_name, consumer_host, consumer_port, queue_name, {
        consumer_name = options.consumer_name or "test-consumer",
        post_request_target = options.post_request_target,
        request_target = "/post",
        client_profile = "default",
      })

      if not rdp_info then
        print("Failed to setup RDP: " .. (err or "unknown error"))
      end

      print("RDP setup completed successfully!")
      print("  - RDP Name: " .. rdp_name)
      print("  - Consumer: " .. rdp_info.consumer_name)
      print("  - Queue Binding: " .. (rdp_info.queue_binding or "none"))
      -- Wait for configuration to take effect
      ngx.sleep(2)

      -- Verify RDP is operational
      local stats, stats_err = self.get_rdp_stats(rdp_name)
      if not stats then
        print("Failed to verify RDP status: " .. (stats_err or "unknown error"))
      end

      print(string.format("RDP %s is %s and %s", rdp_name,
        stats.enabled and "enabled" or "disabled",
        stats.up and "up" or "down"))

      if not stats.enabled or not stats.up then
        print("RDP is not properly operational")
      end

      return {
        rdp_name = rdp_name,
        rdp_info = rdp_info,
        fallback_mode = false, -- Never use fallback mode
        cleanup = function()
          print("Cleaning up RDP: " .. rdp_name)
          self.delete_rdp(rdp_name)
        end
      }, nil
    end

    -- Method to close HTTP connection when client is no longer needed
    function self.close()
      if self.http_client then
        self.http_client:close()
        self.http_client = nil
      end
    end

    return cjson.decode(res.body)
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
