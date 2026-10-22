-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local _M = {}

local verbose = false
local inspect = require("inspect")
local io = io


---@param item any
---@param path any[]
---@return any?
local function drop_metatables(item, path)
  -- see https://github.com/kikito/inspect.lua/blob/783a0889270952dd70a7f572ea9b38b131e697dc/README.md?plain=1#L184-L195
  if path[#path] ~= inspect.METATABLE then
    return item
  end
end


local inspect_opts = {
  depth = nil,
  process = nil,
}


---@param value any
---@param opts? { show_metatables: boolean, max_depth: integer }
function _M.inspect(value, opts)
  if verbose then
    inspect_opts.depth = nil

    -- drop metatables from the output by default
    inspect_opts.process = drop_metatables

    if opts then
      inspect_opts.depth = opts.max_depth

      if opts.show_metatables then
        inspect_opts.process = nil
      end
    end

    io.write(inspect(value, inspect_opts))
    io.write("\n")
    io.flush()
  end
end


---@param ... any
function _M.print(...)
  if verbose then
    io.write(...)
    io.write("\n")
    io.flush()
  end
end


---@param f string
---@param ... any
function _M.printf(f, ...)
  if verbose then
    io.write(string.format(f, ...))
    io.write("\n")
    io.flush()
  end
end


---@param v boolean|any
function _M.set_verbose(v)
  verbose = not not v
end


return _M
