# Fixtures

Certificates generated via `mkcert` with:
```
# CA certificate
CAROOT=`realpath .` TRUST_STORES="none" mkcert -install

# Server certificate
CAROOT=`realpath .` TRUST_STORES="none" mkcert 'upstream-server.test' 'spiffe://id.test/entity/kong'
```
*Note:* these are the same files as in `../37-upstream_tls_sans`.
