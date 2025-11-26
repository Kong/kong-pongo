import axios, {AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import * as querystring from "querystring";
import * as url from "url";
import {
  Client,
} from '@modelcontextprotocol/sdk/client/index.js';
import {
  OAuthClientProvider,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  expect,
  createPlugin,
  clearAllKongResources,
  createGatewayService,
  randomString,
  createRouteForService,
  logResponse,
  waitForConfigRebuild,
  isLoggingEnabled,
  logDebug,
  getBasePath,
  Environment,
  isGateway,
  checkOrStartServiceContainer,
  stopContainerByName,
} from '@support';

describe('@ai: Gateway Plugins: AI MCP OAuth2', function () {
  const pluginUrl = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/plugins`;

  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;

  const keycloakIssuerUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.keycloakMCP,
  })}/realms/demo`;
  const callbackUrl = `${proxyUrl}/mcp_auth_callback`;
  const metadataEndpoint = "/.well-known/oauth-protected-resource";
  const introspectionEndpoint = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.keycloakMCPInternal,
  })}/realms/demo/protocol/openid-connect/token/introspect`;
  const clientId = `kong-client-secret`;
  const clientSecret = `38beb963-2786-42b8-8e14-a5f391b4ba93`;

  function createMcpTransportWithAuth(authProvider: OAuthClientProvider, path: string): StreamableHTTPClientTransport {
    return new StreamableHTTPClientTransport(
      new URL(`${proxyUrl}${path}`),
      {
        authProvider: authProvider,
      }
    );
  }

  async function authWithMcpServer(client: Client, authProvider: InMemoryOAuthClientProvider, path: string) {
    let transport = createMcpTransportWithAuth(authProvider, path);

    try {
      await client.connect(transport);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log('waiting for authorization...');
        const redirectUrl = await authProvider.redirectUrlPromise;

        // Simulate a fake login and get the authorization code
        // in the new redirect URL after the user has logged in.
        const http = await createClientHasCookieJar(isLoggingEnabled());
        const form = await fetchLoginForm(http, redirectUrl.toString());
        logDebug(`Login form: ${form}`);
        const redirectAfterLogin = await submitCredentials(http, form, 'john', 'doe');
        logDebug(`Redirect after login: ${redirectAfterLogin}`);

        // If the redirect is a relative path on the auth server that then 302s again to redirect_uri,
        // we may need to follow that once manually:
        let finalRedirect = redirectAfterLogin;
        if (!redirectAfterLogin.startsWith(callbackUrl)) {
          // Follow one more redirect (no credentials needed; Keycloak may produce another 302)
          const follow = await http.get(redirectAfterLogin, {
            headers: { "Accept": "text/html,application/xhtml+xml" },
            validateStatus: null,
          });
          if (follow.status === 302 && follow.headers["location"]) {
            finalRedirect = follow.headers["location"];
            logDebug(`Final redirect after follow: ${finalRedirect}`);
          } else if (follow.status === 200) {
            // Could happen if the redirect URI returns HTML page; just attempt extraction anyway
            // not typical for pure code flow callback.
            logDebug("Received 200 on intermediate redirect, attempting to extract code anyway.");
          }
        }

        const code = extractCodeFromRedirect(finalRedirect);
        logDebug(`authorization code: ${code}`);

        await transport.finishAuth(code);
        await transport.close();
        // Try again after authorization
        transport = createMcpTransportWithAuth(authProvider, path);
        await client.connect(transport);
      } else {
        console.error('Connection failed with non-auth error:', error);
        throw error;
      }
    }
  }

  before(async function () {
    await checkOrStartServiceContainer('keycloak-mcp', async () => {
      const resp = await axios.get(`${keycloakIssuerUrl}/.well-known/openid-configuration`);
      expect(resp.status).to.equal(200);
      expect(resp.data).to.have.property('authorization_endpoint');
    });
  });

  context('Kong as MCP Server', function () {
    const path = `/${randomString()}`;
    let serviceId: string;
    let routeId: string;
    let mcpAuthPluginId: string;
    let authProvider: InMemoryOAuthClientProvider;
    let client: Client;

    before(async function () {
      const service = await createGatewayService(randomString());
      serviceId = service.id;
      client = new Client({
        name: 'example-client',
        version: '1.0.0'
      }, {
        capabilities: {
        },
      });
      client.onerror = (error) => {
        console.error('\x1b[31mClient error:', error, '\x1b[0m');
      }

      const clientMetadata: OAuthClientMetadata = {
        client_name: 'Simple OAuth MCP Client',
        redirect_uris: [callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: 'profile', // This is the scope we configure in Keycloak setup data.
      };
      authProvider = new InMemoryOAuthClientProvider(
        callbackUrl,
        clientMetadata,
      );

      // By default, we will use the first route path as the path of tool.
      const route = await createRouteForService(serviceId, [path, metadataEndpoint]);
      routeId = route.id;

      const postFunction = {
        name: 'post-function',
        route: {
          id: routeId,
        },
        config: {
          access: [
            `
            local h_foo = kong.request.get_header("foo")
            local res = string.format("header foo: %s", h_foo)
            kong.response.exit(200, res)
            `
          ],
        },
      };
      const resp = await axios.post(pluginUrl, postFunction);
      logResponse(resp);
      expect(resp.status).to.equal(201);
    });

    it("setup AI MCP plugin", async function () {
      const mcpAuthPayload = {
        name: 'ai-mcp-oauth2',
        service: {
          id: serviceId,
        },
        route: {
          id: routeId,
        },
        config: {
          metadata_endpoint: metadataEndpoint,
          resource: `${proxyUrl}${path}`,
          authorization_servers: [keycloakIssuerUrl],
          introspection_endpoint: introspectionEndpoint,
          insecure_relaxed_audience_validation: true,
          client_id: clientId,
          client_secret: clientSecret,
          claim_to_header: [
            { claim: "username", header: "x-username" },
            { claim: "non-existent", header: "x-blah" },
          ],
        },
      };
      const pluginData = await createPlugin(mcpAuthPayload);
      mcpAuthPluginId = pluginData.id;

      const mcpPayload = {
        name: 'ai-mcp-proxy',
        service: {
          id: serviceId,
        },
        route: {
          id: routeId,
        },
        config: {
          mode: "conversion-listener",
          tools: [
            {
              description: 'Tool description',
              method: 'GET',
              parameters: [
                {name: "foo", in: "header", description: "The parameter", required: true},
              ],
              annotations: {
                title: "test-tool",
              }
            },
          ],
          server: {},
        },
      };
      await createPlugin(mcpPayload);
      await waitForConfigRebuild();
    });

    it("pass authorization", async function () {
      await authWithMcpServer(client, authProvider, path);
    });

    it("call tools as authorized", async function () {
      const name = "test-tool";
      const args = { header_foo: 'bar', };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res: any = await client.callTool({
        name,
        arguments: args,
      });
      res.content.forEach((item: any) => {
        expect(item.text).to.equal('header foo: bar');
      });
    });

    it("setup AI MCP plugin with default metadata endpoint", async function () {
      const resp = await axios.patch(`${pluginUrl}/${mcpAuthPluginId}`, {
        config: {
          metadata_endpoint: null, // Use default metadata endpoint
        }
      });
      logResponse(resp);
      expect(resp.status).to.equal(200);
      await waitForConfigRebuild();
    });

    it("pass authorization again with default metadata endpoint", async function () {
      await authWithMcpServer(client, authProvider, path);

      const name = "test-tool";
      const args = { header_foo: 'bar', };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res: any = await client.callTool({
        name,
        arguments: args,
      });
      res.content.forEach((item: any) => {
        expect(item.text).to.equal('header foo: bar');
      });
    });

    it("setup AI MCP plugin with cache disabled", async function () {
      const resp = await axios.patch(`${pluginUrl}/${mcpAuthPluginId}`, {
        config: {
          cache_introspection: false, // Disable cache
        }
      });
      logResponse(resp);
      expect(resp.status).to.equal(200);
      await waitForConfigRebuild();
    });

    it("pass authorization again with cache disabled", async function () {
      await authWithMcpServer(client, authProvider, path);

      const name = "test-tool";
      const args = { header_foo: 'bar', };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res: any = await client.callTool({
        name,
        arguments: args,
      });
      res.content.forEach((item: any) => {
        expect(item.text).to.equal('header foo: bar');
      });
    });

    after(async function () {
      await clearAllKongResources()
    });
  });

  context('Kong as MCP Proxy', function () {
    const path = `/${randomString()}`;
    const proxyPath = `/proxy-to-mcp`;
    let authProvider: InMemoryOAuthClientProvider;
    let client: Client;

    before(async function () {
      client = new Client({
        name: 'example-client',
        version: '1.0.0'
      }, {
        capabilities: {
        },
      });
      client.onerror = (error) => {
        console.error('\x1b[31mClient error:', error, '\x1b[0m');
      }

      const clientMetadata: OAuthClientMetadata = {
        client_name: 'Simple OAuth MCP Client',
        redirect_uris: [callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: 'profile', // This is the scope we configure in Keycloak setup data.
      };
      authProvider = new InMemoryOAuthClientProvider(
        callbackUrl,
        clientMetadata,
      );
    });

    it("set up upstream MCP server", async function () {
      const service = await createGatewayService(randomString());
      const serviceId = service.id;
      const route = await createRouteForService(serviceId, [path]);
      const routeId = route.id;

      const postFunction = {
        name: 'post-function',
        route: {
          id: routeId,
        },
        config: {
          access: [
            `
            local h_foo = kong.request.get_header("foo")
            local res = string.format("header foo: %s", h_foo)
            kong.response.exit(200, res)
            `
          ],
        },
      };
      const resp = await axios.post(pluginUrl, postFunction);
      logResponse(resp);
      expect(resp.status).to.equal(201);

      const payload = {
        name: 'ai-mcp-proxy',
        service: {
          id: serviceId,
        },
        route: {
          id: routeId,
        },
        config: {
          mode: "conversion-listener",
          tools: [
            {
              description: 'Tool description',
              method: 'GET',
              parameters: [
                {name: "foo", in: "header", description: "The parameter", required: true},
              ],
              annotations: {
                title: "test-tool",
              }
            },
          ],
          server: {},
        },
      };
      await createPlugin(payload);
    });

    it("set up proxy to upstream MCP server", async function () {
      const payload = {
        url: `${proxyUrl}${path}`,
      }
      const service = await createGatewayService(randomString(), payload);
      const route = await createRouteForService(service.id, [proxyPath]);
      const mcpPayload = {
        name: 'ai-mcp-oauth2',
        route: {
          id: route.id,
        },
        config: {
          resource: `${proxyUrl}${proxyPath}`,
          authorization_servers: [keycloakIssuerUrl],
          scopes_supported: ['profile'],
          introspection_endpoint: introspectionEndpoint,
          insecure_relaxed_audience_validation: true,
          client_id: clientId,
          client_secret: clientSecret,
        },
      };
      await createPlugin(mcpPayload);
      await waitForConfigRebuild();
    });

    it("reject if without authorization", async function () {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${proxyUrl}${proxyPath}`),
        {}
      );

      try {
        await client.connect(transport);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('Authorization Required'))) {
          console.error('Connection failed with non-auth error:', error);
          throw error;
        }
      }
    });

    it("pass authorization", async function () {
      await authWithMcpServer(client, authProvider, proxyPath);
    });

    it("call tools as authorized", async function () {
      const name = "test-tool";
      const args = { header_foo: 'bar', };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res: any = await client.callTool({
        name,
        arguments: args,
      });
      res.content.forEach((item: any) => {
        expect(item.text).to.equal('header foo: bar');
      });
    });

    after(async function () {
      await clearAllKongResources()
    });
  });

  after(async function () {
    await stopContainerByName('keycloak-mcp');
  });
});

