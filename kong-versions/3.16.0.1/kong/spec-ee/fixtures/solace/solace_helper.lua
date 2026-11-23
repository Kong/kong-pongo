-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local pl_file = require("pl.file")
local pl_path = require("pl.path")
local assert = require("luassert")

local _M = {}

local SOLACE_PROJECT_NAME = "solace"
local SKIP_SOLACE_START = os.getenv("SKIP_SOLACE_START") or false

-- Execute shell command and return output/error
local function execute_command(cmd)
  local handle = io.popen(cmd .. " 2>&1")
  if not handle then
    return nil, "Failed to execute command: " .. cmd
  end

  local result = handle:read("*a")
  local success, _, code = handle:close()

  if not success then
    return nil, "Command failed with code " .. (code or "unknown") .. ": " .. (result or "")
  end

  return result, nil
end

-- Wait until the MQTT consumer (mqtt-listener.lua) has fully subscribed to
-- all of its topics on the Solace broker. The consumer writes
-- `mqtt-consumer/logs/solace_mqtt.ready` after every SUBACK has been
-- received. The previous behaviour started tests as soon as the Solace
-- container was healthy, which races MQTT SUBSCRIBE+SUBACK on busy ARC
-- runners: a QoS-0 publish to a topic with no subscriber yet is silently
-- dropped, leaving the test's `assert.eventually(... log file ...)` to
-- poll a never-created log file and time out.
--
-- This helper is exposed as `_M.wait_for_mqtt_subscriber` so describe-block
-- lazy_setups that exercise MQTT can re-confirm readiness after Kong has
-- restarted (which can take 60+ seconds, long enough for an idle MQTT
-- keep-alive cycle to expire and the broker to evict the subscription).
local function wait_for_mqtt_subscriber(env_vars, timeout_s)
  local logs_path = env_vars and env_vars["KONG_SPEC_TEST_SOLACE_MQTT_LOGS_PATH"]
  if not logs_path then
    return
  end
  local ready_path = logs_path .. "/solace_mqtt.ready"
  local deadline = os.time() + (timeout_s or 60)
  while os.time() < deadline do
    if pl_path.exists(ready_path) then
      return true
    end
    -- 200ms poll cadence; the consumer SUBACKs typically arrive within a
    -- couple of seconds of (re)connect.
    os.execute("sleep 0.2")
  end
  -- Best-effort: don't fail setup if the marker never arrives (e.g. the
  -- consumer image is older and lacks the marker). Tests will still
  -- exercise their own polling timeouts.
  return false
end

-- Public re-export so tests can re-poll the marker mid-suite (after a Kong
-- restart, between strategy phases, etc.).
_M.wait_for_mqtt_subscriber = wait_for_mqtt_subscriber

-- Start Solace services using Docker Compose
function _M.start()
  local original_dir = pl_path.currentdir()
  local solace_dir = pl_path.join(original_dir, "spec-ee/fixtures/solace")

  if not pl_path.exists(solace_dir) then
    return nil, "Solace fixtures directory not found: " .. solace_dir
  end

  -- Change directory to solace fixtures
  if not pl_path.chdir(solace_dir) then
    return nil, "Failed to change directory to: " .. solace_dir
  end
  if not SKIP_SOLACE_START and not _M.is_running() then
    local _, err = execute_command("source ./setup-solace.sh")
    if err then
      pl_path.chdir(original_dir)
      return nil, "Failed to start Solace services: " .. err
    end
  end

  -- Load environment variables from .env.solace
  local env_file_path = pl_path.join(solace_dir, ".env.solace")

  -- In CI environment, also check if file exists in GitHub workspace
  if not pl_path.exists(env_file_path) then
    local github_workspace = os.getenv("GITHUB_WORKSPACE")
    if github_workspace then
      local github_env_path = pl_path.join(github_workspace, "spec-ee/fixtures/solace/.env.solace")
      if pl_path.exists(github_env_path) then
        env_file_path = github_env_path
      end
    end
  end

  if not pl_path.exists(env_file_path) then
    pl_path.chdir(original_dir)
    return nil, "Solace environment file not found: " .. env_file_path
  end

  local env_content = pl_file.read(env_file_path)
  if not env_content then
    pl_path.chdir(original_dir)
    return nil, "Failed to read Solace environment file"
  end

  -- Parse environment variables and return them as a table
  local env_vars = {}
  for line in env_content:gmatch("[^\r\n]+") do
    local key, value = line:match("^export%s+([%w_]+)=(.+)$")
    if key and value then
      -- Remove quotes if present
      value = value:gsub("^['\"](.+)['\"]$", "%1")
      env_vars[key] = value
    end
  end

  -- Change back to original directory
  pl_path.chdir(original_dir)

  -- Block until the MQTT consumer is fully subscribed (or timeout). This
  -- prevents the first MQTT-topic publish of a test run from being lost
  -- to a SUBSCRIBE race.
  wait_for_mqtt_subscriber(env_vars, 60)

  return env_vars, nil
