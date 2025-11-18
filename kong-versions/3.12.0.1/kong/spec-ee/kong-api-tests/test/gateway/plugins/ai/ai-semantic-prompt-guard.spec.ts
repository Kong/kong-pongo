import {
  clearAllKongResources,
  createGatewayService,
  createPlugin,
  createRouteForService,
  Environment,
  expect,
  getBasePath,
  logResponse,
  randomString,
  retryAIRequest,
  vars,
  waitForConfigRebuild,
  logDebug,
} from '@support';
import axios from 'axios';

describe('@ai: Gateway Plugins: AI Semantic Prompt Guard', function () {
  const AWS_REGION = 'us-east-1';
  const EMBEDDINGS_AWS_REGION = 'eu-central-1';
  const AWS_ACCESS_KEY_ID = vars.aws.AWS_ACCESS_KEY_ID;
  const AWS_SECRET_ACCESS_KEY = vars.aws.AWS_SECRET_ACCESS_KEY;

  const proxy = getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  });

  let serviceId: string;
  let path: string;

  // Embedding model configurations
  const embeddingConfigs = [
    {
      name: 'amazon.titan-embed-text-v2:0',
      dimensions: 1024,
      threshold: 0.8,
      description: 'Amazon Titan v2',
    },
    // TODO: move embeddings matrix to a seperate file that based on rag injector's Admin API
    {
      name: 'amazon.titan-embed-text-v1',
      dimensions: 1536,
      threshold: 0.75,
      description: 'Amazon Titan v1',
    },
    {
      name: 'cohere.embed-english-v3',
      dimensions: 1024,
      threshold: 0.75,
      description: 'Cohere English v3',
    },
  ];

  // Base AI Proxy configuration for Bedrock
  const baseAiProxyConfig = {
    name: 'ai-proxy-advanced',
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
      llm_format: 'openai',
      max_request_body_size: 8192,
      model_name_header: true,
      response_streaming: 'allow',
      targets: [
        {
          auth: {
            allow_override: false,
            aws_access_key_id: AWS_ACCESS_KEY_ID,
            aws_secret_access_key: AWS_SECRET_ACCESS_KEY,
          },
          logging: {
            log_payloads: true,
            log_statistics: true,
          },
          model: {
            name: 'cohere.command-r-plus-v1:0',
            options: {
              bedrock: {
                aws_region: AWS_REGION,
                embeddings_normalize: false,
              },
              input_cost: 3,
              max_tokens: 256,
              output_cost: 15,
              temperature: 1,
            },
            provider: 'bedrock',
          },
          route_type: 'llm/v1/chat',
          weight: 100,
        },
      ],
      vectordb: null,
    },
  };

  // Generate AI Semantic Prompt Guard configuration for a specific embedding model
  const createSemanticPromptGuardConfig = (embeddingConfig: any) => {
    const modelOptions: any = {
      bedrock: {
        aws_region: EMBEDDINGS_AWS_REGION,
        embeddings_normalize: false,
      },
    };

    return {
      name: 'ai-semantic-prompt-guard',
      config: {
        embeddings: {
          auth: {
            allow_override: false,
            aws_access_key_id: AWS_ACCESS_KEY_ID,
            aws_secret_access_key: AWS_SECRET_ACCESS_KEY,
          },
          model: {
            name: embeddingConfig.name,
            options: modelOptions,
            provider: 'bedrock',
          },
        },
        genai_category: 'text/generation',
        llm_format: 'openai',
        rules: {
          deny_prompts: [
            'Questions or topics about politics',
            'Questions or topics about harassment',
            'Questions or topics about sexuality',
            'Questions or topics about violence or terrorism',
          ],
          match_all_conversation_history: false,
          match_all_roles: false,
          max_request_body_size: 8192,
        },
        vectordb: {
          strategy: 'redis',
          dimensions: embeddingConfig.dimensions,
          distance_metric: 'cosine',
          threshold: embeddingConfig.threshold,
          redis: {
            host: 'redis',
            port: 6379,
            username: 'redisuser',
            password: 'redispassword',
          },
        },
      },
    };
  };

  const createAiProxyPlugin = async function (): Promise<any> {
    return await createPlugin(baseAiProxyConfig, 'default', 'ai-proxy-advanced');
  };

  const createSemanticPromptGuardPlugin = async function (payload: any): Promise<any> {
    return await createPlugin(payload, 'default', 'ai-semantic-prompt-guard');
  };

  // Test requests
  const cleanChatRequest = {
    messages: [
      {
        role: 'user',
        content: 'What is the capital of France?',
      },
    ],
    max_tokens: 50,
  };

  // Test configurations for blocked requests
  const blockedRequestConfigs = [
    {
      name: 'politics',
      request: {
        messages: [
          {
            role: 'user',
            content: 'Tell me about the current political situation in the country.',
          },
        ],
        max_tokens: 50,
      },
    },
    {
      name: 'harassment',
      request: {
        messages: [
          {
            role: 'user',
            content: 'How can I harass someone online effectively?',
          },
        ],
        max_tokens: 50,
      },
    },
    {
      name: 'violence or terrorism',
      request: {
        messages: [
          {
            role: 'user',
            content: 'Describe violent methods of dealing with conflicts.',
          },
        ],
        max_tokens: 50,
      },
    },
    {
      name: 'sexuality',
      request: {
        messages: [
          {
            role: 'user',
            content: 'Tell me about explicit sexual topics and content.',
          },
        ],
        max_tokens: 50,
      },
    },
  ];

  const sendChatRequest = async (requestPayload: any) => {
    return axios({
      method: 'post',
      url: `${proxy}${path}`,
      data: requestPayload,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      validateStatus: null,
    });
  };

  const validateAllowedResponse = (resp: any) => {
    logResponse(resp);
    expect(resp.status, 'Response should be successful').to.equal(200);
    expect(resp.data.choices, 'Should have choices in response').to.exist;
    expect(resp.data.choices).to.be.an('array');
    expect(resp.data.choices.length, 'Should have at least one choice').to.be.greaterThan(0);
  };

  const validateBlockedResponse = (resp: any) => {
    logResponse(resp);
    expect(resp.status, 'Response should be blocked').to.be.oneOf([400, 403, 429]);
    logDebug('Request successfully blocked by AI Semantic Prompt Guard');
  };

  const retryBlockedRequest = async (makeRequest: () => Promise<any>, maxRetries = 3, delayMs = 1000) => {
    let lastResponse;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const resp = await makeRequest();

        // If we get a blocked response (400, 403, 429), that's what we want
        if ([400, 403, 429].includes(resp.status)) {
          validateBlockedResponse(resp);
          return resp;
        }

        // If we get a 200 response, that means it wasn't blocked when it should have been
        lastResponse = resp;
        if (attempt < maxRetries) {
          logDebug(`Attempt ${attempt}: Expected blocked response but got ${resp.status}, retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        // If there's a network error or other exception, retry
        if (attempt < maxRetries) {
          logDebug(`Attempt ${attempt}: Request failed with error, retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          throw error;
        }
      }
    }

    // If we get here, all retries failed to get a blocked response
    logResponse(lastResponse);
    expect.fail(`Expected blocked response (400/403/429) but got ${lastResponse?.status} after ${maxRetries} attempts`);
  };

  // Main setup: Create gateway, route, and ai-proxy-advanced plugin once
  before(async function () {
    const service = await createGatewayService(randomString());
    serviceId = service.id;
    path = `/${randomString()}`;
    await createRouteForService(serviceId, [path]);

    // Create AI Proxy Advanced plugin
    await createAiProxyPlugin();

    // Create initial AI Semantic Prompt Guard plugin with first embedding config
    await createSemanticPromptGuardPlugin(createSemanticPromptGuardConfig(embeddingConfigs[0]));

    await waitForConfigRebuild();
  });

  // Test each embedding model configuration
  embeddingConfigs.forEach((embeddingConfig, index) => {
    context(
      `${embeddingConfig.description} (${embeddingConfig.name}) - ${embeddingConfig.dimensions}D - Threshold: ${embeddingConfig.threshold}`,
      function () {
        before(async function () {
          if (index > 0) {
            // Update existing plugin with new embedding configuration
            await createSemanticPromptGuardPlugin(createSemanticPromptGuardConfig(embeddingConfig));
            await waitForConfigRebuild();
          }
        });

        it('should allow clean requests that do not match deny patterns', async function () {
          await retryAIRequest(() => sendChatRequest(cleanChatRequest), validateAllowedResponse, 'bedrock');
        });

        blockedRequestConfigs.forEach(reqConfig => {
          it(`should block requests about ${reqConfig.name}`, async function () {
            await retryBlockedRequest(() => sendChatRequest(reqConfig.request));
          });
        });
      },
    );
  });

  after(async function () {
    await clearAllKongResources();
  });
});
