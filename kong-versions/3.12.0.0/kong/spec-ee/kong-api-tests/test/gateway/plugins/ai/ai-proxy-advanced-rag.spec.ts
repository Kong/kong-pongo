import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  expect,
  createGatewayService,
  createRouteForService,
  clearAllKongResources,
  waitForConfigRebuild,
  randomString,
  createPlugin,
  getBasePath,
  isGateway,
  Environment,
  vars
} from '@support';

const MODE_NAME = 'anthropic.claude-3-haiku-20240307-v1:0';
const MODE_PROVIDER = 'bedrock';
const ROUTE_TYPE = 'llm/v1/chat';
const AWS_REGION = 'us-east-1';
const AWS_ACCESS_KEY_ID = `${vars.aws.AWS_ACCESS_KEY_ID}`;
const AWS_SECRET_ACCESS_KEY = `${vars.aws.AWS_SECRET_ACCESS_KEY}`;
const proxyUrl = getBasePath({
  environment: isGateway() ? Environment.gateway.proxy : undefined,
});
const client = new BedrockRuntimeClient({
  requestHandler: new NodeHttpHandler({}),
  region: AWS_REGION,
  endpoint: `${proxyUrl}/nat/bedrock`
});
const command = new ConverseCommand({
  modelId: MODE_NAME,
  messages: [
    {
      role: 'user',
      content: [
        {
          text: "What's the capital of France?",
        },
      ],
    },
  ],
});

describe('@ai: Gateway Plugins: AI Proxy Advanced - RAG(Retrieve and Generate)', function () {
  before(async function () {
    const dummyService = await createGatewayService(randomString(), {
      url: 'http://dummy.io',
    });
    const dummyRoute = await createRouteForService(dummyService.id, undefined, {
      name: randomString(),
      paths: ['/nat/bedrock'],
    });

    await createPlugin({
      name: 'ai-proxy-advanced',
      enabled: true,
      route: { id: dummyRoute.id },
      protocols: ['grpc', 'grpcs', 'http', 'https', 'ws', 'wss'],
      config: {
        balancer: {
          algorithm: 'round-robin',
          connect_timeout: 60000,
          failover_criteria: ['error', 'timeout'],
          hash_on_header: 'X-Kong-LLM-Request-ID',
          latency_strategy: 'tpot',
          read_timeout: 60000,
          retries: 5,
          slots: 10000,
          tokens_count_strategy: 'total-tokens',
          write_timeout: 60000,
        },
        embeddings: null,
        genai_category: 'text/generation',
        llm_format: 'bedrock',
        max_request_body_size: 8192,
        model_name_header: true,
        response_streaming: 'allow',
        targets: [
          {
            auth: {
              allow_override: false,
              azure_use_managed_identity: false,
              gcp_use_service_account: false,
              aws_access_key_id: AWS_ACCESS_KEY_ID,
              aws_secret_access_key: AWS_SECRET_ACCESS_KEY,
            },
            logging: { log_payloads: false, log_statistics: false },
            model: {
              options: {
                azure_api_version: '2023-05-15',
                bedrock: { embeddings_normalize: false, aws_region: AWS_REGION },
                cohere: { embedding_input_type: 'classification' },
                gemini: {},
                huggingface: {},
              },
              name: MODE_NAME,
              provider: MODE_PROVIDER,
            },
            weight: 100,
            route_type: ROUTE_TYPE,
          },
        ],
        vectordb: null,
      },
    });
    await waitForConfigRebuild();
  });

  it('should return converse response correctly', async function () {
    try {
      const response = await client.send(command);
      const resultText = response.output?.message?.content?.[0]?.text;
      console.log('Converse response:', resultText);
      expect(resultText).to.include('Paris');
    } catch (err) {
      console.error('Converse failed:', err);
      throw err;
    }
  });

  after(async function () {
    await clearAllKongResources();
  });
});