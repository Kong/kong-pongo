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
  -- Change to the solace fixtures directory
  local original_dir = pl_path.currentdir()
  local solace_dir = pl_path.join(original_dir, "spec-ee/fixtures/solace")

  if not pl_path.exists(solace_dir) then
    return nil, "Solace fixtures directory not found: " .. solace_dir
  end

  -- Change directory to solace fixtures
  if not pl_path.chdir(solace_dir) then
    return nil, "Failed to change directory to: " .. solace_dir
  end

  local _, err

  -- Start Docker Compose services
  _, err = execute_command("docker compose -p " .. SOLACE_PROJECT_NAME .. " -f solace.yaml up -d")
  if err then
    pl_path.chdir(original_dir)
    return nil, "Failed to start Solace services: " .. err
  end

  -- Wait for port-exporter to complete
  local timeout = 60
  local count = 0
  while true do
    local result, check_err = execute_command("docker ps --filter 'name=" .. SOLACE_PROJECT_NAME .. "-port-exporter' --filter 'status=running' -q")
    if check_err then
      pl_path.chdir(original_dir)
      return nil, "Failed to check port exporter status: " .. check_err
    end

    if not result or result:match("^%s*$") then
      -- Port exporter is no longer running (completed)
      break
    end

    count = count + 1
    if count >= timeout then
      pl_path.chdir(original_dir)
      return nil, "Timeout waiting for port exporter to complete"
    end

    -- Wait 1 second before next check
    os.execute("sleep 1")
  end

  -- Load environment variables from .env.solace
  local env_file_path = pl_path.join(solace_dir, ".env.solace")

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

return _M
