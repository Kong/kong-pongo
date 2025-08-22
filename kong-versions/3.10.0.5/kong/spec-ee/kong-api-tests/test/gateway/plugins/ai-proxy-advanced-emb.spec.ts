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
  retryAIRequest
} from '@support'
import _ from 'lodash';
import axios from 'axios';

// This test verify the emebddings functionality of the AI Proxy advanced plugin with Openai llm format.
describe('Gateway Plugins: AI Proxy Advanced Embedding Test', function () {

  const aws_region = 'ap-northeast-1';
  const sampleText = "The food was delicious and the waiter was very attentive.";

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })
  const routePathAzure = '/emb/azure';
  const routePathBedrock = '/emb/bedrock';
  const routePathBedrockTitanV1 = '/emb/bedrock-titan-v1';
  const routePathOpenai = '/emb/openai';
  const routePathGemini = '/emb/gemini';
  const routePathGeminiVertex = '/emb/gemini-vertex';

  let serviceId: string;

  // Define a type for the providers
  type EmbeddingProvider = 'openai' | 'azure' | 'bedrock' | 'bedrock-titan-v1' | 'gemini' | 'gemini-vertex';

  // Use typed keys
  const providers: EmbeddingProvider[] = ['openai', 'azure', 'bedrock', 'bedrock-titan-v1', 'gemini', 'gemini-vertex'];

  const emb_models = {
    openai: "text-embedding-3-small",
    azure: "text-embedding-3-small",
    bedrock: "amazon.titan-embed-text-v2:0",
    "bedrock-titan-v1": "amazon.titan-embed-text-v1", // no :0 at the end
    gemini: "text-embedding-004",
  };

  // Define a configuration object to store provider-specific settings
  const providerTestData: {
    [key in EmbeddingProvider]: {
      routePath: string;
      routeId: string | null;
      target: Record<string, any> | null;  // Allow object type for target
    }
  } = {
    openai: {
      routePath: routePathOpenai,
      routeId: null,
      target: null,
    },
    azure: {
      routePath: routePathAzure,
      routeId: null,
      target: null,
    },
    bedrock: {
      routePath: routePathBedrock,
      routeId: null,
      target: null,
    },
    'bedrock-titan-v1': {
      routePath: routePathBedrockTitanV1,
      routeId: null,
      target: null,
    },
    gemini: {
      routePath: routePathGemini,
      routeId: null,
      target: null,
    },
    'gemini-vertex': {
      routePath: routePathGeminiVertex,
      routeId: null,
      target: null,
    }
  };

  const pluginPayload = {
    config: {
      max_request_body_size: 8192,
      genai_category: "text/embeddings",
      llm_format: 'openai', //using openai format for image gen and edit
      model_name_header: true,
      response_streaming: 'allow',
      targets: [] as Array<Record<string, any>>,
      balancer: {
        algorithm: 'round-robin',
        latency_strategy: 'tpot',
        retries: 5,
        slots: 1000,
        hash_on_header: 'X-Kong-LLM-Request-ID',
        failover_criteria: [
          'error',
          'timeout'
        ],
        connect_timeout: 60000,
        read_timeout: 60000,
        write_timeout: 60000
      }
    },
    route: { id: '' },
    name: 'ai-proxy-advanced'
  };

  // Factory function for generating target configurations
  function createEmbTarget(provider: EmbeddingProvider) {
    // Common base configuration structure
    const baseConfig: Record<string, any> = {
      logging: {
        log_statistics: false,
        log_payloads: false
      },
      weight: 100
    };


    // Provider-specific configurations
    const providerConfigs = {
      openai: {
        auth: {
          header_name: "Authorization",
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        model: {
          name: emb_models.openai,
          options: {},
          provider: "openai"
        },
        route_type: "llm/v1/embeddings"
      },
      azure: {
        auth: {
          header_name: "api-key",
          header_value: vars.ai_providers.AZUREAI_API_KEY,
        },
        model: {
          name: emb_models.azure,
          options: {
            azure_instance: "ai-gw-sdet-e2e-test",
            azure_deployment_id: emb_models.azure,
            azure_api_version: "2024-10-21",
          },
          provider: "azure"
        },
        route_type: "llm/v1/embeddings"
      },
      bedrock: {
        auth: {
          allow_override: false,
          aws_access_key_id: `${vars.aws.AWS_ACCESS_KEY_ID}`,
          aws_secret_access_key: `${vars.aws.AWS_SECRET_ACCESS_KEY}`
        },
        model: {
          name: emb_models.bedrock,
          options: {
            bedrock: {
              aws_region: aws_region
            }
          },
          provider: "bedrock"
        },
        route_type: "llm/v1/embeddings"
      },
      "bedrock-titan-v1": {
        auth: {
          allow_override: false,
          aws_access_key_id: `${vars.aws.AWS_ACCESS_KEY_ID}`,
          aws_secret_access_key: `${vars.aws.AWS_SECRET_ACCESS_KEY}`
        },
        model: {
          name: emb_models['bedrock-titan-v1'],
          options: {
            bedrock: {
              aws_region: aws_region
            }
          },
          provider: "bedrock"
        },
        route_type: "llm/v1/embeddings"
      },
      gemini: {
        auth: {
          param_location: "query",
          param_name: "key",
          param_value: `${vars.ai_providers.GEMINI_API_KEY}`,
        },
        model: {
          name: emb_models.gemini,
          options: {},
          provider: "gemini"
        },
        route_type: "llm/v1/embeddings"
      },
      'gemini-vertex': {
        auth: {
          gcp_use_service_account: true,
          gcp_service_account_json: `${vars.ai_providers.VERTEX_API_KEY}`,
        },
        model: {
          name: emb_models.gemini,
          options: {
            gemini: {
              api_endpoint: "us-central1-aiplatform.googleapis.com",
              project_id: "gcp-sdet-test",
              location_id: "us-central1",
            },
          },
          provider: "gemini"
        },
        route_type: "llm/v1/embeddings",
      },
    };

    // Combine configurations
    return {
      ...baseConfig,
      ...providerConfigs[provider]
    };
  }


  // Function to send embeddings request
  async function sendEmbeddingsRequest(url: string, text: string | string[]) {
    const resp = await axios({
      method: 'post',
      url: url,
      data: {
        input: text,
        encoding_format: 'float'
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*'
      },
      validateStatus: null
    });
    return resp;
  }

  // Function to validate embeddings response
  function validateEmbeddingsResponse(resp: any, provider = 'unknown') {
    // Check for successful status code
    expect(resp.status, `${provider} response should be successful`).to.equal(200);

    // Check model information if available
    if (resp.headers['x-kong-llm-model']) {
      logDebug(`Provider used: ${resp.headers['x-kong-llm-model']}`);
      if (provider in emb_models) {
        const expectedModelFragment = emb_models[provider as keyof typeof emb_models];
        expect(
          resp.data.model.toLowerCase(),
          `Response should include expected model for ${provider}`
        ).to.include(expectedModelFragment.toLowerCase());
      }
    }

    // Check for token usage information in the response body
    if (resp.data.usage) {
      logDebug('Token Usage Information:');

      if (resp.data.usage.prompt_tokens) {
        logDebug(`   Prompt tokens: ${resp.data.usage.prompt_tokens}`);
        // Verify we're being charged for input tokens
        expect(resp.data.usage.prompt_tokens, 'Should include prompt token count').to.be.greaterThan(0);
      }

      if (resp.data.usage.total_tokens) {
        logDebug(`   Total tokens: ${resp.data.usage.total_tokens}`);
        // Verify total tokens matches or exceeds prompt tokens
        expect(resp.data.usage.total_tokens, 'Should include total token count').to.be.at.least(
          resp.data.usage.prompt_tokens || 0
        );
      }
    }

    // Extract embedding based on what we see in the actual logs
    let embedding;

    if (resp.data.embedding) {
      // Bedrock format
      logDebug(`${provider} response format detected`);
      embedding = resp.data.embedding;
    } else if (resp.data.data && resp.data.data.length > 0) {
      // OpenAI and Azure format
      logDebug(`${provider} response format detected`);
      embedding = resp.data.data[0].embedding;
    }

    // Validate embedding data - essential to confirm the response is valid
    expect(embedding, `${provider} should return embedding data`).to.exist;
    expect(embedding, `${provider} embedding should be an array`).to.be.an('array');
    expect(embedding.length, `${provider} embedding should have dimensions`).to.be.greaterThan(0);

    return embedding;
  }

  before(async function () {
    //create a service and 3 different routes for use with ai-proxy-advanced plugin to different providers
    const service = await createGatewayService('ai-emb-test-service');
    serviceId = service.id;
    // Create routes for each provider and store their IDs
    for (const provider of providers) {
      const routePath = providerTestData[provider].routePath;
      const resp = await createRouteForService(serviceId, [routePath]);
      providerTestData[provider].routeId = resp.id;

      // Generate the target configuration
      providerTestData[provider].target = createEmbTarget(provider);
    }

    await waitForConfigRebuild();
  })

  // Create plugins for each provider
  providers.forEach((provider) => {

    it(`should create AI proxy advanced plugin scoped to route for ${provider} test`, async function () {
      const embPayload = _.cloneDeep(pluginPayload);
      const { routeId, target } = providerTestData[provider];
      embPayload.route.id = routeId;
      embPayload.config.targets = [target];

      const resp = await axios({
        method: 'post',
        url: `${adminUrl}/routes/${routeId}/plugins`,
        data: embPayload,
        validateStatus: null
      });

      logResponse(resp);

      expect(resp.status, 'Status should be 201').to.equal(201);
      expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

      await waitForConfigRebuild();
    });

    it(`should successfully retrieve embeddings from ${provider} via ai-proxy-advanced plugin`, async function () {
      const { routePath } = providerTestData[provider];
      logDebug(`Testing embeddings for provider: ${provider} with route: ${routePath}`);

      const makeRequest = () => sendEmbeddingsRequest(
        `${proxyUrl}${routePath}/embeddings`,
        sampleText
      );

      await retryAIRequest(
        makeRequest,
        (resp) => validateEmbeddingsResponse(resp, provider),
        provider
      );
    });

    if (provider !== 'bedrock' && provider !== 'bedrock-titan-v1') {
      it(`should successfully retrieve embeddings using array from ${provider} via ai-proxy-advanced plugin`, async function () {
        const { routePath } = providerTestData[provider];
        logDebug(`Testing embeddings for provider: ${provider} with route: ${routePath}`);

        const makeRequest = () => sendEmbeddingsRequest(
          `${proxyUrl}${routePath}/embeddings`,
          [sampleText, sampleText],
        );

        await retryAIRequest(
          makeRequest,
          (resp) => validateEmbeddingsResponse(resp, provider),
          provider
        );
      });
    }

  });


  after(async function () {
    await clearAllKongResources();
  });

});
