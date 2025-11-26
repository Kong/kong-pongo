import axios from 'axios';
import {
  expect,
  createGatewayService,
  createRouteForService,
  clearAllKongResources,
  getBasePath,
  isGateway,
  Environment,
  logResponse,
  waitForConfigRebuild,
  vars,
  logDebug,
} from '@support'
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

// This test file tests the 'thinking' feature of different LLM providers.
// TODO: test more providers when supported.
describe('@ai: Gateway Plugins: AI Proxy Advanced - thinking', function () {
  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })
  let serviceId: string;

  before(async function () {
    const service = await createGatewayService('ai-test-service')
    serviceId = service.id
  });

  context('should be able to proxy bedrock extended thinking request', async function () {
    const aws_region = 'us-east-1';
    const bedrock_version = "bedrock-2023-05-31";
    const model = 'us.anthropic.claude-sonnet-4-20250514-v1:0'
    // Use word 'invoke' in the prefix to ensure we can distinguish it from the real command used by SDK.
    const path = '/ai_proxy_test/bedrock/invoke'
    const bedrockClient = new BedrockRuntimeClient({
      region: aws_region,
      endpoint: `${proxyUrl}${path}`,
    });

    before(async function () {
      await createRouteForService(serviceId, [path])
      const pluginPayload = {
        name: 'ai-proxy-advanced',
        config: {
          llm_format: 'bedrock',
          targets: [{
            model: {
              name: model,
              provider: 'bedrock',
              options: {
                "bedrock": {
                  "aws_region": aws_region
                }
              },
            },
            auth: {
              aws_access_key_id: `${vars.aws.AWS_ACCESS_KEY_ID}`,
              aws_secret_access_key: `${vars.aws.AWS_SECRET_ACCESS_KEY}`,
            },
            route_type: 'llm/v1/chat',
          }],
        }
      }
      const res = await axios({
        method: 'post',
        url: `${adminUrl}/plugins`,
        data: pluginPayload,
        validateStatus: null
      })

      logResponse(res)
      expect(res.status, 'Status should be 201').to.equal(201)
      await waitForConfigRebuild()
    })

    it('for non-streaming request', async function () {
      const payload = {
        anthropic_version: bedrock_version,
        max_tokens: 10000,
        thinking: {
          "type": "enabled",
          "budget_tokens": 4000
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What is 27 * 453?",
              },
            ],
          },
        ],
      };

      const resp = await bedrockClient.send(
        new InvokeModelCommand({
          contentType: "application/json",
          body: JSON.stringify(payload),
          modelId: model,
        })
      );

      const decodedResponseBody = new TextDecoder().decode(resp.body)
      logDebug(`Response: ${decodedResponseBody}`)
      const res = JSON.parse(decodedResponseBody)
      expect(res.content[0]).has.property('thinking')
    })

    it('for streaming request', async function () {
      const payload = {
        anthropic_version: bedrock_version,
        max_tokens: 10000,
        thinking: {
          "type": "enabled",
          "budget_tokens": 4000
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "What is 27 * 453?",
              },
            ],
          },
        ],
      };

      const resp = await bedrockClient.send(
        new InvokeModelWithResponseStreamCommand({
          contentType: "application/json",
          body: JSON.stringify(payload),
          modelId: model,
        })
      );

      // Decode and parse the response
      const decoder = new TextDecoder("utf-8");
      if (!resp.body) {
        expect.fail('Response body is empty')
        return
      }

      let has_thinking = false;
      for await (const event of resp.body) {
        if (event.chunk) {
          const text = decoder.decode(event.chunk.bytes);
          logDebug(`Chunk: ${text}`)
          const json = JSON.parse(text)
          if (json.content_block && json.content_block.type === 'thinking') {
            has_thinking = true
            break
          }
        }
      }
      expect(has_thinking, 'Response should contain thinking block').to.be.true
    })
  })

  after(async function () {
    await clearAllKongResources()
  });
})
