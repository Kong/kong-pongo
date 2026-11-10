// External auth gRPC service for Envoy's redis_proxy `external_auth_provider`.
//
// Envoy calls envoy.service.redis_auth.v3.RedisProxyExternalAuth/Authenticate
// with { username, password } on every downstream AUTH command. Here the
// `password` carries an OAuth2 access token (a JWT minted by Kong's test
// Keycloak, realm `demo`). We validate the JWT's signature (against the
// realm JWKS), issuer, audience and expiry, and answer Envoy with:
//   - status.code == 0  -> authorized, plus `expiration` = the token's exp.
//   - status.code == 16 -> rejected (UNAUTHENTICATED).
//
// Envoy then either lets the connection proceed (talking to the real Redis
// with its OWN static password) or returns an auth error to the client. The
// client's token never reaches Redis; Redis's static password never reaches
// the client.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Config (env-driven so the same image works in/out of compose) ----------
const GRPC_PORT = process.env.GRPC_PORT || '50051';
// Keycloak's container port is only reachable from this container via the
// docker host's published port (this fixture may run either merged into the
// same compose project as the shared Keycloak container, or as its own
// standalone project in CI) -- host.docker.internal + the fixed host-published
// port (18080, see spec-ee/fixtures/keycloak/docker-compose.yaml) works in
// both cases.
const JWKS_URI =
  process.env.JWKS_URI ||
  'http://host.docker.internal:18080/realms/demo/protocol/openid-connect/certs';
// ...but the issuer string in the token is whatever host/port the *client*
// (Kong) saw when it fetched the token from the token endpoint, which is the
// same fixed published port from the test runner's point of view.
const EXPECTED_ISSUER =
  process.env.EXPECTED_ISSUER || 'http://127.0.0.1:18080/realms/demo';
const EXPECTED_AUDIENCE = process.env.EXPECTED_AUDIENCE || 'redis-oauth';
// Optionally require the AUTH username to match a token claim. Off by default
// since the redis oauth provider doesn't always resolve a username.
const REQUIRE_USERNAME_MATCH = process.env.REQUIRE_USERNAME_MATCH === 'true';

const JWKS = createRemoteJWKSet(new URL(JWKS_URI));

// gRPC status codes we use in the response body's google.rpc.Status.
const RPC_OK = 0;
const RPC_UNAUTHENTICATED = 16;

// ---- Load the (wire-compatible) Envoy proto ---------------------------------
const packageDef = protoLoader.loadSync(
  path.join(__dirname, 'proto/envoy/service/redis_auth/v3/redis_external_auth.proto'),
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    includeDirs: [path.join(__dirname, 'proto')],
  },
);
const proto = grpc.loadPackageDefinition(packageDef);
const redisAuth = proto.envoy.service.redis_auth.v3;

function nowIso() {
  return new Date().toISOString();
}

async function authenticate(call, callback) {
  const { username, password } = call.request;
  const token = password || '';
  const userLabel = username ? `user='${username}'` : 'user=<empty>';

  if (!token) {
    console.log(`[${nowIso()}] DENY  ${userLabel}: no token in AUTH`);
    return callback(null, {
      status: { code: RPC_UNAUTHENTICATED, message: 'missing token' },
      message: 'no access token provided',
    });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: EXPECTED_ISSUER,
      audience: EXPECTED_AUDIENCE,
    });

    // `jwtVerify` already enforced exp/nbf. Echo exp back to Envoy so it
    // de-authorizes the connection when the token lapses (enable_auth_expiration).
    const expSeconds = payload.exp ?? Math.floor(Date.now() / 1000) + 300;

    if (REQUIRE_USERNAME_MATCH && username) {
      const claimUser = payload.azp || payload.preferred_username || payload.sub;
      if (claimUser && username !== claimUser) {
        console.log(
          `[${nowIso()}] DENY  ${userLabel}: username != token claim '${claimUser}'`,
        );
        return callback(null, {
          status: { code: RPC_UNAUTHENTICATED, message: 'username mismatch' },
          message: 'username does not match token',
        });
      }
    }

    console.log(
      `[${nowIso()}] ALLOW ${userLabel} sub=${payload.sub} azp=${payload.azp} exp=${new Date(
        expSeconds * 1000,
      ).toISOString()}`,
    );
    return callback(null, {
      status: { code: RPC_OK },
      expiration: { seconds: String(expSeconds), nanos: 0 },
    });
  } catch (err) {
    console.log(`[${nowIso()}] DENY  ${userLabel}: ${err.code || err.name} - ${err.message}`);
    return callback(null, {
      status: { code: RPC_UNAUTHENTICATED, message: 'token validation failed' },
      message: `token rejected: ${err.code || err.message}`,
    });
  }
}

const server = new grpc.Server();
server.addService(redisAuth.RedisProxyExternalAuth.service, { Authenticate: authenticate });

server.bindAsync(
  `0.0.0.0:${GRPC_PORT}`,
  grpc.ServerCredentials.createInsecure(),
  (err, port) => {
    if (err) {
      console.error('failed to bind gRPC server:', err);
      process.exit(1);
    }
    console.log(`[${nowIso()}] redis external-auth service listening on 0.0.0.0:${port}`);
    console.log(`  JWKS_URI         = ${JWKS_URI}`);
    console.log(`  EXPECTED_ISSUER  = ${EXPECTED_ISSUER}`);
    console.log(`  EXPECTED_AUDIENCE= ${EXPECTED_AUDIENCE}`);
  },
);
