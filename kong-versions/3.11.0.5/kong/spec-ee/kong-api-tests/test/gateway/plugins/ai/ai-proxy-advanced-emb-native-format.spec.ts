import {
  GoogleGenAI,
} from '@google/genai';
import { Mistral } from '@mistralai/mistralai';
import {
  checkGwVars,
  clearAllKongResources,
  createAILogCollectingRoute,
  createGatewayService,
  createPlugin,
  createRouteForService,
  Environment,
  expect,
  getBasePath,
  isGateway,
  logDebug,
  logResponse,
  vars,
  waitForConfigRebuild,
} from '@support';
import axios from 'axios';
import _ from 'lodash';

// This test verify the emebddings functionality of the AI Proxy advanced plugin with their native llm format.
describe('@ai: Gateway Plugins: AI Proxy Advanced Embedding Test', function () {
  const sampleText = "The food was delicious and the waiter was very attentive.";

  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })
  const logsCollectingPathPrefix = `/ai/collect`;

  let serviceId: string;


  // Use typed keys
  // TODO: add other providers when needed
  const providers = ['gemini-vertex', 'gemini', 'mistral'] as const;

  // Define a type for the providers
  type EmbeddingProvider = typeof providers[number];

  const emb_models = {
    gemini: "gemini-embedding-001",
    mistral: "mistral-embed",
  };

  // Define a configuration object to store provider-specific settings
  const providerTestData: {
    [key in EmbeddingProvider]: {
      routeId: string | null;
      target: Record<string, any> | null;  // Allow object type for target
      tokenCount: number;
      llm_format: string,
    }
  } = {
    gemini: {
      routeId: null,
      target: null,
      tokenCount: 0,
      llm_format: 'gemini',
    },
    'gemini-vertex': {
      routeId: null,
      target: null,
      tokenCount: 0,
      llm_format: 'gemini'
    },
    mistral: {
      routeId: null,
      target: null,
      tokenCount: 32,
      llm_format: 'openai'
    },
  };

  const pluginPayload = {
    config: {
      max_request_body_size: 8192,
      genai_category: "text/embeddings",
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
      },
      llm_format: "openai"
    },
    route: { id: '' },
    name: 'ai-proxy-advanced'
  };

  type ProviderConfig = {
    [p in EmbeddingProvider]: {
      auth: object,
      model: {
        name: string,
        provider: string,
        options?: object,
      },
      route_type: string
    }
  }


  // Provider-specific configurations
  const providerConfigs: ProviderConfig = {
    gemini: {
      auth: {
        param_location: "query",
        param_name: "key",
        param_value: `${vars.ai_providers.GEMINI_API_KEY}`,
      },
      model: {
        name: emb_models.gemini,
        options: {
          input_cost: 100,
          output_cost: 100,
        },
        provider: "gemini"
      },
      route_type: "llm/v1/embeddings",
    },
    'gemini-vertex': {
      auth: {
        gcp_use_service_account: true,
        gcp_service_account_json: `${vars.ai_providers.VERTEX_API_KEY}`,
      },
      model: {
        name: emb_models.gemini,
        options: {
          input_cost: 100,
          output_cost: 100,
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
    mistral: {
      auth: {
        header_name: "Authorization",
        header_value: `Bearer ${vars.ai_providers.MISTRAL_API_KEY}`,
      },
      model: {
        name: emb_models.mistral,
        provider: "mistral",
        options: {
          mistral_format: 'openai',
        }
      },

      route_type: "llm/v1/embeddings",
    },
  };

  const getEmbeddingSample = (embeddings: object) => {
    const text = JSON.stringify(embeddings, null, 2);
    return text.length > 503 ? text.substring(0, 250) + '...' + text.substring(text.length - 250) : text;
  }

  const testGeminiEmbedding = async (client: GoogleGenAI, model: string, text: string) => {
    let res = await client.models.embedContent({
      model: model,
      contents: text,
    });
    logDebug(`Embedding response from ${model}: ${getEmbeddingSample(res)}`);

    let embeddings = res.embeddings || [];
    expect(embeddings, `${model} should return embedding data`).to.exist;
    expect(embeddings, `${model} embeddings should be an array`).to.be.an('array');
    expect(embeddings.length, `${model} embeddings should have dimensions`).to.be.equal(1);

    res = await client.models.embedContent({
      model: model,
      contents: [text, text],
    });
    logDebug(`Embedding response from ${model}: ${getEmbeddingSample(res)}`);

    embeddings = res.embeddings || [];
    expect(embeddings.length, `${model} embeddings should have dimensions`).to.be.equal(2);
  }

  const testMistralEmbedding = async (client: Mistral, model: string, text: string) => {
    let res = await client.embeddings.create({
      model: model,
      inputs: text,
    });
    logDebug(`Embedding response from ${model}: ${getEmbeddingSample(res)}`);

    let embeddings = res.data || [];
    expect(embeddings, `${model} should return embedding data`).to.exist;
    expect(embeddings, `${model} embeddings should be an array`).to.be.an('array');
    expect(embeddings.length, `${model} embeddings should have dimensions`).to.be.equal(1);

    res = await client.embeddings.create({
      model: model,
      inputs: [ text, text ],
    });
    logDebug(`Embedding response from ${model}: ${getEmbeddingSample(res)}`);

    embeddings = res.data || [];
    expect(embeddings.length, `${model} embeddings should have dimensions`).to.be.equal(2);
  }

  const providerTester: {
    [p in EmbeddingProvider]: (model: string, url: string, text: string) => Promise<void>
  } = {
    gemini: async (model: string, url: string, text: string) => {
      const client = new GoogleGenAI({
        httpOptions: {
          baseUrl: url,
        },
        apiKey: vars.ai_providers.GEMINI_API_KEY,
      });
      await testGeminiEmbedding(client, model, text);
    },

    "gemini-vertex": async (model: string, url: string, text: string) => {
      const client = new GoogleGenAI({
        httpOptions: {
          baseUrl: url,
        },
        project: 'gcp-sdet-test',
        location: 'us-central1',
        vertexai: true,
        googleAuthOptions: {
          credentials: JSON.parse(`${vars.ai_providers.VERTEX_API_KEY}`),
        },
      });
      await testGeminiEmbedding(client, model, text);
    },

    mistral: async (model: string, url: string, text: string) => {
      const client = new Mistral({
        serverURL: url,
        apiKey: vars.ai_providers.MISTRAL_API_KEY
      })

      await testMistralEmbedding(client, model, text);
    }
  };

  // Factory function for generating target configurations
  function createEmbTarget(provider: EmbeddingProvider) {
    // Common base configuration structure
    const baseConfig: Record<string, any> = {
      logging: {
        log_statistics: true,
        log_payloads: false
      },
      weight: 100
    };

    // Combine configurations
    return {
      ...baseConfig,
      ...providerConfigs[provider]
    };
  }



  before(async function () {
    checkGwVars('ai_providers');
    const gemini = new GoogleGenAI({
      apiKey: vars.ai_providers.GEMINI_API_KEY,
    });
    // Be careful, only a few models are supported by the token counting endpoint
    const res = await gemini.models.countTokens({
      model: emb_models.gemini,
      contents: [
        {
          parts: [{ text: sampleText }],
        },
      ],
    });
    let geminiTokenCount = -1;
    if (res.totalTokens) {
      geminiTokenCount = res.totalTokens * 2; // We test batch request with 2 identical inputs for gemini
    }

    const service = await createGatewayService('ai-emb-native-format-test-service');
    serviceId = service.id;
    for (const provider of providers) {
      // Create routes for each provider and store their IDs
      const routePath = `/emb/${provider}`;
      const resp = await createRouteForService(serviceId, [routePath]);
      providerTestData[provider].routeId = resp.id;

      // Generate the target configuration
      providerTestData[provider].target = createEmbTarget(provider);

      await createAILogCollectingRoute(`ai-log-service-${provider}`, resp.id, `${logsCollectingPathPrefix}/${provider}`);

      // Store expected token counts if applicable
      if (provider === 'gemini' || provider === 'gemini-vertex') {
        providerTestData[provider].tokenCount = geminiTokenCount;
      } else {
        // TODO: Add token counting logic for other providers
      }
    }

    await waitForConfigRebuild();
  })

  providers.forEach((provider) => {

    // Create plugins for each provider
    it(`should create AI proxy advanced plugin scoped to route for ${provider} test`, async function () {
      const embPayload = _.cloneDeep(pluginPayload);
      const { routeId, target, llm_format } = providerTestData[provider];
      embPayload.route.id = routeId;
      embPayload.config.targets = [target];
      embPayload.config.llm_format = llm_format;
      await createPlugin(embPayload);
      await waitForConfigRebuild();
    });

    it(`should successfully retrieve embeddings from ${provider} via ai-proxy-advanced plugin`, async function () {
      const { target } = providerTestData[provider];
      const model = target?.model.name;
      const routePath = `/emb/${provider}`;
      const test = providerTester[provider];
      await test(model, `${proxyUrl}${routePath}/embeddings`, sampleText);
    });

    it(`should successfully retrieve embeddings from ${provider} via ai-proxy-advanced plugin with logs`, async function () {
      const tokenCount = providerTestData[provider].tokenCount;

      const logsResp = await axios({
        method: 'get',
        url: `${proxyUrl}${logsCollectingPathPrefix}/${provider}`,
        validateStatus: null
      });

      logResponse(logsResp);
      expect(logsResp.status, `Logs response should be 200 for ${provider}`).to.equal(200);
      const logs = logsResp.data;
      expect(logs.proxy, `Logs should contain proxy information for ${provider}`).to.exist;
      expect(logs.proxy.meta, `Logs should contain meta information for ${provider}`).to.exist;
      expect(logs.proxy.usage, `Logs should contain usage information for ${provider}`).to.exist;
      const model = providerConfigs[provider].model;
      expect(logs.proxy.meta.response_model, `Response model should be present for ${provider}`).to.equal(model.name);
      expect(logs.proxy.meta.request_model, `Request model should be present for ${provider}`).to.equal(model.name);
      expect(logs.proxy.meta.provider_name, `Provider should be present for ${provider}`).to.equal(model.provider);
      expect(logs.proxy.meta.request_mode, `Request mode should be present for ${provider}`).to.equal('oneshot');
      expect(logs.proxy.usage.time_to_first_token, `Time to first token should be present for ${provider}`).to.be.greaterThan(0);
      expect(logs.proxy.usage.time_per_token, `Time per token should be present for ${provider}`).to.be.greaterThanOrEqual(0);
      if (provider !== 'gemini') {
        expect(logs.proxy.usage.prompt_tokens, `Prompt tokens should be present for ${provider}`).to.be.equal(tokenCount);
        expect(logs.proxy.usage.total_tokens, `Total tokens should be present for ${provider}`).to.be.equal(tokenCount);
        expect(logs.proxy.usage.completion_tokens, `Completion tokens should be present for ${provider}`).to.be.equal(0);
        if (provider !== 'mistral' ) {
          expect(logs.proxy.usage.cost, `Cost should be present for ${provider}`).to.be.greaterThan(0);
        }
      }
      expect(logs.proxy.tried_targets, `Tried targets should be present for ${provider}`).to.be.an('object');
    })

  });


  after(async function () {
    await clearAllKongResources();
  });

});
