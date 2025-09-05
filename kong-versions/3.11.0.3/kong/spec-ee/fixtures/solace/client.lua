-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local http = require "resty.http"
local cjson = require "cjson"
local assert = require "luassert"
local fmt = require "string".format

local _M = {}

local SOLACE_HOST = os.getenv("KONG_SPEC_TEST_SOLACE_SEMP_HOST") or "localhost"
local SOLACE_PORT = os.getenv("KONG_SPEC_TEST_SOLACE_SEMP_PORT_8080") or "8080"
local SOLACE_DEFAULT_VPN_NAME = "default"
local SOLACE_ADMIN_USERNAME = "admin"
local SOLACE_ADMIN_PASSWORD = "admin"

-- Keycloak configuration
local KEYCLOAK_HOST = "solace-keycloak"
local KEYCLOAK_PORT = "8080"
local KEYCLOAK_REALM = "demo"
local KEYCLOAK_CLIENT_ID = "kong-client-secret"
local KEYCLOAK_CLIENT_SECRET = "38beb963-2786-42b8-8e14-a5f391b4ba93"

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
    if res and res.status ~= 200 then
      -- Handle 400 Bad Request errors
      local error_data = cjson.decode(res.body)
      return nil, fmt("Bad Request: %s", error_data and error_data.error or "Unknown error")
    end

    assert(res, "HTTP request failed: " .. (err or "unknown error"))
    assert.res_status(status_code or 200, res, "HTTP request failed: " .. (err or "unknown error"))
    return res
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
    return cjson.decode(res.body)
  end

  -- Initialize RDP management object
  self.rdp = {
    -- Create a REST Delivery Point (RDP) for message verification
    create_for_verification = function(rdp_name, consumer_host, consumer_port, queue_name, options)
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
    end,

    -- Delete a REST Delivery Point (RDP)
    delete = function(rdp_name)
      local delete_url = string.format("config/msgVpns/%s/restDeliveryPoints/%s", self.SEMP_CONFIG.vpn_name,
        rdp_name)
      -- Use DELETE method to remove the RDP
      handle_request("DELETE", delete_url)
      -- Successfully deleted or already does not exist
      return true, nil
    end,

    -- Get RDP statistics and status
    get_stats = function(rdp_name)
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
    end,

    -- Create a complete RDP setup for testing (RDP + Consumer + Queue Binding)
    create_client = function(name, queue_name, options)
      options = options or {}
      local rdp_name = string.format("test-rdp-%s-%d", name, os.time())

      -- Use a reliable external endpoint for REST consumer testing
      local consumer_host = options.consumer_host
      local consumer_port = options.consumer_port

      -- Create RDP with complete configuration including REST consumer and queue binding
      local rdp_info, err = self.rdp.create_for_verification(rdp_name, consumer_host, consumer_port, queue_name, {
        consumer_name = options.consumer_name or "test-consumer",
        post_request_target = options.post_request_target,
        request_target = "/post",
        client_profile = "default",
      })

      if not rdp_info then
        error("Failed to setup RDP: " .. (err or "unknown error"))
      end
      -- Wait for configuration to take effect
      ngx.sleep(2)

      -- Verify RDP is operational
      local stats, stats_err = self.rdp.get_stats(rdp_name)
      if not stats then
        error("Failed to verify RDP status: " .. (stats_err or "unknown error"))
      end

      if not stats.enabled or not stats.up then
        error("RDP is not properly operational")
      end

      return {
        rdp_name = rdp_name,
        rdp_info = rdp_info,
        fallback_mode = false, -- Never use fallback mode
        cleanup = function()
          self.rdp.delete(rdp_name)
        end
      }, nil
    end
  }

  -- Initialize OAuth configuration object
  self.oauth = {
    -- Create OAuth Profile
    create_profile = function(profile_name, options)
      options = options or {}


      local keycloak_url = fmt("http://%s:%s/realms/%s", KEYCLOAK_HOST, KEYCLOAK_PORT, KEYCLOAK_REALM)
      local oauth_profile_config = {
        oauthProfileName = profile_name,
        enabled = true, -- default to true
        oauthRole = options.oauth_role or "resource-server",
        resourceServerParseAccessTokenEnabled = options.parse_access_token_enabled ~= false,
        clientId = KEYCLOAK_CLIENT_ID,
        clientSecret = KEYCLOAK_CLIENT_SECRET,
        issuer = keycloak_url,
        endpointDiscovery = fmt("%s/.well-known/openid-configuration", keycloak_url),
        endpointJwks = fmt("%s/protocol/openid-connect/certs", keycloak_url),
        resourceServerValidateAudienceEnabled = false,
        resourceServerValidateIssuerEnabled = false,
        resourceServerValidateScopeEnabled = false,
        resourceServerValidateTypeEnabled = false,
      }

      local oauth_profile_url = string.format("config/msgVpns/%s/authenticationOauthProfiles", self.SEMP_CONFIG.vpn_name)
      local res = handle_request("POST", oauth_profile_url, oauth_profile_config)

      return cjson.decode(res.body)
    end,

    -- Delete OAuth Profile
    delete_profile = function(profile_name)
      local delete_url = string.format("config/msgVpns/%s/authenticationOauthProfiles/%s", 
                                        self.SEMP_CONFIG.vpn_name, profile_name)
      handle_request("DELETE", delete_url)
    end,

    -- Create Authorization Group
    create_authorization_group = function(group_name, options)
      options = options or {}
      local auth_group_config = {
        authorizationGroupName = group_name,
        enabled = options.enabled ~= false, -- default to true
        orderAfterAuthorizationGroupName = options.order_after_group,
        orderBeforeAuthorizationGroupName = options.order_before_group,
      }

      -- Optional ACL Profile
      if options.acl_profile_name then
        auth_group_config.aclProfileName = options.acl_profile_name
      end

      -- Optional Client Profile
      if options.client_profile_name then
        auth_group_config.clientProfileName = options.client_profile_name
      end

      local auth_group_url = string.format("config/msgVpns/%s/authorizationGroups", self.SEMP_CONFIG.vpn_name)
      local res = handle_request("POST", auth_group_url, auth_group_config)

      return cjson.decode(res.body)
    end,

    -- Delete Authorization Group
    delete_authorization_group = function(group_name)
      local delete_url = string.format("config/msgVpns/%s/authorizationGroups/%s", 
                                        self.SEMP_CONFIG.vpn_name, group_name)
      handle_request("DELETE", delete_url)
    end,

    -- Configure OAuth Profile for VPN
    configure_vpn = function(oauth_profile_name)
      local vpn_oauth_config = {
        authenticationOauthDefaultProfileName = oauth_profile_name,
        authenticationOauthEnabled = true, -- default to true
      }

      local vpn_config_url = string.format("config/msgVpns/%s", self.SEMP_CONFIG.vpn_name)
      local res = handle_request("PATCH", vpn_config_url, vpn_oauth_config)
      return cjson.decode(res.body)
    end,

    -- Setup complete OAuth configuration
    setup = function(oauth_profile_name, auth_group_name, options)
      options = options or {}
      -- Step 1: Create OAuth Profile
      self.oauth.create_profile(oauth_profile_name, options)

      -- Step 2: Create Authorization Group
      local auth_group_options = {
        enabled = true,
        acl_profile_name = options.acl_profile_name or "default",
        client_profile_name = options.client_profile_name or "default",
        order_after_group = options.order_after_group,
        order_before_group = options.order_before_group,
      }

      self.oauth.create_authorization_group(auth_group_name, auth_group_options)

      -- Step 3: Configure VPN with OAuth
      self.oauth.configure_vpn(oauth_profile_name)

      return {
        oauth_profile = oauth_profile_name,
        authorization_group = auth_group_name,
        vpn_name = self.SEMP_CONFIG.vpn_name
      }
    end,

    -- Get OAuth Profile information
    get_profile = function(profile_name)
      local profile_url = string.format("config/msgVpns/%s/authenticationOauthProfiles/%s", 
                                        self.SEMP_CONFIG.vpn_name, profile_name)
      local res = handle_request("GET", profile_url)

      local data = cjson.decode(res.body)
      return data.data
    end,

    -- Get Authorization Group information
    get_authorization_group = function(group_name)
      local group_url = string.format("config/msgVpns/%s/authorizationGroups/%s", 
                                      self.SEMP_CONFIG.vpn_name, group_name)
      local res = handle_request("GET", group_url)

      local data = cjson.decode(res.body)
      return data.data
    end
  }

  -- Initialize Keycloak integration object
  self.keycloak = {
    -- Get OAuth token from Keycloak using docker exec (supports access_token and id_token)
    -- Note: Using docker exec approach allows Solace container to access Keycloak within container network
    get_token = function(username, password, options)
      options = options or {}

      local keycloak_host = options.host or KEYCLOAK_HOST
      local keycloak_port = options.port or KEYCLOAK_PORT
      local realm = options.realm or KEYCLOAK_REALM
      local client_id = options.client_id or KEYCLOAK_CLIENT_ID
      local client_secret = options.client_secret or KEYCLOAK_CLIENT_SECRET
      local token_type = options.token_type or "access_token" -- "access_token" or "id_token"
      -- Construct docker exec command
      local docker_cmd = string.format(
        'docker exec -i solace curl -s -X POST "http://%s:%s/realms/%s/protocol/openid-connect/token" ' ..
        '-H "Content-Type: application/x-www-form-urlencoded" ' ..
        '-d "client_id=%s" ' ..
        '-d "username=%s" ' ..
        '-d "password=%s" ' ..
        '-d "grant_type=password" ' ..
        '-d "scope=openid" ' ..
        '-d "client_secret=%s" | jq -r .%s',
        keycloak_host, keycloak_port, realm,
        client_id, username, password, client_secret, token_type
      )
      -- Execute the command and capture output
      local handle = io.popen(docker_cmd)
      if not handle then
        error("Failed to execute docker command")
      end

      local token = handle:read("*a")
      local success, _, exit_code = handle:close()

      if not success or exit_code ~= 0 then
        error(string.format("Docker command failed with exit code: %s", exit_code or "unknown"))
      end

      -- Trim whitespace from token
      token = token:match("^%s*(.-)%s*$")

      if not token or token == "" or token == "null" then
        error("Failed to get access token from Keycloak")
      end

      return token
    end,

    -- Get access token and return in Bearer format
    get_bearer_token = function(username, password, options)
      local access_token = self.keycloak.get_token(username, password, options)
      return "Bearer " .. access_token
    end
  }

  -- Method to close HTTP connection when client is no longer needed
  function self.close()
    if self.http_client then
      self.http_client:close()
      self.http_client = nil
    end
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
