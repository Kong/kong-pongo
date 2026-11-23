CERT_LIFETIME_DAYS=36500 # 100 years

.PHONY: all root-ca intermediate server clients client1 client2 client-expired client-hacker clean truststore
all: root-ca intermediate server clients copy-to-keycloak
clients: client1 client2 client-expired client-hacker

# --------------------
# Root CA
# --------------------
root-ca:
	openssl genrsa -out root-ca/root-ca.key 4096
	openssl req -x509 \
		-new \
		-key root-ca/root-ca.key \
		-sha256 \
		-days $(CERT_LIFETIME_DAYS) \
		-out root-ca/root-ca.crt \
		-config root-ca/root.cnf


# --------------------
# Intermediate CA
# --------------------
intermediate: root-ca
	openssl genrsa -out intermediate/intermediate-ca.key 4096
	openssl req -new \
		-key intermediate/intermediate-ca.key \
		-out intermediate/intermediate-ca.csr \
		-config intermediate/intermediate.cnf
	openssl x509 -req \
		-in intermediate/intermediate-ca.csr \
		-CA root-ca/root-ca.crt \
		-CAkey root-ca/root-ca.key \
		-CAcreateserial \
		-out intermediate/intermediate-ca.crt \
		-days $(CERT_LIFETIME_DAYS) \
		-sha256 \
		-extensions v3_req \
		-extfile intermediate/intermediate.cnf


# --------------------
# Server certificate
# --------------------
server: intermediate
	openssl genrsa -out server/server.key 2048
	openssl req -new \
		-key server/server.key \
		-out server/server.csr \
		-config server/server.cnf
	openssl x509 -req \
		-in server/server.csr \
		-CA intermediate/intermediate-ca.crt \
		-CAkey intermediate/intermediate-ca.key \
		-CAcreateserial \
		-out server/server.crt \
		-days $(CERT_LIFETIME_DAYS) \
		-sha256 \
		-extensions req_ext \
		-extfile server/server.cnf


# --------------------
# Client-1 certificate
# --------------------
client1: intermediate
	openssl genrsa -out clients/mtls/client1/client1.key 2048
	openssl req -new \
		-key clients/mtls/client1/client1.key \
		-out clients/mtls/client1/client1.csr \
		-config clients/mtls/client-common.cnf
	openssl x509 -req \
		-in clients/mtls/client1/client1.csr \
		-CA intermediate/intermediate-ca.crt \
		-CAkey intermediate/intermediate-ca.key \
		-CAcreateserial \
		-out clients/mtls/client1/client1.crt \
		-days $(CERT_LIFETIME_DAYS) \
		-extensions ext \
		-extfile clients/mtls/client-common.cnf


# --------------------
# Client-2 certificate
# --------------------
client2: intermediate
	openssl genrsa -out clients/mtls/client2/client2.key 2048
	openssl req -new \
		-key clients/mtls/client2/client2.key \
		-out clients/mtls/client2/client2.csr \
		-config clients/mtls/client-common.cnf
	openssl x509 -req \
		-in clients/mtls/client2/client2.csr \
		-CA intermediate/intermediate-ca.crt \
		-CAkey intermediate/intermediate-ca.key \
		-CAcreateserial \
		-out clients/mtls/client2/client2.crt \
		-days $(CERT_LIFETIME_DAYS) \
		-extensions ext \
		-extfile clients/mtls/client-common.cnf


# ----------------------------------------
# Client-expired certificate
# ----------------------------------------
client-expired: intermediate
	openssl genrsa -out clients/mtls/client-expired/client-expired.key 2048
	openssl req -new \
		-key clients/mtls/client-expired/client-expired.key \
		-out clients/mtls/client-expired/client-expired.csr \
		-config clients/mtls/client-common.cnf
	openssl x509 -req \
		-in clients/mtls/client-expired/client-expired.csr \
		-CA intermediate/intermediate-ca.crt \
		-CAkey intermediate/intermediate-ca.key \
		-CAcreateserial \
		-out clients/mtls/client-expired/client-expired.crt \
		-not_before 20251215000000Z \
		-not_after  20251216000000Z \
		-extensions ext \
		-extfile clients/mtls/client-common.cnf


# ----------------------------------------
# Client-hacker certificate
# ----------------------------------------
client-hacker: intermediate
	openssl genrsa -out clients/mtls/client-hacker/client-hacker.key 2048
	openssl req -new \
		-key clients/mtls/client-hacker/client-hacker.key \
		-out clients/mtls/client-hacker/client-hacker.csr \
		-config clients/mtls/client-common.cnf
	openssl x509 -req \
		-in clients/mtls/client-hacker/client-hacker.csr \
		-CA intermediate/intermediate-ca.crt \
		-CAkey intermediate/intermediate-ca.key \
		-CAcreateserial \
		-out clients/mtls/client-hacker/client-hacker.crt \
		-days $(CERT_LIFETIME_DAYS) \
		-extensions ext \
		-extfile clients/mtls/client-common.cnf


# --------------------------------------------------------------------------------
# Utility - copy certificates to Keycloak docker compose directory
# --------------------------------------------------------------------------------
copy-to-keycloak:
	cp server/server.crt ../../keycloak/server.crt
	cp server/server.key ../../keycloak/server.key
	cp root-ca/root-ca.crt ../../keycloak/trusted-certs/root-ca.crt
	cp intermediate/intermediate-ca.crt ../../keycloak/trusted-certs/intermediate-ca.crt
	cp clients/self-signed/client-cert.pem ../../keycloak/trusted-certs/self-signed/client-cert.pem
	cp clients/self-signed/expired-cert.pem ../../keycloak/trusted-certs/self-signed/expired-cert.pem
	cp clients/self-signed/hacker-cert.pem ../../keycloak/trusted-certs/self-signed/hacker-cert.pem


# --------------------
# Clean generated files
# --------------------
clean:
	rm -fv root-ca/*.key root-ca/*.crt root-ca/*.srl
	rm -fv intermediate/*.key intermediate/*.crt intermediate/*.csr intermediate/*.srl
	rm -fv server/*.key server/*.crt server/*.csr server/*.srl
	rm -fv clients/mtls/client1/*.key clients/client1/*.crt clients/client1/*.csr clients/client1/*.srl
	rm -fv clients/mtls/client2/*.key clients/client2/*.crt clients/client2/*.csr clients/client2/*.srl
	rm -fv clients/mtls/client-expired/*.key clients/client-expired/*.crt clients/client2/*.csr clients/client2/*.srl
	rm -fv clients/mtls/client-hacker/*.key clients/client-hacker/*.crt clients/client2/*.csr clients/client2/*.srl
	rm -fv truststore.jks
