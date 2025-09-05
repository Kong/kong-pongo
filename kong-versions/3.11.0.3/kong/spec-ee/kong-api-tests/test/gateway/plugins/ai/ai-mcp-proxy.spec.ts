import axios from 'axios';
import {
  Client,
} from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  OpenAI,
} from "openai";
import {
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions.js";
import {
  expect,
  Environment,
  getBasePath,
  clearAllKongResources,
  createGatewayService,
  randomString,
  createRouteForService,
  logResponse,
  waitForConfigRebuild,
  isGateway,
  getKongContainerName,
  getGatewayContainerLogs,
  isGwHybrid,
  vars,
  logDebug,
} from '@support';

describe('@ai: Gateway Plugins: AI MCP Proxy', function () {
  const pluginUrl = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/plugins`;

  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;

  let serviceId: string;

  before(async function () {
    const name = randomString();
    const service = await createGatewayService(name);
    serviceId = service.id;

  });

  context('tools with path parameter', async function () {
    let transport: StreamableHTTPClientTransport;
    let client: Client;
    const path = `/user/`;
    let routeId: string;

    before(async function () {
      const serverUrl = `${proxyUrl}${path}`;

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

      transport = new StreamableHTTPClientTransport(
        new URL(serverUrl),
        {}
      );

      const route = await createRouteForService(serviceId, [path]);
      routeId = route.id;

      const postFunction = {
        name: 'post-function',
        route: {
          id: routeId,
        },
        config: {
          access: [
            `
            local res = string.format("path is %s", kong.request.get_path())
            kong.response.exit(200, res)
            `
          ]
        },
      };
      const resp = await axios.post(pluginUrl, postFunction,{
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
    });

    it("setup AI MCP Proxy plugin", async function () {
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
              path: `/user/{userId}/order/{orderId}`,
              method: 'GET',
              parameters: [
                {name: "userId", in: "path", description: "The user ID", required: true},
                {name: "orderId", in: "path", description: "The order ID", required: true},
              ],
              annotations: {
                title: "user-order-tool",
              },
            },
          ],
        },
      };
      const resp = await axios.post(pluginUrl, payload,  {
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
      await waitForConfigRebuild();
    });

    it("initialize mcp client", async function () {
      await client.connect(transport);
      const sessionId = transport.sessionId
      logDebug(`Transport created with session ID: ${sessionId}`);
      logDebug('Connected to MCP server');
    });

    it("mcp client calls tool", async function () {
      const name = "user-order-tool";
      const args = { path_userId: 'foo', path_orderId: 'bar' };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res: any = await client.callTool({
        name,
        arguments: args,
      });
      res.content.forEach((item: any) => {
        expect(item.text).to.equal('path is /user/foo/order/bar');
      });
    });

    after(async function () {
      await transport.close();
    });
  });

  context('check http request sent to the upstream in tools/call', async function () {
    let transport: StreamableHTTPClientTransport;
    let client: Client;
    const path = `/test`;
    let serviceId: string;
    let routeId: string;

    before(async function () {
      const echoBackService = await createGatewayService('echo-back', { url: 'http://httpbin/headers' });
      serviceId = echoBackService.id;
      const serverUrl = `${proxyUrl}${path}`;

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

      transport = new StreamableHTTPClientTransport(
        new URL(serverUrl),
        {
          requestInit: {
            headers: {
              'User-Agent': 'MCP-Client-Test/1.0',
              'Authorization': 'Bearer test',
              'B3': 'traceid-spanid-1',
              'Connection': 'close',
              'Proxy-Authenticate': 'Basic',
              'Bar': 'bar-default',
              'Cookie': 'name=value',
            },
          },
        }
      );

      const route = await createRouteForService(serviceId, [path]);
      routeId = route.id;
    });

    it("setup AI MCP Proxy plugin", async function () {
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
              description: 'description',
              method: 'GET',
              parameters: [
                {name: "foo", in: "header", required: true},
                {name: "bar", in: "header", required: true},
              ],
              annotations: {
                title: "test",
              },
            },
          ],
        },
      };
      const resp = await axios.post(pluginUrl, payload,  {
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
      await waitForConfigRebuild();
    });

    it("initialize mcp client", async function () {
      await client.connect(transport);
      const sessionId = transport.sessionId
      logDebug(`Transport created with session ID: ${sessionId}`);
      logDebug('Connected to MCP server');
    });

    it("mcp client calls tool", async function () {
      const name = "test";
      const args = { header_foo: 'foo', header_bar: 'bar' };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res: any = await client.callTool({
        name,
        arguments: args,
      });
      logDebug(`Tool call response: ${JSON.stringify(res, null, 2)}`);
      res.content.forEach((item: any) => {
        const json = JSON.parse(item.text);
        for (const pair of Object.entries({
          'Authorization': 'Bearer test',
          'B3': 'traceid-spanid-1',
          'Foo': 'foo',
          'Bar': 'bar',
        })) {
          const [k, v] = pair;
          expect(json.headers[k]).to.equal(v);
        }
        for (const h of ['Proxy-Authenticate', 'Accept', 'Cookie', 'MCP-Session-Id']) {
          expect(json.headers).to.not.have.property(h);
        }
        // Should not directly pass `Connection: close` header to upstream
        expect(json.headers['Connection']).to.equal('keep-alive');
      });
    });

    after(async function () {
      await transport.close();
    });
  });

  context('multiple tools in a route', async function () {
    let transport: StreamableHTTPClientTransport;
    let client: Client;
    const path = `/${randomString()}`;
    let routeId: string;
    let tools: any[];

    before(async function () {
      const serverUrl = `${proxyUrl}${path}`;

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

      transport = new StreamableHTTPClientTransport(
        new URL(serverUrl),
        {}
      );

      const route = await createRouteForService(serviceId, [path]);
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
            local h_bar = kong.request.get_header("bar")
            local method = kong.request.get_method()
            local res = string.format("method is %s, has header foo: %s, has header bar: %s",
                                      method, h_foo ~= nil, h_bar ~= nil)
            kong.response.exit(200, res)
            `
          ]
        },
      };
      const resp = await axios.post(pluginUrl, postFunction,{
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
    });

    it("setup AI MCP Proxy plugin with multiple tools", async function () {
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
              description: 'Tool 1 description',
              method: 'GET',
              parameters: [
                {name: "foo", in: "header", description: "The parameter", required: true},
              ],
            },
            {
              description: 'Tool 2 description',
              method: 'POST',
              parameters: [
                {name: "bar", in: "header", description: "The parameter", required: true},
              ],
            },
          ],
        },
      };
      const resp = await axios.post(pluginUrl, payload,  {
        validateStatus: function () {
          // Always resolve (never throw), even for 4xx/5xx
          return true;
        }
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
      await waitForConfigRebuild();
    });

    it("initialize mcp client", async function () {
      await client.connect(transport);
      const sessionId = transport.sessionId
      logDebug(`Transport created with session ID: ${sessionId}`);
      logDebug('Connected to MCP server');
    });

    it("mcp client lists tools", async function () {
      const res = await client.listTools()
      tools = res.tools;
      logDebug(`Available tools: ${tools}`);
      expect(tools.length).to.equal(2);
      expect(tools[0].description).to.equal('Tool 1 description');
      expect(tools[1].description).to.equal('Tool 2 description');
    });

    it("mcp client calls tool", async function () {
      const openai = new OpenAI( { apiKey: vars.ai_providers.OPENAI_API_KEY, });
      const toolsForOpenAI : any = []
      for (const tool of tools) {
        toolsForOpenAI.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              ...tool.inputSchema,
            },
            strict: true,
          }
        });
      }
      logDebug(`Tools for OpenAI: ${JSON.stringify(toolsForOpenAI, null, 2)}`);

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: "Call the last given tool in the prompt" }],
        tools: toolsForOpenAI,
        tool_choice: 'required',
        store: true,
      });
      logDebug(`Completion response: ${JSON.stringify(completion, null, 2)}`);

      const toolCalls = completion.choices[0].message.tool_calls;
      if (toolCalls === undefined || toolCalls.length === 0) {
        expect.fail('No tool calls found in the completion response');
        return;
      }
      const toolCall = toolCalls[0] as ChatCompletionMessageFunctionToolCall;
      const name = toolCall.function.name;
      const args = toolCall.function.arguments;
      logDebug(`Calling tool '${name}' with args: ${args}`);
      const res : any = await client.callTool({
        name,
        arguments: JSON.parse(args),
      });
      res.content.forEach((item: any) => {
        expect(item.text).to.equal('method is POST, has header foo: false, has header bar: true');
      });
    });

    after(async function () {
      await transport.close();
      // The clients don't have `close` method, so we don't need to call it.
    });
  });

  context('tools with relative path', async function () {
    let transport: StreamableHTTPClientTransport;
    let client: Client;
    const basePath = `/user`;
    let routeId: string;

    before(async function () {
      const serverUrl = `${proxyUrl}${basePath}`;

      client = new Client(
        {
          name: 'example-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        },
      );
      client.onerror = error => {
        console.error('\x1b[31mClient error:', error, '\x1b[0m');
      };

      transport = new StreamableHTTPClientTransport(new URL(serverUrl), {});

      const route = await createRouteForService(serviceId, [basePath]);
      routeId = route.id;

      const postFunction = {
        name: 'post-function',
        route: {
          id: routeId,
        },
        config: {
          access: [
            `
            local res = string.format("path is %s", kong.request.get_path())
            kong.response.exit(200, res)
            `,
          ],
        },
      };
      const resp = await axios.post(pluginUrl, postFunction);
      logResponse(resp);
      expect(resp.status).to.equal(201);
    });

    it("setup AI MCP plugin", async function () {
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
              path: `user/{userId}/order/{orderId}`,
              method: 'GET',
              parameters: [
                {name: "userId", in: "path", description: "The user ID", required: true},
                {name: "orderId", in: "path", description: "The order ID", required: true},
              ],
              annotations: {
                title: "user-order-tool",
              },
            },
          ],
          server: {},
        },
      };
      const resp = await axios.post(pluginUrl, payload,  {
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
      await waitForConfigRebuild();
    });

    it('initialize mcp client', async function () {
      await client.connect(transport);
      const sessionId = transport.sessionId;
      logDebug(`Transport created with session ID: ${sessionId}`);
      logDebug('Connected to MCP server');
    });

    it("mcp client calls tool", async function () {
      const name = "user-order-tool";
      const args = { path_userId: 'foo', path_orderId: 'bar' };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res: any = await client.callTool({
        name,
        arguments: args,
      });
      res.content.forEach((item: any) => {
        expect(item.text).to.equal('path is /user/user/foo/order/bar');
      });
    });

    after(async function () {
      await transport.close();
    });

  });

  afterEach(function() {
    if (this.currentTest?.state === 'failed') {
      const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
      getGatewayContainerLogs(kongContainerName, 100);
    }
  });

  after(async function () {
    await clearAllKongResources()
  });
});