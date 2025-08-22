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
  createPlugin,
  deletePlugin,
} from '@support';
import axios from 'axios';

describe('Gateway Plugins: AI Semantic Cache Test', function () {
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });
  const routePath = '/llm/v1/chat';

  let serviceId: string;
  let routeId: string;
  let aiProxyPluginId: string;
  let aiSemanticCachePluginId: string;

  const aiProxyPluginPayload = {
    name: 'ai-proxy',
    config: {
      logging: {
        log_payloads: true,
        log_statistics: true,
      },
      auth: {
        header_name: 'Authorization',
        header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
      },
      llm_format: 'openai',
      model: {
        name: 'gpt-4o',
        provider: 'openai',
        options: {
          upstream_url: 'https://api.openai.com/v1/chat/completions',
        },
      },
      route_type: 'llm/v1/chat',
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
      url: `${proxyUrl}${routePath}`,
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

  it('should create ai-proxy plugin', async function () {
    aiProxyPluginPayload.route.id = routeId;

    const plugin = await createPlugin(aiProxyPluginPayload);
    expect(plugin.name, 'Should have correct plugin name').to.equal('ai-proxy');
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
    const resp = await sendChatRequest();
    validateChatResponse(resp);
    logDebug('First request completed successfully, cache should be populated');
  });

  it('should successfully send second chat request and get cache hit', async function () {
    const resp = await sendChatRequest();
    validateChatResponse(resp, true);
  });

  it('should delete the ai-semantic-cache plugin by id', async function () {
    await deletePlugin(aiSemanticCachePluginId);
  });

  it('should delete the ai-proxy plugin by id', async function () {
    await deletePlugin(aiProxyPluginId);
  });

  after(async function () {
    await clearAllKongResources();
  });
});
