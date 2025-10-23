import axios from 'axios';
import {
  expect,
  createGatewayService,
  createRouteForService,
  getBasePath,
  Environment,
  logResponse,
  waitForConfigRebuild,
  randomString,
  isGwHybrid,
  getKongContainerName,
  getGatewayContainerLogs,
  clearAllKongResources,
  getPgvectorConfig,
  isPgvectorHealthy,
  createPlugin,
  vars,
  retryAIRequest,
  eventually,
  clearSemanticCache,
  createAILogCollectingRoute,
  checkOrStartServiceContainer,
  stopContainerByName,
} from '@support'

// This test file focuses on testing vectordb relative behaviors
describe('@ai: Gateway Plugins: AI Semantic Cache: vectordb', function () {
  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
  const DIMENSIONS = 3072;
  const baseAiSemanticCache = {
    name: 'ai-semantic-cache',
    config: {
      vectordb: {
        strategy: 'pgvector',
        dimensions: DIMENSIONS,
        distance_metric: 'cosine',
        threshold: 0.1,
        pgvector: getPgvectorConfig(),
      },
    },
  };
  const baseAiSemanticCacheWithOpenAI = {
    ...baseAiSemanticCache,
    config: {
      ...baseAiSemanticCache.config,
      embeddings: {
        auth: {
          header_name: 'Authorization',
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        model: {
          provider: 'openai',
          name: 'text-embedding-3-large',
        },
      },
    },
  };

  const createSemanticCachePlugin = async function (payload: any): Promise<any> {
    return await createPlugin(payload, "default", "ai-semantic-cache");
  }

  const proxy = getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  });
  const logsCollectingPathPrefix = `/ai/collect`;
  let serviceId: string;
  let routeId: string;
  let path: string;

  before(async function () {
    await checkOrStartServiceContainer('pgvector');
    await eventually(async () => {
      const ok = await isPgvectorHealthy();
      expect(ok, 'Pgvector should be healthy').to.be.true;
    });

    const service = await createGatewayService(randomString());
    serviceId = service.id;
    await createSemanticCachePlugin(baseAiSemanticCacheWithOpenAI);
  });

  const createOpenAIProxy = async function () {
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
  }

  const vectordbVariants = [
    {
      name: 'pgvector',
      config: getPgvectorConfig(),
    },
    {
      name: "redis",
      config: {
        host: 'redis',
        port: 6379,
        username: 'redisuser',
        password: 'redispassword',
      }
    }
  ];

  const makeRequest = (message: string) => axios({
    method: 'post',
    url: `${proxy}${path}`,
    data: {
      messages: [{
        'role': 'user',
        'content': message
      }]
    },
    validateStatus: null
  });

  for (const vectordb of vectordbVariants) {
    context(`with ${vectordb.name} vectordb`, function () {
      const aiLogPath = `${logsCollectingPathPrefix}/${vectordb.name}`;
      const semanticCacheConfig = {
        name: 'ai-semantic-cache',
        config: {
          exact_caching: false,
          stop_on_failure: false,
          vectordb: {
            strategy: vectordb.name,
            dimensions: DIMENSIONS,
            distance_metric: 'cosine',
            threshold: 0.2,
          },
          embeddings: {
            auth: {
              header_name: 'Authorization',
              header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
            },
            model: {
              provider: 'openai',
              name: 'text-embedding-3-large',
            },
          },
        },
      };
      let realPort: number;

      before(async function () {
        semanticCacheConfig.config.vectordb[vectordb.name] = vectordb.config;
        realPort = semanticCacheConfig.config.vectordb[vectordb.name].port;
        await createSemanticCachePlugin(semanticCacheConfig);
        await createOpenAIProxy();
        path = `/${randomString()}`;
        const route = await createRouteForService(serviceId, [path]);
        routeId = route.id;
        await createAILogCollectingRoute(`ai-log-service-${vectordb.name}`, routeId, aiLogPath);
      });

      it(`should hit cache on upcoming requests: semantic match`, async function () {
        await waitForConfigRebuild();

        let content = "";
        await retryAIRequest(
          () => makeRequest('What is the biggest country in the world?'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Miss');
            content = resp.data.choices[0].message.content;
          },
          "openai",
        );

        let cachedContent = "";
        await retryAIRequest(
          () => makeRequest('Tell me the biggest country in the world.'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Hit');
            cachedContent = resp.data.choices[0].message.content;
          },
          "openai",
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
        const stats = data.proxy;
        expect(stats.cache.embeddings_latency).to.be.a('number').that.is.greaterThan(0);
      });

      it(`should hit cache on upcoming requests: exact match`, async function () {
        semanticCacheConfig.config.exact_caching = true;
        await createSemanticCachePlugin(semanticCacheConfig);
        await waitForConfigRebuild();

        let content = "";
        await retryAIRequest(
          () => makeRequest('What is the smallest country in the world?'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Miss');
            content = resp.data.choices[0].message.content;
          },
          "openai",
        );

        let cachedContent = "";
        const timeout = 10 * 1000;
        await eventually(async () => {
          const resp = await makeRequest('What is the smallest country in the world?');
          logResponse(resp);
          expect(resp.headers['x-cache-status']).to.equal('Hit');
          const logsResp = await axios({
            method: 'get',
            url: `${proxy}${aiLogPath}`,
            validateStatus: null
          });

          logResponse(logsResp);
          expect(logsResp.status).to.equal(200);
          const stats = logsResp.data.proxy;
          // Exact match the result, no need to find embeddings, so the stats should be 0.
          //
          // Due to the fact that we stores the embeddings first before the cached response,
          // there could be a very small chance that the response is not cached yet while the
          // embeddings is already there, causing 'exact match miss' and 'semantic match hit'.
          // To avoid the test flakiness, we use eventually here to retry a few times until
          // 'exact match hit' is observed.
          expect(stats.cache.embeddings_latency).to.be.a('number').that.is.equal(0);
          cachedContent = resp.data.choices[0].message.content;
        }, timeout);

        expect(cachedContent).to.equal(content);

        await retryAIRequest(
          () => makeRequest('Tell me the smallest country in the world.'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Hit');
            cachedContent = resp.data.choices[0].message.content;
          },
          "openai",
        );

        expect(cachedContent).to.equal(content);

        const logsResp = await axios({
          method: 'get',
          url: `${proxy}${aiLogPath}`,
          validateStatus: null
        });

        logResponse(logsResp);
        expect(logsResp.status).to.equal(200);
        const stats = logsResp.data.proxy;
        // semantic match the result, need to find embeddings, so the stats should be > 0.
        expect(stats.cache.embeddings_latency).to.be.a('number').that.is.greaterThan(0);
      });

      it(`should bypass cache when vectordb is unavailable`, async function () {
        semanticCacheConfig.config.vectordb[vectordb.name].port = 65535; // set an invalid port to simulate vectordb is unavailable
        await createSemanticCachePlugin(semanticCacheConfig);
        await waitForConfigRebuild();

        await retryAIRequest(
          () => makeRequest('What is the biggest country in the world?'),
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Bypass');
          },
          "openai",
        );
      });

      it(`should fail when vectordb is unavailable and stop_on_failure is true`, async function () {
        semanticCacheConfig.config.vectordb[vectordb.name].port = 65535; // set an invalid port to simulate vectordb is unavailable
        semanticCacheConfig.config.stop_on_failure = true;
        await createSemanticCachePlugin(semanticCacheConfig);
        await waitForConfigRebuild();

        const resp = await makeRequest('What is the biggest country in the world?');
        logResponse(resp);
        expect(resp.status).to.equal(500);
      });

      after(async function () {
        // restore the correct vectordb config before clearing cache
        semanticCacheConfig.config.vectordb[vectordb.name].port = realPort;
        await createSemanticCachePlugin(semanticCacheConfig);
        await waitForConfigRebuild();
        await clearSemanticCache();
      });
    });
  }

  afterEach(async function () {
    if (this.currentTest?.state === 'failed') {
      getGatewayContainerLogs(kongContainerName, 100);
    }
  });

  after(async function () {
    await stopContainerByName('pgvector');
    await clearAllKongResources()
  });
});
