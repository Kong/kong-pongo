import axios from 'axios';
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
  retryAIRequest,
} from '@support';

describe('@ai: Gateway Plugins: AI Request Transformer - Capture Groups', function () {
  const pluginPayload = {
    config: {
      prompt: 'Convert the prices mentioned in the response from USD to INR. Transform the request by masking sensitive information (e.g., phone numbers, email IDs, employee IDs, card numbers, account numbers). Add the country name in brackets for any city in my message.',
      llm: {
        route_type: 'llm/v1/chat',
        model: {
          provider: 'azure',
          name: 'gpt-4o-mini',
          options: {
            azure_api_version: '2025-01-01-preview',
            azure_deployment_id: '$(uri_captures.deployment)',
            azure_instance: 'ai-gw-sdet-e2e-test',
          },
        },
        auth: {
          header_name: "api-key",
          header_value: `${vars.ai_providers.AZUREAI_API_KEY}`,
        },
        logging: { 
          log_statistics: false, 
          log_payloads: false 
        },
      },
      max_request_body_size: 8192,
    },
    service: { id: '' },
    name: 'ai-request-transformer',
    };

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });

  const path = '~/test/(?<deployment>[A-Za-z0-9-]+)';

  let serviceId: string;

  before(async function () {
    // add header to every axios request in this suite
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate';

    //create a service and route for use with plugin
    const service = await createGatewayService('ai-test-service');
    serviceId = service.id;
    await createRouteForService(serviceId, [path]);
  });


  it('should create AI Request Transformer Plugin', async function () {
    // setting service id to plugin payload as we can now access the serviceId inside it (test) scope
    pluginPayload.service.id = serviceId;

    const resp = await axios({
      method: 'post',
      url: `${adminUrl}/services/${serviceId}/plugins`,
      data: pluginPayload,
      validateStatus: null
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.headers['content-type'], 'Should have content-type header set to application/json').to.contain('application/json');
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-request-transformer');

    await waitForConfigRebuild();
  });

  it('should verify plugin configuration contains capture group template', async function () {
    // The capture group is dynamically populated by the ai-request-transformer plugin when handling user requests.
    // It will be replaced with the part captured from the URL (the deployment part in regex router path ~/test/(?<deployment>[A-Za-z0-9-]+)).
    // If the capture group does not work properly, the plugin may send the unpopulated value $(uri_captures.deployment)
    // to the LLM provider (Azure in this case), which would result in a non-200 response.
    // A 200 status means the capture group was correctly substituted and the request succeeded end-to-end.
    const makeRequest = () => axios({
      method: 'post',
      url: `${proxyUrl}/test/gpt-4o-mini`,
      data: {
        messages: [{
          'role': 'user',
          'content': 'How much does XBOX cost?'
        }],
      },
      validateStatus: null
    });

    await retryAIRequest(
      makeRequest,
      (resp) => {
        logResponse(resp)
        expect(resp.status).to.equal(200);
      },
    );
  });

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await clearAllKongResources();
  });

});
