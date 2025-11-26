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
  getGatewayContainerLogs,
  getKongContainerName,
  isGwHybrid,
  logResponse,
  randomString,
  retryAIRequest,
  vars,
  waitForConfigRebuild,
} from '@support';
import axios from 'axios';

// This test file focuses on testing embeddings API providers' behaviors
describe('@ai: Gateway Plugins: AI Semantic Cache: embeddings', function () {
  const proxy = getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  });
  const logsCollectingPathPrefix = `/ai/collect`;
  let serviceId: string;

  before(async function () {
    checkGwVars('ai_providers');

    const service = await createGatewayService(randomString());
    serviceId = service.id;

    const payload = {
      name: 'ai-proxy-advanced',
      config: {
        targets: [{
          model: {
            name: "gpt-4",
            provider: "openai",
            options: {
              input_cost: 10,
              output_cost: 100,
            },
          },
          auth: {
            header_name: 'Authorization',
            header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
          },
          route_type: 'llm/v1/chat',
          logging: {
            log_statistics: true,
          },
        }],
      },
    };
    createPlugin(payload, "default", "ai-proxy-advanced");
  });

  type EmbeddingsVariant = {
    name: string;
    auth: object;
    model: {
      provider: string;
      name: string;
      options?: object;
    };
    dimensions: number;
  };
  const embeddingsVariants: EmbeddingsVariant[] = [
    {
      name: "openai",
      auth: {
        header_name: 'Authorization',
        header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
      },
      model: {
        provider: 'openai',
        name: 'text-embedding-3-small',
      },
      dimensions: 1536,
    },
    {
      name: "mistral",
      auth: {
        header_name: "Authorization",
        header_value: `Bearer ${vars.ai_providers.MISTRAL_API_KEY}`,
      },
      model: {
        provider: "mistral",
        name: "mistral-embed",
      },
      dimensions: 1024,
    },
    {
      name: "azure",
      auth: {
        header_name: "api-key",
        header_value: vars.ai_providers.AZUREAI_API_KEY,
      },
      model: {
        name: "text-embedding-3-small",
        options: {
          azure: {
            instance: "ai-gw-sdet-e2e-test",
            deployment_id: "text-embedding-3-small",
            api_version: "2024-10-21",
          }
        },
        provider: "azure"
      },
      dimensions: 1536,
    },
    {
      name: "bedrock",
      auth: {
        aws_access_key_id: `${vars.aws.AWS_ACCESS_KEY_ID}`,
        aws_secret_access_key: `${vars.aws.AWS_SECRET_ACCESS_KEY}`
      },
      model: {
        name: "amazon.titan-embed-text-v2:0",
        options: {
          bedrock: {
            aws_region: "ap-northeast-1",
          }
        },
        provider: "bedrock"
      },
      dimensions: 1024,
    },
    {
      name: "bedrock-titan-v1",
      auth: {
        aws_access_key_id: `${vars.aws.AWS_ACCESS_KEY_ID}`,
        aws_secret_access_key: `${vars.aws.AWS_SECRET_ACCESS_KEY}`
      },
      model: {
        name: "amazon.titan-embed-text-v1",
        options: {
          bedrock: {
            aws_region: "ap-northeast-1",
          }
        },
        provider: "bedrock"
      },
      dimensions: 1536,
    },
    {
      name: "gemini",
      auth: {
        param_location: "query",
        param_name: "key",
        param_value: `${vars.ai_providers.GEMINI_API_KEY}`,
      },
      model: {
        name: "text-embedding-004",
        provider: "gemini"
      },
      dimensions: 768,
    },
    {
      name: "gemini-vertex",
      auth: {
        gcp_use_service_account: true,
        gcp_service_account_json: `${vars.ai_providers.VERTEX_API_KEY}`,
      },
      model: {
        name: "text-embedding-004",
        options: {
          gemini: {
            api_endpoint: "us-central1-aiplatform.googleapis.com",
            project_id: "gcp-sdet-test",
            location_id: "us-central1",
          },
        },
        provider: "gemini"
      },
      dimensions: 768,
    },
    {
      name: "huggingface",
      auth: {
        header_name: 'Authorization',
        header_value: `Bearer ${vars.ai_providers.HUGGINGFACE_API_KEY}`,
      },
      model: {
        provider: 'huggingface',
        name: 'sentence-transformers/all-MiniLM-L6-v2',
      },
      dimensions: 384,
    },
  ];

  for (const embeddings of embeddingsVariants) {
    context(`with ${embeddings.name} embeddings`, function () {
      const aiLogPath = `${logsCollectingPathPrefix}/${embeddings.name}`;
      const baseSemanticCacheConfig = {
        name: 'ai-semantic-cache',
        config: {
          exact_caching: false,
          stop_on_failure: false,
          vectordb: {
            strategy: 'redis',
            dimensions: 0, // will be overridden per test
            distance_metric: 'cosine',
            threshold: 0.2,
            redis: {
              host: 'redis',
              port: 6379,
              username: 'redisuser',
              password: 'redispassword',
            }
          },
          embeddings: {
          },
        },
      };

      const makeRequest = (message: string) => axios({
        method: 'post',
        url: `${proxy}${path}`,
        data: {
          messages: [{
            'role': 'user',
            'content': message
          }]
        },
        headers: {
          'Accept-Encoding': 'gzip, deflate',
        },
        validateStatus: null
      });

      const semanticCacheConfig = {
        ...baseSemanticCacheConfig,
        config: {
          ...baseSemanticCacheConfig.config,
          vectordb: {
            ...baseSemanticCacheConfig.config.vectordb,
            dimensions: embeddings.dimensions,
          },
          embeddings: {
            auth: embeddings.auth,
            model: embeddings.model,
          },
        },
        route: {
          id: '',
        }
      };

      let routeId: string;
      let pluginId: string;
      let path: string;

      before(async function () {
        path = `/${randomString()}`;
        const route = await createRouteForService(serviceId, [path]);
        routeId = route.id;
        await createAILogCollectingRoute(`ai-log-service-${embeddings.name}`, routeId, aiLogPath);
        semanticCacheConfig.route.id = routeId;
        const resp = await createPlugin(semanticCacheConfig);
        pluginId = resp.id;
      });

      it(`should hit cache on upcoming requests`, async function () {
        await waitForConfigRebuild();

        let content = "";
        await retryAIRequest(
          () => makeRequest('What is the biggest country in the world?'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Miss');
            content = resp.data.choices[0].message.content;
          },
          embeddings.name,
        );

        let cachedContent = "";
        await retryAIRequest(
          () => makeRequest('Tell me the biggest country in the world.'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Hit');
            cachedContent = resp.data.choices[0].message.content;
          },
          embeddings.name,
        );

        expect(cachedContent).to.equal(content);

        const logsResp = await axios({
          method: 'get',
          url: `${proxy}${aiLogPath}`,
          validateStatus: null
        });

        logResponse(logsResp);
        expect(logsResp.status).to.equal(200);
        const data = logsResp.data
        const cache = data.proxy.cache;
        expect(cache.embeddings_provider).to.be.equal(embeddings.model.provider);
        expect(cache.embeddings_model).to.be.equal(embeddings.model.name);
        expect(cache.embeddings_latency).to.be.a('number').that.is.greaterThan(0);

        if (embeddings.name !== "gemini" && embeddings.name !== "huggingface") {
          // Some providers do not return tokens usage for embeddings
          expect(cache.embeddings_tokens).to.be.a('number').that.is.greaterThan(0);
        }
      });

      it(`should bypass cache when the embeddings provider is unavailable: failed to auth`, async function () {
        const copy = JSON.parse(JSON.stringify(semanticCacheConfig));
        copy.config.embeddings.auth = {}; // remove auth to cause failure
        if (embeddings.name === "bedrock" || embeddings.name === "bedrock-titan-v1") {
          // For bedrock, use invalid auth to cause failure to avoid falling back
          copy.config.embeddings.auth = {
            aws_access_key_id: "invalid",
            aws_secret_access_key: "invalid"
          };
        }
        await createPlugin(copy, "", pluginId);
        await waitForConfigRebuild();

        await retryAIRequest(
          () => makeRequest('What is the biggest country in the world?'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Failed');
          },
          embeddings.name,
        );
      });

      it(`should bypass cache when the embeddings provider is unavailable: unexpected response`, async function () {
        const copy = JSON.parse(JSON.stringify(semanticCacheConfig));
        copy.config.embeddings.model.name = "non-exist-model"; // use non-exist model to cause failure
        if (embeddings.name === "azure") {
          // For azure, need to change deployment_id too
          copy.config.embeddings.model.options.azure.deployment_id = "non-exist-model";
        }
        await createPlugin(copy, "", pluginId);
        await waitForConfigRebuild();

        await retryAIRequest(
          () => makeRequest('What is the biggest country in the world?'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Failed');
          },
          embeddings.name,
        );
      });

      it(`should fail when embeddings provider is unavailable and stop_on_failure is true`, async function () {
        const copy = JSON.parse(JSON.stringify(semanticCacheConfig));
        copy.config.embeddings.model.name = "non-exist-model"; // use non-exist model to cause failure
        if (embeddings.name === "azure") {
          // For azure, need to change deployment_id too
          copy.config.embeddings.model.options.azure.deployment_id = "non-exist-model";
        }
        copy.config.stop_on_failure = true;
        await createPlugin(copy, "", pluginId);
        await waitForConfigRebuild();

        const resp = await makeRequest('What is the biggest country in the world?');
        logResponse(resp);
        expect(resp.status).to.equal(500);
      });
    });
  }

  afterEach(async function () {
    if (this.currentTest?.state === 'failed') {
      const dpContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
      getGatewayContainerLogs(dpContainerName, 100);
    }
  });

  after(async function () {
    await clearAllKongResources()
  });
});
