-- Busted will cache the `ffi.cdef` function calls to prevent redefinition errors
-- but not `ffi.typeof` calls yet.
-- See: https://github.com/Olivine-Labs/busted/pull/623
local isJit = (tostring(assert):match('builtin') ~= nil)

if isJit then
  local ffi = require "ffi"

  -- Now patch ffi.typeof to only be called once with each definition, as it
  -- will error on re-registering.
  local old_typeof = ffi.typeof
  local exists_typeof = {}
  ffi.typeof = function(def)
    if exists_typeof[def] then return exists_typeof[def] end
    local ok, err = old_typeof(def)
    if ok then
      exists_typeof[def] = ok
      return ok
    end
    return ok, err
  end
end
