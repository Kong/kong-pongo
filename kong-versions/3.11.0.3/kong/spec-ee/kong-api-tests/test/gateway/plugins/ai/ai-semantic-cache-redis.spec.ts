import axios from 'axios';
import {
  expect,
  createGatewayService,
  createRouteForService,
  getBasePath,
  Environment,
  logResponse,
  waitForConfigRebuild,
  isGwHybrid,
  getKongContainerName,
  getGatewayContainerLogs,
  clearAllKongResources,
  createPlugin,
  vars,
  retryAIRequest,
  deletePlugin,
  logDebug,
  clearSemanticCache,
} from '@support'

describe('@ai: Gateway Plugins: AI Semantic Cache: with Redis', function () {
  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
  const proxy = getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  });
  const routePath = '/llm/v1/chat';

  let serviceId: string;
  let routeId: string;
  let aiProxyPluginId: string;
  let aiSemanticCachePluginId: string;

  const aiProxyPluginPayload = {
    name: 'ai-proxy-advanced',
    config: {
      llm_format: 'openai',
      targets: [{
        logging: {
          log_payloads: true,
          log_statistics: true,
        },
        auth: {
          header_name: 'Authorization',
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        model: {
          name: 'gpt-4o',
          provider: 'openai',
          options: {
            upstream_url: 'https://api.openai.com/v1/chat/completions',
          },
        },
        route_type: 'llm/v1/chat',
      }],
    },
    route: { id: '' },
  };

  const aiSemanticCachePluginPayload = {
    name: 'ai-semantic-cache',
    config: {
      embeddings: {
        auth: {
          header_name: 'Authorization',
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        model: {
          name: 'text-embedding-ada-002',
          provider: 'openai',
        },
      },
      vectordb: {
        strategy: 'redis',
        distance_metric: 'cosine',
        threshold: 0.1,
        dimensions: 1536,
        redis: {
          host: 'redis',
          port: 6379,
          username: 'redisuser',
          password: 'redispassword',
        },
      },
    },
    route: { id: '' },
  };

  const chatRequest = {
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: 'What is dog?',
      },
    ],
    stream: false,
  };

  async function sendChatRequest() {
    const resp = await axios({
      method: 'post',
      url: `${proxy}${routePath}`,
      data: chatRequest,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      validateStatus: null,
    });
    return resp;
  }

  function validateChatResponse(resp: any, shouldHaveCache?: boolean) {
    logResponse(resp);
    expect(resp.status, 'Response should be successful').to.equal(200);
    expect(resp.data.choices, 'Should have choices in response').to.exist;
    expect(resp.data.choices).to.be.an('array');
    expect(resp.data.choices.length, 'Should have at least one choice').to.be.greaterThan(0);

    if (shouldHaveCache) {
      expect(resp.headers['x-cache-status'], 'Should have cache hit').to.equal('Hit');
      logDebug('Cache hit detected successfully');
    }
  }

  before(async function () {
    const service = await createGatewayService('ai-semantic-cache-test-service');
    serviceId = service.id;

    const route = await createRouteForService(serviceId, [routePath]);
    routeId = route.id;

    await waitForConfigRebuild();
  });

  context('Plugin setup and cache tests', function() {
    it('should create ai-proxy-advanced plugin', async function () {
      aiProxyPluginPayload.route.id = routeId;

      const plugin = await createPlugin(aiProxyPluginPayload);
      expect(plugin.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');
      aiProxyPluginId = plugin.id;

      await waitForConfigRebuild();
    });

    it('should create ai-semantic-cache plugin', async function () {
      aiSemanticCachePluginPayload.route.id = routeId;

      const plugin = await createPlugin(aiSemanticCachePluginPayload);
      expect(plugin.name, 'Should have correct plugin name').to.equal('ai-semantic-cache');
      aiSemanticCachePluginId = plugin.id;

      await waitForConfigRebuild();
    });

    it('should successfully send first chat request and store in cache', async function () {
      await retryAIRequest(
        sendChatRequest,
        (resp) => {
          validateChatResponse(resp);
        },
        "openai",
      );
      logDebug('First request completed successfully, cache should be populated');
    });

    it('should successfully send second chat request and get cache hit', async function () {
      await retryAIRequest(
        sendChatRequest,
        (resp) => {
          validateChatResponse(resp, true);
        },
        "openai",
      );
    });

    it('should delete the ai-semantic-cache plugin by id', async function () {
      await deletePlugin(aiSemanticCachePluginId);
    });

    it('should delete the ai-proxy plugin by id', async function () {
      await deletePlugin(aiProxyPluginId);
    });
  });

  afterEach(function() {
    if (this.currentTest?.state === 'failed') {
      getGatewayContainerLogs(kongContainerName, 100);
    }
  });

  after(async function () {
    await clearSemanticCache();
    await clearAllKongResources()
  });
});
