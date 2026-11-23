# Summary

Test certificate used for openid-connect tests

## Description

In this directory are all the certificates used by openid-connect tests. You'll find here keys that were
used to generate those certificates alongside the .cnf files that define the configuration.

Please do not regenerate those certificates by hand but rather use the provided Makefile so that it's easier to track
changes in the future.

### Directory description

- root-ca - directory containing the root certificate authority certificates
- intermediate-ca - directory containing the intermediate authority certificates
- server - directory for keycloak certificate
- client - directory for client certificate (used for mTLS)

#### Usage

There's a Makefile here so that it's clear what commands were executed to make sure the test setup is explicit.

In order to regenerate all the certificates please run:

```bash
make all
```

The clean command will remove all generated certificates and leave only configuration files:
```bash
make clean
```