end

-- Stop Solace services
function _M.stop()
  if SKIP_SOLACE_START then
    return true
  end

  local original_dir = pl_path.currentdir()
  local solace_dir = pl_path.join(original_dir, "spec-ee/fixtures/solace")

  if not pl_path.exists(solace_dir) then
    return true -- Already cleaned up or never existed
  end

  -- Change directory to solace fixtures
  if not pl_path.chdir(solace_dir) then
    return nil, "Failed to change directory to: " .. solace_dir
  end

  -- Stop and remove Docker Compose services
  local success, err = execute_command("docker compose -p " .. SOLACE_PROJECT_NAME .. " -f solace.yaml down")

  -- Remove .env.solace file if it exists
  local env_file_path = pl_path.join(solace_dir, ".env.solace")
  if pl_path.exists(env_file_path) then
    local remove_success = os.remove(env_file_path)
    if not remove_success then
      -- Log warning but don't fail the whole operation
      error("Warning: Failed to remove .env.solace file: " .. env_file_path)
    end
  end

  -- Change back to original directory
  pl_path.chdir(original_dir)

  if err then
    return nil, "Failed to stop Solace services: " .. err
  end

  return success, nil
end

-- Check if Solace services are running
function _M.is_running()
  local result, err = execute_command("docker compose -p " .. SOLACE_PROJECT_NAME .. " ps -q")
  if err then
    return false, "Failed to check Solace status: " .. err
  end

  -- If there are container IDs in the output, services are running
  return not (not result or result:match("^%s*$")), nil
end

-- Return true when `line` matches every entry in `patterns`.
local function line_matches_all(line, patterns)
  if not patterns then
    return true
  end
  for _, pattern in ipairs(patterns) do
    if not string.find(line, pattern.pattern) then
      return false
    end
  end
  return true
end

-- Helper function to read and verify log files.
--
-- The webhook/MQTT consumers append every message to one shared log file that
-- lives for the whole describe block. Reading only the last line races the RDP
-- delivery: the target message can arrive out of order, or a later test's
-- message can overwrite the "last line" the caller expects. Each test uses a
-- unique timestamp token in its expected patterns, so we scan the whole file
-- for the line that matches ALL expected patterns. The unexpected patterns are
-- then checked against that SAME line, which preserves the original
-- "message X must not contain Y" semantics.
function _M.check_logs_handler(path, expected_patterns, unexpected_patterns)
  local log_file = io.open(path, "r")
  if not log_file then
    return false, "Log file not found: " .. path
  end

  local matched_line
  local saw_any_line = false
  for line in log_file:lines() do
    if #line > 0 then
      saw_any_line = true
      if line_matches_all(line, expected_patterns) then
        matched_line = line
        break
      end
    end
  end
  log_file:close()

  if not saw_any_line then
    return false, "No content found in " .. path .. " log"
  end

  if not matched_line then
    -- Report the first expected pattern for a useful failure message.
    local first = expected_patterns and expected_patterns[1]
    if first then
      return false, first.message or ("Pattern not found: " .. first.pattern)
    end
    return false, "No matching log line found in " .. path
  end

  if unexpected_patterns then
    for _, pattern in ipairs(unexpected_patterns) do
      if string.find(matched_line, pattern.pattern) then
        return false, pattern.message or ("Unexpected pattern found: " .. pattern.pattern)
      end
    end
  end

  return true, matched_line
end

-- Helper function to read and verify webhook log files
function _M.check_webhook_consumer_logs(log_path, expected_patterns, unexpected_patterns)
  return _M.check_logs_handler(log_path, expected_patterns, unexpected_patterns)
end

-- Helper function to read and verify MQTT consumer log files
function _M.check_mqtt_consumer_logs(log_path, expected_patterns, unexpected_patterns)
  return _M.check_logs_handler(log_path, expected_patterns, unexpected_patterns)
