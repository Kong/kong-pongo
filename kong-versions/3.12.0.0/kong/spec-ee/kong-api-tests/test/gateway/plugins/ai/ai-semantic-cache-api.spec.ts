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
  isGateway,
  isGwHybrid,
  getKongContainerName,
  getGatewayContainerLogs,
  clearAllKongResources,
  retryAIRequest,
  clearSemanticCache,
  createPlugin,
  resetGatewayContainerEnvVariable,
  vars,
} from '@support'

xdescribe('@smoke @ai: Gateway Plugins: AI Semantic Cache: Admin API', function () {
  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
  const admin = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxy = getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  });
  const notExistPluginId = '00000000-0000-0000-0000-000000000000';

  let serviceId: string;
  let path: string;
  let pluginId: string;
  let cacheKey: string;
  let cachedContent: string;
  let notExistCacheKey: string;

  before(async function () {
    await resetGatewayContainerEnvVariable({ KONG_KEYRING_ENABLED: 'off' }, getKongContainerName());

    const service = await createGatewayService(randomString());
    serviceId = service.id;
    path = `/${randomString()}`;
    await createRouteForService(serviceId, [path]);

    const payload = {
      name: 'ai-semantic-cache',
      config: {
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
    const resp = await createPlugin(payload, "default", "ai-semantic-cache");
    pluginId = resp.id;
  });

  it('add cached data', async function () {
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
            log_payloads: true,
          },
        }],
      },
    };
    await createPlugin(payload, "default", "ai-proxy");
    await waitForConfigRebuild();

    const makeRequest = () => axios({
      method: 'post',
      url: `${proxy}${path}`,
      data: {
        messages: [{
          'role': 'user',
          'content': 'What is the biggest ocean on Earth?'
        }]
      },
      validateStatus: null
    })

    await retryAIRequest(
      makeRequest,
      (resp) => {
        logResponse(resp);
        // retry until hitting the cache
        expect(resp.headers['x-cache-status']).to.equal('Hit');
        cacheKey = resp.headers['x-cache-key'];
        expect(cacheKey, 'Cache key should not be empty').to.not.be.empty;
        notExistCacheKey = cacheKey.substring(0, cacheKey.length - 1) + (cacheKey.endsWith('a') ? 'b' : 'a');
        cachedContent = resp.data.choices[0].message.content;
      },
      "openai",
    );
  });

  context('GET /ai-semantic-cache', function () {
    const testCases = [
      {
        name: 'GET /ai-semantic-cache/:cache_key returns cached value if found in any plugin',
        method: 'get',
        url: (admin: string, { cacheKey }: any) => `${admin}/ai-semantic-cache/${cacheKey}`,
        expectedStatus: 200,
        expectedContent: (content: string) => content,
      },
      {
        name: 'GET /ai-semantic-cache/:plugin_id/caches/:cache_key returns cached value if found',
        method: 'get',
        url: (admin: string, { pluginId, cacheKey }: any) => `${admin}/ai-semantic-cache/${pluginId}/caches/${cacheKey}`,
        expectedStatus: 200,
        expectedContent: (content: string) => content,
      },
      {
        name: 'GET /ai-semantic-cache/:cache_key returns 404 if value not found in any plugin',
        method: 'get',
        url: (admin: string, { notExistCacheKey }: any) => `${admin}/ai-semantic-cache/${notExistCacheKey}`,
        expectedStatus: 404,
        expectedContent: null,
      },
      {
        name: 'GET /ai-semantic-cache/:plugin_id/caches/:cache_key returns 400 if cache key not in the plugin',
        method: 'get',
        url: (admin: string, { notExistPluginId, cacheKey }: any) => `${admin}/ai-semantic-cache/${notExistPluginId}/caches/${cacheKey}`,
        expectedStatus: 400,
        expectedContent: null,
      },
      {
        name: 'GET /ai-semantic-cache/:plugin_id/caches/:cache_key returns 404 if value not found',
        method: 'get',
        url: (admin: string, { pluginId, notExistCacheKey }: any) => `${admin}/ai-semantic-cache/${pluginId}/caches/${notExistCacheKey}`,
        expectedStatus: 404,
        expectedContent: null,
      },
    ];

    testCases.forEach(test => {
      it(test.name, async function () {
        const resp = await axios({
          method: test.method,
          url: test.url(admin, { pluginId, cacheKey, cachedContent, notExistCacheKey, notExistPluginId }),
          validateStatus: null,
        });
        logResponse(resp);
        expect(resp.status).to.equal(test.expectedStatus);
        if (test.expectedStatus === 200 && test.expectedContent) {
          expect(resp.data.choices[0].message.content).to.equal(test.expectedContent(cachedContent));
        }
      });
    });
  });

  context('DELETE /ai-semantic-cache', function () {
    const testCases = [
      {
        name: 'DELETE /ai-semantic-cache/:cache_key returns 404 if not found',
        method: 'delete',
        url: (admin: string, { notExistCacheKey }: any) => `${admin}/ai-semantic-cache/${notExistCacheKey}`,
        expectedStatus: 404,
      },
      {
        name: 'DELETE /ai-semantic-cache/:plugin_id/caches/:cache_key returns 400 if cache key not in the plugin',
        method: 'delete',
        url: (admin: string, { notExistPluginId, cacheKey }: any) => `${admin}/ai-semantic-cache/${notExistPluginId}/caches/${cacheKey}`,
        expectedStatus: 400,
      },
      {
        name: 'DELETE /ai-semantic-cache/:plugin_id/caches/:cache_key returns 404 if value not found',
        method: 'delete',
        url: (admin: string, { pluginId, notExistCacheKey }: any) => `${admin}/ai-semantic-cache/${pluginId}/caches/${notExistCacheKey}`,
        expectedStatus: 404,
      },
      {
        name: 'DELETE /ai-semantic-cache/:plugin_id/caches/:cache_key returns 204 if value found',
        method: 'delete',
        url: (admin: string, { pluginId, cacheKey }: any) => `${admin}/ai-semantic-cache/${pluginId}/caches/${cacheKey}`,
        expectedStatus: 204,
      },
    ];

    testCases.forEach(test => {
      it(test.name, async function () {
        const resp = await axios({
          method: test.method,
          url: test.url(admin, { pluginId, cacheKey, notExistCacheKey }),
          validateStatus: null,
        });
        logResponse(resp);
        expect(resp.status).to.equal(test.expectedStatus);
      });
    });
  });

  afterEach(function () {
    if (this.currentTest?.state === 'failed') {
      getGatewayContainerLogs(kongContainerName, 100);
    }
  });

  after(async function () {
    await clearSemanticCache();
    await clearAllKongResources()
  });
});
