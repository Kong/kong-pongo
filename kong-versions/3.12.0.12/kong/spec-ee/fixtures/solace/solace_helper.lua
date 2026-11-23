-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local pl_file = require("pl.file")
local pl_path = require("pl.path")

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

-- Helper function to read and verify log files
function _M.check_logs_handler(path, expected_patterns)
  local log_file = io.open(path, "r")
  if not log_file then
    return false, "Log file not found: " .. path
  end

  -- Read only the last line of the log file
  local last_line = ""
  for line in log_file:lines() do
    last_line = line
  end
  log_file:close()

  if not last_line or #last_line == 0 then
    assert(false, "No content found in " .. path .. " log")
  end

  -- Verify expected patterns if provided
  if expected_patterns then
    for _, pattern in ipairs(expected_patterns) do
      if not string.find(last_line, pattern.pattern) then
        return false, pattern.message or ("Pattern not found: " .. pattern.pattern)
      end
    end
  end
  return true, last_line
end

-- Helper function to read and verify webhook log files
function _M.check_webhook_consumer_logs(log_path, expected_patterns)
  return _M.check_logs_handler(log_path, expected_patterns)
end

-- Helper function to read and verify MQTT consumer log files
function _M.check_mqtt_consumer_logs(log_path, expected_patterns)
  return _M.check_logs_handler(log_path, expected_patterns)
end

return _M
