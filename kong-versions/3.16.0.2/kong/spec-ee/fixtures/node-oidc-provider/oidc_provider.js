const { Provider } = require('oidc-provider');

/**
 * Minimal OIDC Provider configuration to reproduce RFC 9449 Section 6.2 scenario:
 * 1. Issue Opaque Access Tokens by default.
 * 2. Support DPoP binding (compute JKT).
 * 3. Return nested cnf.jkt structure in Introspection response.
 */
const configuration = {
  clients: [{
    client_id: 'kong-client-dpop',
    client_secret: 'hOfxl46eEa7BI5RMmB5ROJQaSCdRheDs',
    redirect_uris: ['http://localhost/callback'],
    response_types: [],
    grant_types: ['client_credentials'],
    token_endpoint_auth_method: 'client_secret_post',
  }],
  features: {
    dPoP: { enabled: true },
    clientCredentials: { enabled: true },
    introspection: {
      enabled: true,
      allowedPolicy: async (ctx, client, token) => true
    },
  },
  formats: {
    // forcing Opaque tokens ensures that Kong must use introspection to validate tokens and retrieve cnf.jkt (6.2)
    AccessToken: 'opaque',
  },
};

const port = 13000;
const issuer = `http://localhost:${port}`;
const oidc = new Provider(issuer, configuration);

oidc.proxy = true;

oidc.listen(port, () => {
  console.log(`✅ OIDC Provider (HTTP Mode) listening on port ${port}`);
  console.log(`   Issuer URL: ${issuer}`);
});