async function createClientHasCookieJar(verbose: boolean): Promise<AxiosInstance> {
  const jar = new CookieJar();
  let instance = axios.create({
    // We often want to inspect 302 responses before auto-follow:
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  // The cookie jar will set its own http(s) agent. Clean up for it.
  delete instance.defaults.httpsAgent;
  instance = wrapper(instance);
  if (verbose) {
    instance.interceptors.request.use((req) => {
      console.log(`--> ${req.method?.toUpperCase()} ${req.url}`);
      return req;
    });
    instance.interceptors.response.use((res) => {
      console.log(`<-- ${res.status} ${res.statusText} ${res.config.url}`);
      const setCookie = res.headers["set-cookie"];
      if (setCookie) {
        console.log("   Set-Cookie:", setCookie);
      }
      return res;
    }, (err) => {
      console.error("HTTP error", err?.response?.status, err?.response?.data);
      return Promise.reject(err);
    });
  }
  // Attach cookie jar
  (instance as any).defaults.jar = jar;
  (instance as any).defaults.withCredentials = true;
  return instance;
}

class LoginFormInfo {
  constructor(
    public action: string,
    public method: string,
    public hiddenFields: Record<string, string>
  ) {}

  toString(): string {
    const hiddenFieldsStr = Object.entries(this.hiddenFields)
      .map(([key, value]) => `${key}="${value}"`)
      .join(', ');

    return `LoginFormInfo { action: "${this.action}", method: "${this.method}", hiddenFields: {${hiddenFieldsStr}} }`;
  }
}

function parseLoginForm(html: string): LoginFormInfo {
  const $ = cheerio.load(html);
  const form = $("form#kc-form-login");
  if (!form || form.length === 0) {
    throw new Error("Login form (#kc-form-login) not found. Possibly already logged in or unexpected page.");
  }
  const action = form.attr("action");
  if (!action) {
    throw new Error("Login form action missing.");
  }
  const method = (form.attr("method") || "post").toLowerCase();
  const hiddenFields: Record<string,string> = {};
  form.find("input[type=hidden]").each((_i, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") || "";
    if (name) hiddenFields[name] = value;
  });
  return new LoginFormInfo(action, method, hiddenFields);
}

async function fetchLoginForm(http: AxiosInstance, authUrl: string): Promise<LoginFormInfo> {
  const res = await http.get(authUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
    },
    validateStatus: null,
  });
  if (res.status !== 200) {
    logResponse(res);
    throw new Error(`Expected 200 from auth endpoint, got ${res.status}`);
  }
  const html = res.data as string;
  const form = parseLoginForm(html);
  return form;
}

