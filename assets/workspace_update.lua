-- Workaround for the import of a declarative file in Kong Enterprise.
-- Officially it is not supported.
--
-- The import fails because there already is a "default" workspace, even in an
-- empty database. So the imported "default" workspace collides.
--
-- This file serves 2 purposes:
-- 1. Returns the ID of the default namespace (in the decl. file), on stdout
-- 2. if the first argument (new default namespace id) is given then
-- returns the entire input, where the default WS id will be replaced by
-- the given one, so the reult becomes "importable"

local lyaml = require("lyaml")
local json = require("cjson.safe")
local rawdata = assert(io.stdin:read("*a"))
local kong_uuid = arg[1]
local file_uuid

-- parse file
local data = json.decode(rawdata)
if not data then
  data = assert(lyaml.load(rawdata), "failed parsing as JSON or Yaml")
end

-- get default WS UUID from file
for _, workspace in ipairs(data.workspaces or {}) do
    if workspace.name == "default" then
        file_uuid = workspace.id
        break
    end
end

if kong_uuid == nil then
    -- no ID argument provided, so we return the one in the input
    if file_uuid then
        io.stdout:write(file_uuid)
        os.exit(0)
    end
    -- not found, return nothing
    os.exit(1)
end


kong_uuid = kong_uuid:gsub('"', '') -- remove all double quotes from the uuid
file_uuid = file_uuid:gsub('-', '%%-') -- escape dashes in uuid
local updated_data = rawdata:gsub(file_uuid, kong_uuid)
io.stdout:write(updated_data)