end

-- Poll timeout for consumer log verification. The RDP delivers the message to
-- the webhook/MQTT consumer asynchronously. On busy CI runners this can take
-- longer than the previous fixed 5s window, so the default is wider and can be
-- raised further with an environment variable when a runner is overloaded.
_M.LOG_VERIFY_TIMEOUT = tonumber(os.getenv("KONG_SPEC_TEST_SOLACE_LOG_VERIFY_TIMEOUT")) or 15

-- Wait until the webhook consumer log contains a line that matches every
-- expected pattern (and, on that same line, none of the unexpected patterns).
-- Pass `unexpected_patterns` as nil when there are no negative checks.
function _M.wait_for_webhook_log(log_path, expected_patterns, unexpected_patterns, message)
  assert.eventually(function()
    return _M.check_webhook_consumer_logs(log_path, expected_patterns, unexpected_patterns)
  end).with_timeout(_M.LOG_VERIFY_TIMEOUT).is_truthy(message or "webhook consumer log verification failed")
end

-- Same as wait_for_webhook_log, for the MQTT consumer log.
function _M.wait_for_mqtt_log(log_path, expected_patterns, unexpected_patterns, message)
  assert.eventually(function()
    return _M.check_mqtt_consumer_logs(log_path, expected_patterns, unexpected_patterns)
  end).with_timeout(_M.LOG_VERIFY_TIMEOUT).is_truthy(message or "MQTT consumer log verification failed")
end


function _M.oauth2_token_rotator_http_mock(opts)
  return string.format([[
    server {
      server_name %s;
      listen %d;

      default_type 'application/json';

      location = /token {
        content_by_lua_block {
          local cjson = require "cjson"
          local http = require "resty.http"
          local dict = ngx.shared.kong
          local request_count, err = dict:incr(%q, 1, 0)

          if not request_count then
            ngx.status = 500
            ngx.say(cjson.encode({ error = err or "failed to increment token request counter" }))
            return
          end

          if request_count == 1 then
            ngx.say(cjson.encode({
              access_token = "expired-invalid-token",
              token_type = "Bearer",
              expires_in = 3600,
            }))
            return
          end

          ngx.req.read_body()

          local res, request_err = http.new():request_uri(%q, {
            method = "POST",
            body = ngx.req.get_body_data(),
            headers = {
              ["Content-Type"] = ngx.req.get_headers()["content-type"] or "application/x-www-form-urlencoded",
            },
          })

          if not res then
            ngx.status = 500
            ngx.say(cjson.encode({ error = request_err or "failed to fetch token from Keycloak" }))
            return
          end

          ngx.status = res.status
          ngx.say(res.body)
        }
      }

      location = /token-expiring {
        content_by_lua_block {
          local cjson = require "cjson"
          local http = require "resty.http"
          local dict = ngx.shared.kong
          local request_count, err = dict:incr(%q, 1, 0)

          if not request_count then
            ngx.status = 500
            ngx.say(cjson.encode({ error = err or "failed to increment expiring token request counter" }))
            return
          end

          ngx.req.read_body()

          local res, request_err = http.new():request_uri(%q, {
            method = "POST",
            body = ngx.req.get_body_data(),
            headers = {
              ["Content-Type"] = ngx.req.get_headers()["content-type"] or "application/x-www-form-urlencoded",
            },
          })

          if not res then
            ngx.status = 500
            ngx.say(cjson.encode({ error = request_err or "failed to fetch expiring token from Keycloak" }))
            return
          end

          local payload = cjson.decode(res.body)
          if not payload then
            ngx.status = 500
            ngx.say(cjson.encode({ error = "failed to decode Keycloak token response" }))
            return
          end

          payload.expires_in = 6

          ngx.status = res.status
          ngx.say(cjson.encode(payload))
        }
      }

      location = /requests {
        content_by_lua_block {
          local cjson = require "cjson"
          local dict = ngx.shared.kong

          ngx.say(cjson.encode({
            rotation = dict:get(%q) or 0,
            expiry = dict:get(%q) or 0,
          }))
        }
      }
    }
  ]], opts.server_name, opts.port,
      opts.rotation_counter_key, opts.token_endpoint,
      opts.expiry_counter_key, opts.token_endpoint,
      opts.rotation_counter_key, opts.expiry_counter_key)
end

return _M
