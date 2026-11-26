-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

-- Reads the CA DN list that the TLS handshake offers. The list tells the
-- client which client certificate authorities the server accepts.

local helpers = require "spec.helpers"

local assert = require "luassert"
local fmt = string.format
local ipairs = ipairs


local _M = {}


-- Runs a TLS handshake against the proxy listener and returns its output.
-- Without `sni`, the client sends no server name.
function _M.handshake(sni)
  local cmd = fmt("echo | openssl s_client -connect %s:%d%s 2>&1",
                  helpers.get_proxy_ip(true),
                  helpers.get_proxy_port(true),
                  sni and (" -servername " .. sni) or "")

  local _, _, stdout, stderr = helpers.execute(cmd, true)

  return (stdout or "") .. (stderr or "")
end


-- Runs a handshake and asserts that the server completed it.
function _M.assert_handshake(sni)
  local output = _M.handshake(sni)

  assert.is_truthy(output:find("-----BEGIN CERTIFICATE-----", 1, true),
                   "handshake on '" .. tostring(sni or "no sni") ..
                   "' failed:\n" .. output)

  return output
end


-- The handshake output holds the CA DN list in a block of its own. Read only
-- that block, so that a common name which appears somewhere else in the
-- output, such as the one of the server certificate, is not a match.
function _M.ca_dn_list(output)
  local block = output:match("Acceptable client certificate CA names\n(.*)")
  if not block then
    return {}
  end

  local names = {}

  for line in block:gmatch("[^\n]+") do
    -- The block ends at the separator, or at the first line of the section
    -- that follows. Every such section prints a "name: value" pair, which a
    -- distinguished name does not. This keeps the reader independent of how
    -- the openssl build formats a distinguished name.
    if line == "---" or line:find(": ", 1, true) then
      break
    end

    names[#names + 1] = line
  end

  return names
end


function _M.offers_ca_dn(output, common_name)
  for _, name in ipairs(_M.ca_dn_list(output)) do
    if name:find(common_name, 1, true) then
      return true
    end
  end

  return false
end


return _M
