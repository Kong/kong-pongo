import axios from 'axios';
import {
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  Client,
} from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  OpenAI,
} from "openai";
import {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionTool,
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
  createPlugin,
  retryAIRequest,
  getDataFilePath,
} from '@support';
import {
  chat_typical,
} from '@shared/ai/ai_gateway_setups';
import * as fs from 'fs';

interface MCPToolCallTextContent {
  text: string;
}

interface MCPToolCallTextResponse {
  content: MCPToolCallTextContent[];
}

interface MCPToolCallImageContent {
  data: string; // base64-encoded image data
  mimeType: string;
}

interface MCPToolCallImageResponse {
  content: MCPToolCallImageContent[];
}

function createClientAndTransport(serverUrl: string, transportOptions?: any) {
  const client = new Client({
    name: 'example-client',
    version: '1.0.0'
  }, {
    capabilities: {
    },
  });
  client.onerror = (error) => {
    console.error('Client error:', error);
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(serverUrl),
    transportOptions || {}
  );

  return { client, transport };
}

describe('@ai: Gateway Plugins: AI MCP Proxy', function () {
  const pluginUrl = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/plugins`;

  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;

  let globalServiceId: string;

  before(async function () {
    const name = randomString();
    const service = await createGatewayService(name);
    globalServiceId = service.id;

  });

  context('tools with path parameter', async function () {
    let transport: StreamableHTTPClientTransport;
    let client: Client;
    const path = `/user/`;
    let routeId: string;

    before(async function () {
      const serverUrl = `${proxyUrl}${path}`;

      ({ client, transport } = createClientAndTransport(serverUrl));

      const route = await createRouteForService(globalServiceId, [path]);
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
          id: globalServiceId,
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
      const res = await client.callTool({
        name,
        arguments: args,
      }) as MCPToolCallTextResponse;
      res.content.forEach((item: MCPToolCallTextContent) => {
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
    let echoBackServiceId: string;
    let routeId: string;
    let pluginId: string;

    const payload = {
      name: 'ai-mcp-proxy',
      service: {
        id: '',
      },
      route: {
        id: '',
      },
      config: {
        mode: "conversion-listener",
        server: {
          forward_client_headers: true,
        },
        tools: [
          {
            description: 'description',
            method: 'GET',
            parameters: [
              {name: "foo", in: "header"},
              {name: "bar", in: "header"},
              {name: "debug", in: "cookie",
                schema: {
                  type: "integer",
                  enum: [0, 1],
                },
              },
              {name: "csrftoken", in: "cookie", schema: { type: "string" }, },
              {name: "array", in: "cookie",
                schema: {
                  type: "array",
                  items: {
                    type: "integer",
                  },
                },
              },
              {name: "object", in: "cookie",
                schema: {
                  type: "object",
                  properties: {
                    key1: { type: "string" },
                  },
                },
              },
            ],
            annotations: {
              title: "test",
            },
          },
        ],
      },
    };

    before(async function () {
      const echoBackService = await createGatewayService('echo-back', { url: 'http://httpbin/headers' });
      echoBackServiceId = echoBackService.id;
      const serverUrl = `${proxyUrl}${path}`;

      ({ client, transport } = createClientAndTransport(serverUrl, {
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
      }));

      const route = await createRouteForService(echoBackServiceId, [path]);
      routeId = route.id;
    });

    it("setup AI MCP Proxy plugin", async function () {
      payload.service.id = echoBackServiceId;
      payload.route.id = routeId;
      const res: any = await createPlugin(payload);
      pluginId = res.id;
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
      const tools = res.tools;
      logDebug(`Available tools: ${JSON.stringify(tools, null, 2)}`);
      expect(tools[0].inputSchema).to.deep.equal({
        type: 'object',
        properties: {
          header_foo: { type: 'string' },
          header_bar: { type: 'string' },
          cookie_debug: { type: 'integer', enum: [0, 1] },
          cookie_csrftoken: { type: 'string' },
          cookie_array: {
            type: 'array',
            items: { type: 'integer' },
          },
          cookie_object: {
            type: 'object',
            properties: {
              key1: { type: 'string' },
            },
          },
        },
        additionalProperties: false,
      });
    });

    it("mcp client calls tool", async function () {
      const name = "test";
      const args = { header_foo: 'foo', header_bar: 'bar' };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res = await client.callTool({
        name,
        arguments: args,
      }) as MCPToolCallTextResponse;
      logDebug(`Tool call response: ${JSON.stringify(res, null, 2)}`);
      res.content.forEach((item: MCPToolCallTextContent) => {
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

    it("configure not to forward client header", async function () {
      const newPayload = JSON.parse(JSON.stringify(payload));
      newPayload.config.server.forward_client_headers = false;
      await createPlugin(newPayload, "", pluginId);
      await waitForConfigRebuild();

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
          // Headers configured in the tools can still be sent
          'Foo': 'foo',
          'Bar': 'bar',
        })) {
          const [k, v] = pair;
          expect(json.headers[k]).to.equal(v);
        }
        // Headers from the client should not be forwarded
        for (const h of ['Authorization', 'B3', 'Proxy-Authenticate', 'Accept', 'Cookie', 'MCP-Session-Id']) {
          expect(json.headers).to.not.have.property(h);
        }
      });
    });

    it("mcp client calls tool with cookie", async function () {
      const name = "test";
      const args = {
        cookie_debug: 1,
        cookie_csrftoken: 'tokfafafa',
        cookie_array: [1, 2, 3],
        cookie_object: { key1: 'value1' },
      };
      logDebug(`Calling tool '${name}' with args: ${JSON.stringify(args)}`);
      const res = await client.callTool({
        name,
        arguments: args,
      }) as MCPToolCallTextResponse;
      logDebug(`Tool call response: ${JSON.stringify(res, null, 2)}`);
      res.content.forEach((item: MCPToolCallTextContent) => {
        const json = JSON.parse(item.text);
        const cookie = json.headers['Cookie'];
        expect(cookie).to.not.include('name=value');
        expect(cookie).to.include('debug=1');
        expect(cookie).to.include('csrftoken=tokfafafa');
        expect(cookie).to.include('array="1,2,3"');
        expect(cookie).to.include('object="key1,value1"');
      });

      // test cookie value that needs to be escaped
      const need_escaped_cases = [
        ["eq=ual", '"eq=ual"'],
        ["semicolon;", '"semicolon;"'],
        ['"quote"', '"\\"quote\\""'],
      ]
      for (const c of need_escaped_cases) {
        const input = c[0];
        const expected = c[1];
        const args = {
          cookie_csrftoken: input,
        };
        const res = await client.callTool({
          name,
          arguments: args,
        }) as MCPToolCallTextResponse;
        logDebug(`Tool call response: ${JSON.stringify(res, null, 2)}`);
        res.content.forEach((item: MCPToolCallTextContent) => {
          const json = JSON.parse(item.text);
          const cookie = json.headers['Cookie'];
          expect(cookie).to.equal("csrftoken=" + expected);
        });
      }
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

      ({ client, transport } = createClientAndTransport(serverUrl));

      const route = await createRouteForService(globalServiceId, [path]);
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
          id: globalServiceId,
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
      logDebug(`Available tools: ${JSON.stringify(tools, null, 2)}`);
      expect(tools.length).to.equal(2);
      expect(tools[0].description).to.equal('Tool 1 description');
      expect(tools[1].description).to.equal('Tool 2 description');
    });

    it("mcp client calls tool", async function () {
      const openai = new OpenAI( { apiKey: vars.ai_providers.OPENAI_API_KEY, });
      const toolsForOpenAI : ChatCompletionTool[] = []
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
      const res = await client.callTool({
        name,
        arguments: JSON.parse(args),
      }) as MCPToolCallTextResponse;
      res.content.forEach((item: MCPToolCallTextContent) => {
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

      ({ client, transport } = createClientAndTransport(serverUrl));

      const route = await createRouteForService(globalServiceId, [basePath]);
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
          id: globalServiceId,
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
      const res = await client.callTool({
        name,
        arguments: args,
      }) as MCPToolCallTextResponse;
      res.content.forEach((item: MCPToolCallTextContent) => {
        expect(item.text).to.equal('path is /user/user/foo/order/bar');
      });
    });

    after(async function () {
      await transport.close();
    });

  });

  context('conversion-only & listener mode', async function () {
    const path = `/${randomString()}`;
    const toolPath = `/${randomString()}`;
    const tag = randomString();

    let transport: StreamableHTTPClientTransport;
    let client: Client;

    before(async function () {
      const toolRoute = await createRouteForService(globalServiceId, ["~/regex_path_should_be_skip$", toolPath], {
        name: "tool-route",
        methods: ['POST'],
      });
      const payload = {
        name: 'ai-mcp-proxy',
        service: {
          id: globalServiceId,
        },
        route: {
          id: toolRoute.id,
        },
        tags: [tag],
        config: {
          mode: "conversion-only",
          tools: [
            {
              description: 'Tool description',
              request_body: {
                description: "Request body",
                content: {
                  "application/x-www-form-urlencoded": {
                    schema: {
                      type: "object",
                      properties: {
                        str_field: { type: "string" },
                        num_field: { type: "number" },
                      },
                      required: ["str_field", "num_field"],
                    },
                  },
                },
              },
            },
          ],
        },
      };
      let resp = await axios.post(pluginUrl, payload,  {
        validateStatus: null,
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);

      const postFunction = {
        name: 'post-function',
        route: {
          id: toolRoute.id,
        },
        config: {
          access: [
            `
            local body = kong.request.get_body()
            local res = string.format("body str_field: %s, num_field: %s", body.str_field, body.num_field)
            kong.response.exit(200, res)
            `
          ]
        },
      };
      resp = await axios.post(pluginUrl, postFunction,{
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);

      const mcpRoute = await createRouteForService(globalServiceId, [path]);
      const listenerPayload = {
        name: 'ai-mcp-proxy',
        service: {
          id: globalServiceId,
        },
        route: {
          id: mcpRoute.id,
        },
        config: {
          mode: "listener",
          server: {
            tag: tag,
          },
        },
      };
      resp = await axios.post(pluginUrl, listenerPayload,  {
        validateStatus: null,
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
      await waitForConfigRebuild();
    });

    it("send MCP request to listener", async function () {
      const serverUrl = `${proxyUrl}${path}`;

      ({ client, transport } = createClientAndTransport(serverUrl));

      await client.connect(transport);
      const pong = await client.ping();
      expect(pong).not.to.be.undefined;
      const res = await client.listTools()
      const tools = res.tools;
      logDebug(`Available tools: ${JSON.stringify(tools, null, 2)}`);
      expect(tools[0].description).to.equal('Tool description');
    });

    it("send non-MCP request to listener", async function () {
      const resp = await axios.post(`${proxyUrl}${path}`,
                                    {},
                                    {
                                      headers: {
                                        'Accept': '*/*',
                                      },
                                      validateStatus: null,
                                    });
      logResponse(resp);
      expect(resp.status).to.equal(406);
    });

    it("call conversed API via MCP request", async function () {
      const name = "tool-route-1";
      const args = { body: {
        str_field: 'foo',
        num_field: 42,
      } };
      const res = await client.callTool({
        name,
        arguments: args,
      }) as MCPToolCallTextResponse;
      res.content.forEach((item: MCPToolCallTextContent) => {
        expect(item.text).to.equal('body str_field: foo, num_field: 42');
      });
    });

    it("send MCP request to conversed API", async function () {
      const serverUrl = `${proxyUrl}${toolPath}`;

      const { client: convClient, transport: convTransport } = createClientAndTransport(serverUrl);

      try {
        await convClient.connect(convTransport);
        expect.fail('Should not be able to connect to the conversion-only route');
      } catch (error) {
        if (!(error instanceof StreamableHTTPError)) {
          console.error('unexpected error:', error);
          throw error;
        }
      }
    });

    after(async function () {
      await transport.close();
    });
  });

  context('tools with specific response type', async function () {
    it('tools with image response', async function () {
      const path = `/${randomString()}`;
      const serverUrl = `${proxyUrl}${path}`;

      const { client, transport } = createClientAndTransport(serverUrl);

      const route = await createRouteForService(globalServiceId, [path]);
      const routeId = route.id;

      const imagePath = getDataFilePath('ai/image_edit.png');
      const mimeType = 'image/png';
      const imageData = Buffer.from(fs.readFileSync(imagePath)).toString('base64');
      const postFunction = {
        name: 'post-function',
        route: {
          id: routeId,
        },
        config: {
          access: [
            `
            ngx.header["Content-Type"] = "${mimeType}"
            local data = [[${imageData}]]
            kong.response.exit(200, ngx.decode_base64(data))
            `
          ]
        },
      };
      let resp = await axios.post(pluginUrl, postFunction,{
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);

      const payload = {
        name: 'ai-mcp-proxy',
        service: {
          id: globalServiceId,
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
              annotations: {
                title: "tool",
              },
            },
          ],
        },
      };
      resp = await axios.post(pluginUrl, payload,  {
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
      await waitForConfigRebuild();

      await client.connect(transport);
      const name = "tool";
      const res = await client.callTool({
        name,
        arguments: {},
      }) as MCPToolCallImageResponse;
      res.content.forEach((item: MCPToolCallImageContent) => {
        expect(item.mimeType).to.equal(mimeType);
        expect(item.data).to.equal(imageData);
      });
    });
  });

  context('test generated tool schemas with LLM', async function () {
    const path = `/${randomString()}`;
    const toolPath1 = `/tool/1`;
    const toolPath2 = `/tool/2`;
    const tag = randomString();
    const toolsForOpenAI : ChatCompletionTool[] = []

    let transport: StreamableHTTPClientTransport;
    let client: Client;
    let tools: Tool[];

    it("setup multiple AI MCP Proxy plugins in different modes", async function () {
      const toolRoute1 = await createRouteForService(globalServiceId, [toolPath1], {
        name: "tool1",
        methods: ['GET'],
      });
      const toolRoute2 = await createRouteForService(globalServiceId, [toolPath2], {
        name: "tool2",
        methods: ['POST'],
      });
      for (const route of [toolRoute1, toolRoute2]) {
        const postFunction = {
          name: 'post-function',
          route: {
            id: route.id,
          },
          config: {
            access: [
              `
              local path = kong.request.get_path()
              local method = kong.request.get_method()
              local h_foo = kong.request.get_header("foo")
              local h_bar = kong.request.get_header("bar")
              local res = string.format("method is %s, path is %s, has header foo: %s, has header bar: %s",
                                        method, path, h_foo ~= nil, h_bar ~= nil)
              local body = kong.request.get_body()
              res = res .. string.format(", body str_field type: %s, num_field type: %s", type(body.str_field), type(body.num_field))
              local ct = kong.request.get_header("content-type")
              res = res .. string.format(", content-type is %s", ct or "nil")
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
      }

      let payload: any = {
        name: 'ai-mcp-proxy',
        service: {
          id: globalServiceId,
        },
        route: {
          id: toolRoute1.id,
        },
        tags: [tag],
        config: {
          mode: "conversion-only",
          tools: [
            {
              description: 'Tool description',
              parameters: [
                {name: "foo", in: "header", description: "The parameter", required: true},
              ],
              request_body: {
                description: "Request body",
                content: {
                  "application/json; charset=utf-8": {
                    schema: {
                      type: "object",
                      properties: {
                        str_field: { type: "string" },
                        num_field: { type: "number" },
                      },
                      required: ["str_field", "num_field"],
                    },
                  },
                },
              },
              annotations: {
                title: "tool1",
                read_only_hint: true,
                idempotent_hint: true,
                open_world_hint: false,
                destructive_hint: false,
              },
              // inherit path and method from the route
            },
          ],
        },
      };
      let resp = await axios.post(pluginUrl, payload,  {
        validateStatus: null,
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);

      payload = {
        name: 'ai-mcp-proxy',
        service: {
          id: globalServiceId,
        },
        route: {
          id: toolRoute2.id,
        },
        tags: [tag],
        config: {
          mode: "conversion-only",
          tools: [
            {
              description: 'Tool description',
              parameters: [
                {name: "bar", in: "header", description: "The parameter", required: true},
              ],
              annotations: {
                title: "tool2",
                read_only_hint: false,
                idempotent_hint: false,
                open_world_hint: true,
                destructive_hint: true,
              },
              // inherit path and method from the route
            },
          ],
        },
      };
      resp = await axios.post(pluginUrl, payload,  {
        validateStatus: null,
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);

      const mcpRoute = await createRouteForService(globalServiceId, [path]);
      const listenerPayload = {
        name: 'ai-mcp-proxy',
        service: {
          id: globalServiceId,
        },
        route: {
          id: mcpRoute.id,
        },
        config: {
          mode: "listener",
          server: {
            tag: tag,
          },
        },
      };
      resp = await axios.post(pluginUrl, listenerPayload,  {
        validateStatus: null,
      });
      logResponse(resp);
      expect(resp.status).to.equal(201);
      await waitForConfigRebuild();
    });

    it("initialize mcp client", async function () {
      const serverUrl = `${proxyUrl}${path}`;

      ({ client, transport } = createClientAndTransport(serverUrl));

      await client.connect(transport);
      const sessionId = transport.sessionId
      logDebug(`Transport created with session ID: ${sessionId}`);
    });

    it("check tools schema content", async function () {
      const res = await client.listTools()
      tools = res.tools;
      logDebug(`Available tools: ${JSON.stringify(tools, null, 2)}`);
      expect(tools.length).to.equal(2);
      expect(tools[0].annotations).to.deep.equal({
        title: 'tool1',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      });
      expect(tools[1].annotations).to.deep.equal({
        title: 'tool2',
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: true,
        destructiveHint: true,
      });

      for (const tool of tools) {
        toolsForOpenAI.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              ...tool.inputSchema,
            },
          }
        });
      }
      logDebug(`Tools for OpenAI: ${JSON.stringify(toolsForOpenAI, null, 2)}`);
    });

    // Use the cheapest model that supports tool call in each provider to ensure the models can understand
    const tests = [
      {
        provider: "openai",
        model: "gpt-4o-mini",
        settings: {
          apiKey: vars.ai_providers.OPENAI_API_KEY,
        }
      },
      // azure has the same model as openai, skip it here
      {
        provider: "gemini",
        model: "gemini-2.5-flash",
        settings: {
          serviceAccountJson: vars.ai_providers.VERTEX_API_KEY,
          locationId: "us-central1",
          apiEndpoint: "us-central1-aiplatform.googleapis.com",
          projectId: "gcp-sdet-test",
        }
      },
      {
        provider: "anthropic",
        model: "claude-3-5-haiku-20241022",
        settings: {
          apiKey: vars.ai_providers.ANTHROPIC_API_KEY,
          maxTokens: 8192, // this model only supports up to 8k context
        }
      },
      {
        provider: "bedrock",
        model: "amazon.nova-lite-v1:0",
        settings: {
          awsAccessKeyId: vars.aws.AWS_ACCESS_KEY_ID,
          awsSecretAccessKey: vars.aws.AWS_SECRET_ACCESS_KEY,
        }
      },
    ];

    for (const test of tests) {
      it(`call tool with provider ${test.provider} and model ${test.model}`, async function () {
        const testIdentifier = `${test.provider}_${test.model}`;
        const path = `/tool_use/${testIdentifier}`;
        const route = await createRouteForService(globalServiceId, [path]);
        const routeId = route.id;

        const testConfiguration = chat_typical(test.model, test.settings)[test.provider];

        const pluginPayload = {
          config: {
            llm_format: 'openai',
            targets: [
              {
                ...testConfiguration.target
              }
            ],
          },
          route: { id: routeId },
          name: 'ai-proxy-advanced'
        };
        await createPlugin(pluginPayload);
        await waitForConfigRebuild();

        const makeRequest = () => axios({
          method: 'post',
          url: `${proxyUrl}${path}`,
          data: {
            messages: [{
              'role': 'user',
              'content': 'Call the first given tool with any generated values for parameters',
            }],
            tools: toolsForOpenAI,
            tool_choice: 'required',
            store: true,
            model: test.model,
          },
          validateStatus: null
        })

        let toolCallAdvice: ChatCompletionMessageFunctionToolCall[] | undefined;
        await retryAIRequest(
          makeRequest,
          (resp) => {
            logResponse(resp);
            toolCallAdvice = resp.data.choices[0].message.tool_calls;
          },
          test.provider,
        );

        if (toolCallAdvice === undefined || toolCallAdvice.length === 0) {
          expect.fail('No tool calls found in the completion response');
          return;
        }
        const toolCall = toolCallAdvice[0] as ChatCompletionMessageFunctionToolCall;
        const name = toolCall.function.name;
        const args = toolCall.function.arguments;
        logDebug(`Calling tool '${name}' with args: ${args}`);
        const res = await client.callTool({
          name,
          arguments: JSON.parse(args),
        }) as MCPToolCallTextResponse;
        res.content.forEach((item: MCPToolCallTextContent) => {
          expect(item.text).to.equal('method is GET, path is /tool/1, has header foo: true, has header bar: false, body str_field type: string, num_field type: number, content-type is application/json; charset=utf-8');
        });
      });
    }

    after(async function () {
      if (transport) {
        await client.close();
      }
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
