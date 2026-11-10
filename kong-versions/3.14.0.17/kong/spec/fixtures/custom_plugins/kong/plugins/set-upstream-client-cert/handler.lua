-- This software is copyright Kong Inc. and its licensors.
-- Use of the software is subject to the agreement between your organization
-- and Kong Inc. If there is no such agreement, use is governed by and
-- subject to the terms of the Kong Master Software License Agreement found
-- at https://konghq.com/enterprisesoftwarelicense/.
-- [ END OF LICENSE 0867164ffc95e54f04670b5169c09574bdbd9bba ]

local ssl = require "ngx.ssl"
local x509 = require "resty.openssl.x509"
local x509_store = require "resty.openssl.x509.store"


local SetUpstreamClientCert = {
  PRIORITY = 1000000,
  VERSION = "1.0.0",
}


function SetUpstreamClientCert:access(conf)
  if conf.enable_buffering then
    kong.service.request.enable_buffering()
  end

  local err

  if conf.cert or conf.key then
    if not conf.cert or not conf.key then
      return kong.response.exit(500, { message = "missing upstream client certificate or key" })
    end

    local cert
    cert, err = ssl.parse_pem_cert(conf.cert)
    if not cert then
      kong.log.err("failed to parse upstream client certificate: ", err)
      return kong.response.exit(500, { message = "failed to parse upstream client certificate" })
    end

    local key
    key, err = ssl.parse_pem_priv_key(conf.key)
    if not key then
      kong.log.err("failed to parse upstream client certificate key: ", err)
      return kong.response.exit(500, { message = "failed to parse upstream client certificate key" })
    end

    local ok
    ok, err = kong.service.set_tls_cert_key(cert, key)
    if not ok then
      kong.log.err("failed to set upstream client certificate: ", err)
      return kong.response.exit(500, { message = "failed to set upstream client certificate" })
    end
  end

  if conf.trusted_store_ca_cert then
    local store
    store, err = x509_store.new()
    if not store then
      kong.log.err("failed to create upstream TLS trusted store: ", err)
      return kong.response.exit(500, { message = "failed to create upstream TLS trusted store" })
    end

    local ca
    ca, err = x509.new(conf.trusted_store_ca_cert, "PEM")
    if not ca then
      kong.log.err("failed to parse upstream TLS CA certificate: ", err)
      return kong.response.exit(500, { message = "failed to parse upstream TLS CA certificate" })
    end

    local ok
    ok, err = store:add(ca)
    if not ok then
      kong.log.err("failed to add upstream TLS CA certificate to trusted store: ", err)
      return kong.response.exit(500, { message = "failed to add upstream TLS CA certificate to trusted store" })
    end

    ok, err = kong.service.set_tls_verify_store(store)
    if not ok then
      kong.log.err("failed to set upstream TLS trusted store: ", err)
      return kong.response.exit(500, { message = "failed to set upstream TLS trusted store" })
    end
  end

  if conf.tls_verify_depth ~= nil then
    local ok
    ok, err = kong.service.set_tls_verify_depth(conf.tls_verify_depth)
    if not ok then
      kong.log.err("failed to set upstream TLS verification depth: ", err)
      return kong.response.exit(500, { message = "failed to set upstream TLS verification depth" })
    end
  end

  if conf.tls_verify ~= nil then
    local ok
    ok, err = kong.service.set_tls_verify(conf.tls_verify)
    if not ok then
      kong.log.err("failed to set upstream TLS verification: ", err)
      return kong.response.exit(500, { message = "failed to set upstream TLS verification" })
    end
  end
end


return SetUpstreamClientCert