async function submitCredentials(http: AxiosInstance, form: LoginFormInfo, username: string, password: string): Promise<string> {
  const payload = {
    ...form.hiddenFields,
    username: username,
    password: password,
  };
  const body = querystring.stringify(payload);
  const res = await http.request({
    url: form.action,
    method: form.method || "post",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/html,application/xhtml+xml",
    },
    validateStatus: null,
    data: body
  });

  if (res.status === 200) {
    // Possibly login failed (form re-render with error)
    const text: string = res.data;
    if (/invalid/i.test(text) || /error/i.test(text)) {
      throw new Error("Login may have failed (received 200 and possible error message). Inspect HTML to confirm.");
    } else {
      throw new Error("Login did not redirect. Possibly additional step required (MFA, consent, or already logged in).");
    }
  }

  if (res.status !== 302) {
    throw new Error(`Expected 302 redirect after login, got ${res.status}`);
  }

  const location = res.headers["location"];
  if (!location) {
    throw new Error("Redirect (Location) header missing after login.");
  }
  return location;
}

function extractCodeFromRedirect(redirectUrl: string): string {
  const parsed = new url.URL(redirectUrl);
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new Error(`Authorization code not found in redirect: ${redirectUrl}`);
  }
  return code;
}

class InMemoryOAuthClientProvider implements OAuthClientProvider {
  private _clientInformation?: OAuthClientInformationFull;
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;
  private _resolveRedirectUrl: (url: URL) => void;
  private _redirectUrlPromise: Promise<URL>;

  constructor(
    private readonly _redirectUrl: string | URL,
    private readonly _clientMetadata: OAuthClientMetadata,
    onRedirect?: (url: URL) => void
  ) {
    this._resolveRedirectUrl = (url: URL) => {
      console.log(`Redirect URL resolved: ${url.toString()}`);
    };
    this._redirectUrlPromise = new Promise<URL>((resolve) => {
      this._resolveRedirectUrl = resolve;
    });
    this._onRedirect = onRedirect || ((url) => {
      console.log(`Redirect to: ${url.toString()}`);
      this._resolveRedirectUrl(url);
    });
  }

  private _onRedirect: (url: URL) => void;

  get redirectUrl(): string | URL {
    return this._redirectUrl;
  }

  get redirectUrlPromise(): Promise<URL> {
    return this._redirectUrlPromise;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this._clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    this._clientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this._onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this._codeVerifier) {
      throw new Error('No code verifier saved');
    }
    return this._codeVerifier;
  }
}

