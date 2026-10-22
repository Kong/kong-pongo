# Fixtures

Certificates generated via `mkcert` with:
```
# CA certificate
CAROOT=`realpath .` TRUST_STORES="none" mkcert -install

# Server certificate
CAROOT=`realpath .` TRUST_STORES="none" mkcert 'upstream-server.test' 'spiffe://id.test/entity/kong'
```
