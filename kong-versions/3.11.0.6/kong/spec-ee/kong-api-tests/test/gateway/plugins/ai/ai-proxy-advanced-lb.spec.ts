import axios from 'axios';
import {
  expect,
  createGatewayService,
  createRouteForService,
  clearAllKongResources,
  checkOrStartServiceContainer,
  deletePlugin,
  eventually,
  getBasePath,
  getPgvectorConfig,
  getGatewayContainerLogs,
  getKongContainerName,
  isGateway,
  isGwHybrid,
  isPgvectorHealthy,
  Environment,
  logResponse,
  retryAIRequest,
  stopContainerByName,
  vars,
  waitForConfigRebuild,
} from '@support';

describe('@ai: Gateway Plugins: AI Proxy Advanced Load Balancer', function () {
  const DIMENSIONS = 1024;

  const pluginPayload = {
    config: {
      max_request_body_size: 8192,
      llm_format: 'openai',
      model_name_header: true,
      response_streaming: 'allow',
      targets: [
        {
          auth: {
            header_value: `${vars.ai_providers.ANTHROPIC_API_KEY}`,
            header_name: 'x-api-key',
            allow_override: false,
            azure_use_managed_identity: false,
            gcp_use_service_account: false
          },
          model: {
            name: 'claude-3-haiku-20240307',
            options: {
              max_tokens: 4096,
              anthropic_version: '2023-06-01',
              upstream_url: null,
              input_cost: 2,
              output_cost: 2
            },
            provider: 'anthropic'
          },
          description: 'anthropic',
          logging: {
            log_payloads: true,
            log_statistics: true
          },
          weight: 50,
          route_type: 'llm/v1/chat'
        },
        {
          auth: {
            header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
            header_name: 'Authorization',
            allow_override: false,
            azure_use_managed_identity: false,
            gcp_use_service_account: false
          },
          model: {
            name: 'gpt-4',
            options: {
              upstream_url: null,
              input_cost: 5,
              output_cost: 5
            },
            provider: 'openai'
          },
          description: 'openai',
          logging: {
            log_payloads: true,
            log_statistics: true
          },
          weight: 50,
          route_type: 'llm/v1/chat'
        }
      ],
      balancer: {
        algorithm: 'semantic',
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
        write_timeout: 60000,
        tokens_count_strategy: 'cost'
      },
      vectordb: {
          strategy: 'pgvector',
          dimensions: DIMENSIONS,
          distance_metric: 'cosine',
          threshold: 0.5,
          pgvector: getPgvectorConfig(),
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
    service: { id: '' },
    name: 'ai-proxy-advanced'
  };

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });

  const path = '/ai_proxy_advanced_test';

  let serviceId: string;
  let pluginId: string;

  before(async function () {
    // add header to every axios request in this suite
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate';

    await checkOrStartServiceContainer('pgvector');
    await eventually(async () => {
      const ok = await isPgvectorHealthy();
      expect(ok, 'Pgvector should be healthy').to.be.true;
    });

    //create a service and route for use with plugin
    const service = await createGatewayService('ai-test-service');
    serviceId = service.id;
    await createRouteForService(serviceId, [path]);

  });

  it('should create AI proxy plugin with balancer using semantic algorithm', async function () {
    // setting service id to plugin payload as we can now access the serviceId inside it (test) scope
    pluginPayload.service.id = serviceId;

    const resp = await axios({
      method: 'post',
      url: `${adminUrl}/services/${serviceId}/plugins`,
      data: pluginPayload,
      validateStatus: null
    });

    pluginId = resp.data.id;
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.headers['content-type'], 'Should have content-type header set to application/json').to.contain('application/json');
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  it('should proxy requests to different AI providers according to semantic algorithm', async function () {

    const makeRequest = () => axios({
      method: 'post',
      url: `${proxyUrl}${path}`,
      data: {
        messages: [{
          'role': 'user',
          'content': 'Tell me something about OpenAI.'
        }]
      },
      validateStatus: null
    });

    const res = await retryAIRequest(
      makeRequest,
      (resp) => {
        // Simple validation with just two expectations
        expect(resp.status, 'Should have 200 status code').to.equal(200);
        return resp; // Return the response
      },
    );

    const provider1 = res.headers['x-kong-llm-model'];
    expect(provider1).to.satisfy((val) => val?.includes('openai') || val?.includes('gpt-4'));

    const makeRequest2 = () => axios({
      method: 'post',
      url: `${proxyUrl}${path}`,
      data: {
        messages: [{
          'role': 'user',
          'content': 'Tell me something about Anthropic.'
        }]
      },
      validateStatus: null
    });

    const res2 = await retryAIRequest(
      makeRequest2,
      (resp) => {
        // Simple validation with just two expectations
        expect(resp.status, 'Should have 200 status code').to.equal(200);
        return resp; // Return the response
      },
    );

    const provider2 = res2.headers['x-kong-llm-model'];
    expect(provider2).to.satisfy((val) => val?.includes('anthropic') || val?.includes('claude-3'));
  });

  it('should delete AI proxy plugin', async function () {
    await deletePlugin(pluginId);
  });

  afterEach(async function () {
    if (this.currentTest?.state === 'failed') {
      const dpContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
      getGatewayContainerLogs(dpContainerName, 100);
    }
  });

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await stopContainerByName('pgvector');
    await clearAllKongResources();
  });

});
