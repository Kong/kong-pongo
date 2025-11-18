import axios, { AxiosResponse } from 'axios';
import _ from 'lodash';
import {
  expect,
  createGatewayService,
  createRouteForService,
  clearAllKongResources,
  createAILogCollectingRoute,
  getBasePath,
  isGateway,
  Environment,
  logResponse,
  waitForConfigRebuild,
  retryAIRequest,
  getProvidersWithType,
  retryRequest,
  patchPlugin,
  deletePlugin,
  createPlugin,
  evaluateAIResponseStructure,
} from '@support';

describe('@ai: Gateway Plugins: AI Proxy Advanced Chat with single target', function () {
  this.timeout(360000);

  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });

  const serviceName = 'ai_proxy_advanced_service';
  const routePath = '/ai_proxy_advanced_chat';
  const content = 'return plain text to print word "kong_strong" exactly 3 times, no variations,just the exact text';

  let serviceId: string;
  let routeId: string;
  let pluginId: string;

  before(async function () {
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate';
    axios.defaults.timeout = 60000;
    const service = await createGatewayService(serviceName);
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [routePath]);
    routeId = route.id;
  });

  // skip bedrock provider as it keep failing in CI env, will investigate later
  const providers = getProvidersWithType('chat').filter((p) => p.id !== 'bedrock');
  const logsCollectingPathPrefix = `/ai/collect`;

  const createChatRequest =
    (streaming = false) =>
    () =>
      axios({
        method: 'post',
        url: `${proxyUrl}${routePath}`,
        data: {
          messages: [
            {
              role: 'user',
              content: content,
            },
          ],
          ...(streaming && { stream: true }),
        },
        validateStatus: null,
      });

  const createChatRequestWithFunctions =
    (streaming = false) =>
    () =>
      axios({
        method: 'post',
        url: `${proxyUrl}${routePath}`,
        data: {
          messages: [
            {
              role: 'user',
              content: 'What is the weather like in Boston today?',
            },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_current_weather',
                description: 'Get the current weather in a given location',
                parameters: {
                  type: 'object',
                  properties: {
                    location: {
                      type: 'string',
                      description: 'The city and state, e.g. San Francisco, CA',
                    },
                    unit: {
                      type: 'string',
                      enum: ['celsius', 'fahrenheit'],
                    },
                  },
                  required: ['location'],
                },
              },
            },
          ],
          tool_choice: 'auto',
          ...(streaming && { stream: true }),
        },
        validateStatus: null,
      });

  const collectAndValidateLogs = async () => {
    const logsResp = await axios({
      headers: {
        'content-type': 'application/json',
      },
      method: 'get',
      url: `${proxyUrl}${logsCollectingPathPrefix}`,
    });

    logResponse(logsResp);
    expect(logsResp.status, `Logs response should be 200`).to.equal(200);
    expect(logsResp, 'Logs should have proxy property').to.have.property('data');
  };

  function evaluateStreamingResponse(response: AxiosResponse<any, any>, variant: string, modelName: string | null) {
    logResponse(response);
    expect(response.status, 'Should have 200 status code').to.equal(200);
    expect(response.headers['content-type'], 'Should have content-type header set to text/event-stream').to.contain(
      'text/event-stream',
    );
    expect(response.data, 'Response data should have property data').to.exist;

    const chunks = response.data.split('\n\n');
    let model = '';
    let finishReason = '';
    for (const chunk of chunks) {
      if (chunk.startsWith('data: ')) {
        const data = chunk.replace('data: ', '').trim();
        if (data === '[DONE]') {
          break;
        }
        const parsed = JSON.parse(data);
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].finish_reason) {
          finishReason = parsed.choices[0].finish_reason;
        }
        if (parsed.model) {
          model = parsed.model;
          break;
        }
      }
    }
    if (model !== 'meta-llama/llama-3-8b-instruct' && modelName) {
      // huggingface model name is different in streaming response
      expect(model, 'Model should contain expected model name').to.contain(modelName);
    }
    expect(chunks.length, 'Should have received multiple data chunks in streaming response').to.be.greaterThan(1);
    if (finishReason) {
      expect(finishReason, 'Finish reason should be tool_calls').to.equal('tool_calls');
    }
  }

  providers.forEach(provider => {
    if (!provider) {
      return;
    }
    describe(`Provider: ${provider.name}`, function () {
      const pluginPayload = {
        name: 'ai-proxy-advanced',
        service: {
          id: '',
        },
        config: {
          max_request_body_size: 8192,
          llm_format: 'openai',
          model_name_header: true,
          response_streaming: 'allow',
          targets: [
            {
              auth: provider.auth,
              description: 'Test target for ' + provider.name,
              logging: {
                log_payloads: true,
                log_statistics: true,
              },
              model: {
                name: provider.chat.model,
                options: provider.chat.options,
                provider: provider.name,
              },
              weight: 100,
              route_type: 'llm/v1/chat',
            },
          ],
          balancer: {
            algorithm: 'round-robin',
            latency_strategy: 'tpot',
            retries: 5,
            slots: 1000,
            hash_on_header: 'X-Kong-LLM-Request-ID',
            failover_criteria: ['error', 'timeout'],
            connect_timeout: 60000,
            read_timeout: 60000,
            write_timeout: 60000,
            tokens_count_strategy: 'total-tokens',
          },
        },
      };

      it(`should create AI proxy advanced plugin using ${provider.name} with valid payload`, async function () {
        pluginPayload.service.id = serviceId;
        const respData = await createPlugin(pluginPayload);
        pluginId = respData.id;
        await createAILogCollectingRoute(`ai-log-service-${provider.name}`, routeId, `${logsCollectingPathPrefix}`);
        await waitForConfigRebuild();
        expect(respData.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');
      });

      it(`should proxy chat requests to ${provider.name} successfully and verify response metrics`, async function () {
        await retryAIRequest(
          createChatRequest(),
          response => {
            logResponse(response);
            expect(response.status, 'Should have 200 status code').to.equal(200);
            expect(response.data, 'Response data should have model property').to.have.property('model');
            const model = response.data.model;
            expect(model).to.contain(provider.chat.model);
            expect(response.data, 'Response data should have usage property').to.have.property('usage');
            const usage = response.data.usage;
            expect(usage, 'Usage should have total_tokens property').to.have.property('total_tokens');
            expect(usage.total_tokens, 'Total tokens should be a number').to.be.a('number');
            expect(usage, 'Usage should have prompt_tokens property').to.have.property('prompt_tokens');
            expect(usage.prompt_tokens, 'Prompt tokens should be a number').to.be.a('number');
            expect(usage, 'Usage should have completion_tokens property').to.have.property('completion_tokens');
            expect(usage.completion_tokens, 'Completion tokens should be a number').to.be.a('number');
          },
          provider.variant,
        );
      });

      if (provider.name === 'azure') {
        it(`should proxy chat request with functions to ${provider.name} successfully`, async function () {
          await retryAIRequest(
            createChatRequestWithFunctions(),
            response => {
              evaluateAIResponseStructure(response, provider.variant, provider.chat.model, 'tool_calls');
            },
            provider.variant,
          );
        });

        it(`should proxy chat streaming request with functions to ${provider.name} successfully`, async function () {
          await retryAIRequest(
            createChatRequestWithFunctions(true),
            response => evaluateStreamingResponse(response, provider.variant, provider.chat.model),
            provider.variant,
          );
        });
      }

      if (provider.name === 'openai') {
        it(`should be able to collect logs for ${provider.name} chat completion request`, async function () {
          await collectAndValidateLogs();
        });
      }

      it(`should fail to proxy chat request to ${provider.name} with invalid request body`, async function () {
        const response = await axios({
          method: 'post',
          url: `${proxyUrl}${routePath}`,
          data: {
            // empty body
          },
          validateStatus: null,
        });
        logResponse(response);
        expect(response.status, 'Should have 400 status code').to.equal(400);
      });

      it(`should proxy chat request to ${provider.variant} successfully and verify STREAMING response metrics`, async function () {
        await retryAIRequest(
          createChatRequest(true),
          response => evaluateStreamingResponse(response, provider.variant, provider.chat.model),
          provider.variant,
        );
      });

      if (provider.name === 'openai') {
        it(`should be able to collect logs for ${provider.name} chat streaming request`, async function () {
          await collectAndValidateLogs();
        });
      }

      it(`should fail to proxy chat request to ${provider.name} with invalid authentication`, async function () {
        const invalidAuth = {
          header_name: null,
          header_value: null,
          param_name: null,
          param_value: null,
          param_location: null,
          aws_access_key_id: null,
          aws_secret_access_key: null,
          gcp_use_service_account: false,
          gcp_service_account_json: null,
        };

        const updatedPluginPayload = _.cloneDeep(pluginPayload);
        updatedPluginPayload.config.targets[0].auth = invalidAuth;

        const respData = await patchPlugin(pluginId, updatedPluginPayload);
        expect(respData.id, 'Response data should have plugin id').to.equal(pluginId);
        await waitForConfigRebuild();

        await retryRequest(
          createChatRequest(),
          response => {
            expect(response.status, 'Status code should be one of [401, 403 or 500]').to.be.oneOf([401, 403, 500]);
          },
          60000,
        );
      });

      it(`should fail to proxy STREAMING chat request to ${provider.name} with invalid authentication`, async function () {
        await retryRequest(
          createChatRequest(true),
          response => {
            expect(response.status, 'Status code should be one of [401, 403 or 500]').to.be.oneOf([401, 403, 500]);
          },
          60000,
        );
      });

      after(async function () {
        await deletePlugin(pluginId);
      });
    });
  });

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    delete axios.defaults.timeout;
    await clearAllKongResources();
  });
});
