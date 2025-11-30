import axios from 'axios';
import _ from 'lodash';
import crypto from 'crypto';
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
  wait,
  vars,
  retryRequest,
} from '@support';

describe('Gateway Plugins: AI Proxy Advanced', function () {

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
        write_timeout: 60000,
        tokens_count_strategy: 'cost'
      }
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

  const makeSuccessAIRequest = async (
    proxyUrl: string,
    path: string,
    requestId?: string
  ): Promise<string | undefined> => {
    // Generate a random 16-character hex string if requestId is not provided
    const kongRequestId = requestId || crypto.randomBytes(8).toString('hex');

    const req = () => axios.post(
      `${proxyUrl}${path}`,
      {
        messages: [{
          role: 'user',
          content: 'return plain text to print word \'kong_strong\' exactly 3 times, no variations, just the exact text'
        }]
      },
      {
        headers: {
          'X-Kong-LLM-Request-ID': kongRequestId
        },
        validateStatus: null
      }
    );

    const assertions = (resp) => {
      logResponse(resp);
      if (resp.status === 400) {
        // Example: handle Gemini or other known 400s gracefully
        const errorData = Array.isArray(resp.data) ? resp.data[0].error : resp.data.error;
        if (errorData && errorData.message && errorData.message.includes('location is not supported')) {
          // Known/acceptable 400 error, do not fail or retry
          return;
        }
        expect.fail(`Unexpected 400 response: ${errorData?.message || JSON.stringify(resp.data)}`);
      } else if (resp.status === 504) {
        const msg = resp.data?.message || '';
        expect.fail(`Unexpected 504 response: ${msg || 'no message'}`);
      } else if (resp.status === 429) {
        expect.fail(`Rate Limit exceed`);
      } else if (resp.status === 200) {
        // Acceptable, do nothing
      } else {
        expect.fail(`Unexpected response status: ${resp.status}`);
      }
    };

    const resp = await retryRequest(req, assertions, 60000, 6000);
    return resp.headers['x-kong-llm-model'];
  };

  before(async function () {
    // add header to every axios request in this suite
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate';

    //create a service and route for use with plugin
    const service = await createGatewayService('ai-test-service');
    serviceId = service.id;
    await createRouteForService(serviceId, [path]);

  });

  it('should create AI proxy plugin with balancer using round-robin algorithm', async function () {
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

  it('should proxy requests to different AI providers according to round-robin algorithm', async function () {

    const provider1 = await makeSuccessAIRequest(proxyUrl, path);
    await wait(1000); // eslint-disable-line no-restricted-syntax
    const provider2 = await makeSuccessAIRequest(proxyUrl, path);

    expect(provider1, 'Should have different provider for each request').to.not.equal(provider2);
  });

  it('should be able to patch update plugin config with balancer using priority algorithm', async function () {
    const weightMap = {
      'anthropic': 30,
      'openai': 70
    };
    const modifyPriorityAlg = _.cloneDeep(pluginPayload);
    modifyPriorityAlg.config.balancer.algorithm = 'priority';
    for (const target of modifyPriorityAlg.config.targets) {
      expect(
        weightMap[target.description],
        `No weight defined for target description: ${target.description}`
      ).to.not.be.undefined;
      target.weight = weightMap[target.description];
    }

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: modifyPriorityAlg,
      validateStatus: null
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  });

  it('should proxy requests to different AI providers according to their priorities', async function () {
    const counts = { openai: 0, anthropic: 0, other: 0 };

    for (let i = 0; i < 10; i++) {
      await wait(1000); // eslint-disable-line no-restricted-syntax
      const model = await makeSuccessAIRequest(proxyUrl, path);
      if (typeof model === 'string') {
        if (model.toLowerCase().includes('openai')) {
          counts.openai++;
        } else if (model.toLowerCase().includes('anthropic')) {
          counts.anthropic++;
        } else {
          counts.other++;
        }
      }
    }
    expect(counts.other, 'No unknown providers should be used').to.equal(0);
    expect(counts.anthropic, 'Anthropic provider selection should NOT be used because having low prority').to.equal(0);
  });

  it('should be able to patch update plugin config with balancer using lowest-usage algorithm', async function () {
    const modifyLowestUsageAlg = _.cloneDeep(pluginPayload);
    modifyLowestUsageAlg.config.balancer.algorithm = 'lowest-usage';

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: modifyLowestUsageAlg,
      validateStatus: null
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  });

  it('should proxy requests to different AI providers according to their cost proportion', async function () {
    const counts = { openai: 0, anthropic: 0, other: 0 };

    for (let i = 0; i < 10; i++) {
      await wait(1000); // eslint-disable-line no-restricted-syntax
      const model = await makeSuccessAIRequest(proxyUrl, path);
      if (typeof model === 'string') {
        if (model.toLowerCase().includes('openai')) {
          counts.openai++;
        } else if (model.toLowerCase().includes('anthropic')) {
          counts.anthropic++;
        } else {
          counts.other++;
        }
      }
    }

    expect(counts.other, 'No unknown providers should be used').to.equal(0);
    expect(counts.anthropic, 'OpenAI provider selection should be used at least once').greaterThan(0);
    expect(counts.openai, 'Anthropic provider selection should be used at least once').greaterThan(0);
    expect(counts.anthropic, 'Anthropic selection should double openai selection').to.be.at.least(counts.openai * 2);
  });

  it('should be able to patch update plugin config with balancer using semantic algorithm', async function () {
    const modifySemanticAlg = _.cloneDeep(pluginPayload);
    modifySemanticAlg.config.balancer.algorithm = 'semantic';

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: modifySemanticAlg,
      validateStatus: null
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  });

  it('should proxy requests to different AI providers according to semantic algorithm', async function () {
    const counts = { openai: 0, anthropic: 0, other: 0 };

    for (let i = 0; i < 10; i++) {
      await wait(1000); // eslint-disable-line no-restricted-syntax
      const model = await makeSuccessAIRequest(proxyUrl, path);
      if (typeof model === 'string') {
        if (model.toLowerCase().includes('openai')) {
          counts.openai++;
        } else if (model.toLowerCase().includes('anthropic')) {
          counts.anthropic++;
        } else {
          counts.other++;
        }
      }
    }

    expect(counts.other, 'No unknown providers should be used').to.equal(0);
    expect(counts.anthropic, 'OpenAI provider selection should be used at least once').greaterThan(0);
    expect(counts.openai, 'Anthropic provider selection should be used at least once').greaterThan(0);
  });

  it('should be able to patch update plugin config setup to set openai with larger weight but unreachable url', async function () {
    const modifyFailoverAlg = _.cloneDeep(pluginPayload);
    const weightMap = {
      'anthropic': 30,
      'openai': 70,
    };
    const openAIfailed_upstream = 'http://127.0.0.1:65535'
    for (const target of modifyFailoverAlg.config.targets) {
      expect(
        weightMap[target.description],
        `No weight defined for target description: ${target.description}`
      ).to.not.be.undefined;
      target.weight = weightMap[target.description];
      if (target.description === 'openai') {
        target.model.options.upstream_url = openAIfailed_upstream;
      }
    }

    modifyFailoverAlg.config.balancer.algorithm = 'priority';

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: modifyFailoverAlg,
      validateStatus: null
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  });

  it('should proxy requests to anthropic even when openai is not reachable', async function () {
    const counts = { openai: 0, anthropic: 0, other: 0 };

    for (let i = 0; i < 10; i++) {
      await wait(1000); // eslint-disable-line no-restricted-syntax
      const model = await makeSuccessAIRequest(proxyUrl, path);
      if (typeof model === 'string') {
        if (model.toLowerCase().includes('openai')) {
          counts.openai++;
        } else if (model.toLowerCase().includes('anthropic')) {
          counts.anthropic++;
        } else {
          counts.other++;
        }
      }
    }
    expect(counts.other, 'No unknown providers should be used').to.equal(0);
    expect(counts.anthropic, 'Expected all requests to be proxied to Anthropic when OpenAI is unreachable').to.equal(10);
    expect(counts.openai, 'OpenAI provider selection should NOT be used because it is not reachable').to.equal(0);
  });

  it('should be able to patch update plugin config with balancer has consistent-hashing algorithm', async function () {
    const modifyconsistentHashAlg = _.cloneDeep(pluginPayload);
    modifyconsistentHashAlg.config.balancer.algorithm = 'consistent-hashing';

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: modifyconsistentHashAlg,
      validateStatus: null
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  });

  //unskip this test after AG-300 is fixed
  it.skip('should proxy requests to different AI providers according to their hashing value of header X-Kong-LLM-Request-ID', async function () {
    const counts = { openai: 0, anthropic: 0, other: 0 };
    const requestIdA = 'hash-test-id-AAAAAA';
    const requestIdB = 'hash-test-id-BBBBBB';

    // Send 3 requests with requestIdA
    for (let i = 0; i < 3; i++) {
      await wait(1000); // eslint-disable-line no-restricted-syntax
      const model = await makeSuccessAIRequest(proxyUrl, path, requestIdA);
      if (typeof model === 'string') {
        if (model.toLowerCase().includes('openai')) {
          counts.openai++;
        } else if (model.toLowerCase().includes('anthropic')) {
          counts.anthropic++;
        } else {
          counts.other++;
        }
      }
    }

    // Send 7 requests with requestIdB
    for (let i = 0; i < 7; i++) {
      await wait(1000);// eslint-disable-line no-restricted-syntax
      const model = await makeSuccessAIRequest(proxyUrl, path, requestIdB);
      if (typeof model === 'string') {
        if (model.toLowerCase().includes('openai')) {
          counts.openai++;
        } else if (model.toLowerCase().includes('anthropic')) {
          counts.anthropic++;
        } else {
          counts.other++;
        }
      }
    }

    expect(counts.other, 'No unknown providers should be used').to.equal(0);
    expect(counts.anthropic, 'Anthropic provider selection should be used at least once').greaterThan(0);
    expect(counts.openai, 'OpenAI provider selection should be used at least once').greaterThan(0);
    // One provider should be at least almost double the other
    const max = Math.max(counts.openai, counts.anthropic);
    const min = Math.min(counts.openai, counts.anthropic);
    expect(max, 'Dominant provider should be at least double the other').to.be.at.least(min * 2);
  });

  it('should delete AI proxy plugin', async function () {
    const resp = await axios({
      method: 'delete',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`
    });
    logResponse(resp);
    expect(resp.status, 'Should have 204 status code').to.equal(204);
  });

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await clearAllKongResources();
  });

});