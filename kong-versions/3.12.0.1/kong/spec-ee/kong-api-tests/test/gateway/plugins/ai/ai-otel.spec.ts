import {
  checkOrStartServiceContainer,
  clearAllKongResources,
  createGatewayService,
  createPlugin,
  createRouteForService,
  Environment,
  eventually,
  expect,
  getBasePath,
  getKongContainerName,
  isGateway,
  isGwHybrid,
  logResponse,
  resetGatewayContainerEnvVariable,
  stopContainerByName,
  vars,
  wait,
  waitForConfigRebuild,
} from '@support';
import axios from 'axios';
import _ from 'lodash';

describe('@ai: Opentelemetry GenAI Spans', function () {
  const path = '/ai_proxy_advanced_test';
  const serviceId = '2e486b13-176e-48bc-8528-f8e3d8368775';
  const pluginId = 'b0634dc8-ac19-4c60-b2b4-1254306b7a6a';
  const otelPluginId = 'd9999223-8043-4865-9c38-f15fd5abba44';
  const jaegerHost = 'http://jaeger';
  const jaegerOtelEndpoint = `${jaegerHost}:4318/v1/traces`;

  const host = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.hostName,
  })}`;
  const jaegerApiReadEndpoint = `http://${host}:16686/api/traces`;
  const jaegerWait = 40000;

  // Define a type for the providers
  const providers = ['openai', 'gemini', 'bedrock', 'mistral', 'azure', 'huggingface'] as const;

  // Define a type for the providers
  type AiProvider = (typeof providers)[number];

  const providerRequestModels: {
    [p in AiProvider]: {
      'llm/v1/chat': string;
      'llm/v1/responses'?: string;
      'llm/v1/embeddings'?: string;
    };
  } = {
    openai: {
      'llm/v1/chat': 'gpt-4',
      'llm/v1/responses': 'gpt-4',
      'llm/v1/embeddings': 'text-embedding-3-small',
    },
    gemini: {
      'llm/v1/chat': 'gemini-2.0-flash',
      // 'llm/v1/responses': 'gemini-2.0-flash', -- gemini does not support llm/v1/responses
      'llm/v1/embeddings': 'text-embedding-004',
    },
    bedrock: {
      'llm/v1/chat': 'anthropic.claude-3-haiku-20240307-v1:0',
      // 'llm/v1/responses': 'anthropic.claude-3-haiku-20240307-v1:0',  -- bedrock does not support llm/v1/responses
      'llm/v1/embeddings': 'amazon.titan-embed-text-v2:0',
    },
    mistral: {
      'llm/v1/chat': 'mistral-medium-latest',
      // 'llm/v1/responses': 'mistral-medium-latest', -- mistral does not support llm/v1/responses
      'llm/v1/embeddings': 'mistral-embed',
    },
    azure: {
      'llm/v1/chat': 'gpt-4.1-mini',
      // 'llm/v1/responses': 'gpt-4.1-mini',  -- azure does not support llm/v1/responses
      'llm/v1/embeddings': 'text-embedding-3-small',
    },
    huggingface: {
      'llm/v1/chat': 'meta-llama/Meta-Llama-3-8B-Instruct',
      // 'llm/v1/responses': 'meta-llama/Meta-Llama-3-8B-Instruct',  -- huggingface does not support llm/v1/responses
      'llm/v1/embeddings': 'sentence-transformers/all-MiniLM-L6-v2',
    },
  };

  const providerResponseModels: {
    [p in AiProvider]: {
      'llm/v1/chat': string;
      'llm/v1/responses'?: string;
      'llm/v1/embeddings'?: string;
    };
  } = {
    openai: {
      'llm/v1/chat': 'gpt-4-0613',
      'llm/v1/responses': 'gpt-4-0613',
      'llm/v1/embeddings': 'text-embedding-3-small',
    },
    gemini: {
      'llm/v1/chat': 'gemini-2.0-flash',
      // 'llm/v1/responses': 'gemini-2.0-flash', -- gemini does not support llm/v1/responses
      'llm/v1/embeddings': 'text-embedding-004',
    },
    bedrock: {
      'llm/v1/chat': 'anthropic.claude-3-haiku-20240307-v1:0',
      // 'llm/v1/responses': 'anthropic.claude-3-haiku-20240307-v1:0',  -- bedrock does not support llm/v1/responses
      'llm/v1/embeddings': 'amazon.titan-embed-text-v2:0',
    },
    mistral: {
      'llm/v1/chat': 'mistral-medium-latest',
      // 'llm/v1/responses': 'mistral-medium-latest', -- mistral does not support llm/v1/responses
      'llm/v1/embeddings': 'mistral-embed',
    },
    azure: {
      'llm/v1/chat': 'gpt-4.1-mini-2025-04-14',
      // 'llm/v1/responses': 'gpt-4.1-mini-2025-04-14',  -- azure does not support llm/v1/responses
      'llm/v1/embeddings': 'text-embedding-3-small',
    },
    huggingface: {
      'llm/v1/chat': 'meta-llama/Meta-Llama-3-8B-Instruct',
      // 'llm/v1/responses': 'meta-llama/Meta-Llama-3-8B-Instruct',  -- huggingface does not support llm/v1/responses
      'llm/v1/embeddings': 'sentence-transformers/all-MiniLM-L6-v2',
    },
  };

  const roleMappings: {
    [p in AiProvider]: {
      user: string;
      model: string;
    };
  } = {
    openai: {
      user: 'user',
      model: 'assistant',
    },
    gemini: {
      user: 'user',
      model: 'model',
    },
    bedrock: {
      user: 'user',
      model: 'assistant',
    },
    mistral: {
      user: 'user',
      model: 'assistant',
    },
    azure: {
      user: 'user',
      model: 'assistant',
    },
    huggingface: {
      user: 'user',
      model: 'assistant',
    },
  };

  type PluginPayload = {
    id: string;
    service: { id: string };
    name: string;
    config: {
      llm_format: string;
      targets: Array<{ route_type: string; model: { name: string; [k: string]: any }; [k: string]: any }>;
      genai_category?: string;
      balancer: object;
    };
  };

  const providerConfigs: {
    [p in AiProvider]: {
      auth: object;
      model: {
        name: string;
        provider: string;
        options?: object;
      };
      logging: {
        log_payloads: boolean;
        log_statistics: boolean;
      };
      route_type: string;
    };
  } = {
    openai: {
      auth: {
        header_name: 'Authorization',
        header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
      },
      model: {
        name: providerRequestModels['openai']['llm/v1/chat'],
        options: {
          input_cost: 100,
          output_cost: 100,
        },
        provider: 'openai',
      },
      logging: {
        log_payloads: false,
        log_statistics: true,
      },
      route_type: 'llm/v1/chat',
    },
    gemini: {
      auth: {
        param_location: 'query',
        param_name: 'key',
        param_value: `${vars.ai_providers.GEMINI_API_KEY}`,
      },
      model: {
        name: providerRequestModels['gemini']['llm/v1/chat'],
        options: {
          input_cost: 100,
          output_cost: 100,
        },
        provider: 'gemini',
      },
      logging: {
        log_payloads: false,
        log_statistics: true,
      },
      route_type: 'llm/v1/chat',
    },
    mistral: {
      auth: {
        header_name: 'Authorization',
        header_value: `Bearer ${vars.ai_providers.MISTRAL_API_KEY}`,
      },
      model: {
        name: providerRequestModels['mistral']['llm/v1/chat'],
        provider: 'mistral',
        options: {
          mistral_format: 'openai',
        },
      },
      logging: {
        log_payloads: false,
        log_statistics: true,
      },
      route_type: 'llm/v1/chat',
    },
    bedrock: {
      auth: {
        allow_override: false,
        aws_access_key_id: vars.ai_providers.IAM_ROLE_AWS_ACCESS_KEY_ID,
        aws_secret_access_key: vars.ai_providers.IAM_ROLE_AWS_SECRET_ACCESS_KEY,
      },
      model: {
        name: providerRequestModels['bedrock']['llm/v1/chat'],
        options: {
          input_cost: 100,
          output_cost: 100,
          bedrock: {
            aws_assume_role_arn: 'arn:aws:iam::267914366688:role/ai-gateway-test-role',
            aws_role_session_name: 'e2e-iam-role-test',
            aws_region: 'us-east-1',
          },
        },
        provider: 'bedrock',
      },
      logging: {
        log_payloads: false,
        log_statistics: true,
      },
      route_type: 'llm/v1/chat',
    },
    azure: {
      auth: {
        header_name: 'api-key',
        header_value: vars.ai_providers.AZUREAI_API_KEY,
      },
      model: {
        name: providerRequestModels['azure']['llm/v1/chat'],
        options: {
          input_cost: 100,
          output_cost: 100,
          azure_instance: 'ai-gw-sdet-e2e-test',
          azure_deployment_id: providerRequestModels['azure']['llm/v1/chat'],
          azure_api_version: '2024-10-21',
        },
        provider: 'azure',
      },
      logging: {
        log_payloads: false,
        log_statistics: true,
      },
      route_type: 'llm/v1/chat',
    },
    huggingface: {
      auth: {
        header_name: 'Authorization',
        header_value: `Bearer ${vars.ai_providers.HUGGINGFACE_API_KEY}`,
      },
      model: {
        name: providerRequestModels['huggingface']['llm/v1/chat'],
        options: {
          input_cost: 100,
          output_cost: 100,
        },
        provider: 'huggingface',
      },
      logging: {
        log_payloads: false,
        log_statistics: true,
      },
      route_type: 'llm/v1/chat',
    },
  };

  const pluginPayload: PluginPayload = {
    config: {
      llm_format: 'openai',
      targets: [
        {
          auth: {
            header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
            header_name: 'Authorization',
            allow_override: false,
            azure_use_managed_identity: false,
            gcp_use_service_account: false,
          },
          model: {
            name: providerRequestModels['openai']['llm/v1/chat'],
            options: {
              upstream_url: null,
              input_cost: 5,
              output_cost: 5,
            },
            provider: 'openai',
          },
          description: 'openai',
          logging: {
            log_payloads: false,
            log_statistics: true,
          },
          weight: 50,
          route_type: 'llm/v1/chat',
        },
        // Below is a configuration for non existing model - it should not be picked but should not trick
        // Obeservability code to use as model values
        {
          auth: {
            header_value: `Bearer wrong-keys`,
            header_name: 'x-api-key',
            allow_override: false,
            azure_use_managed_identity: false,
            gcp_use_service_account: false,
          },
          model: {
            name: 'mock-404-model',
            options: {
              upstream_url: 'http://httpbin/status/404',
              // You can use this for local dev
              // upstream_url: 'https://httpbin.org/status/404',
              input_cost: 1,
              output_cost: 1,
            },
            provider: 'openai',
          },
          description: 'mock-404',
          logging: {
            log_payloads: true,
            log_statistics: true,
          },
          weight: 1, // Very low weight - it should not be picked
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
        tokens_count_strategy: 'cost',
      },
    },
    id: pluginId,
    service: { id: serviceId },
    name: 'ai-proxy-advanced',
  };

  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });

  const makeSuccessAIRequest = async (data: object) => {
    const resp = await axios({
      method: 'post',
      url: `${proxyUrl}${path}`,
      data: data,
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      validateStatus: null,
    });
    logResponse(resp);

    expect(resp.status, 'Response should be successful').to.equal(200);

    return resp;
  };

  type Trace = {
    tags: SpanTag[];
  };

  type SpanTag = {
    key: string;
    value: string;
  };

  const makeOtelRequestForTraces = async (since: string): Promise<Trace> => {
    const resp = await axios({
      method: 'GET',
      url: jaegerApiReadEndpoint,
      params: {
        service: 'kong',
        lookback: '2m',
        start: `${since}000`, // Jaeger time is in microseconds although this entire /api/traces is undocumented and internal ¯\_(ツ)_/¯
      },
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      validateStatus: null,
    });

    expect(resp.status, 'Status should be 200').to.equal(200);

    const spans = _.get(resp.data, 'data[0].spans');
    const genAiSpan = spans.find(span => span.operationName === 'kong.gen_ai');
    expect(genAiSpan, 'Traces should exist in Jaeger').to.exist;

    return genAiSpan;
  };

  const expectTagInTrace = (trace: Trace, key: string) => {
    const tag = trace.tags.find(x => x.key === key);

    if (tag) {
      expect(tag, `Tag: ${key}`).to.exist;
      return expect(tag.value);
    } else {
      return expect(null, `Tag: ${key}`);
    }
  };

  const createOTelPlugin = async () => {
    const pluginPayload = {
      id: otelPluginId,
      name: 'opentelemetry',
      config: {
        endpoint: jaegerOtelEndpoint,
      },
    };

    const respData = await createPlugin(pluginPayload, undefined, otelPluginId);
    expect(respData.name, 'Should have correct plugin name').to.equal('opentelemetry');
  };

  before(async function () {
    await checkOrStartServiceContainer('jaeger');
    this.timeout(120000); // increase timeout because of resetGatewayContainerEnvVariable and wait jaeger
    // enable kong otel tracing for requests for this test

    const gwContainerName = getKongContainerName();
    const isHybrid = isGwHybrid();

    const kongTracingConfig = {
      KONG_TRACING_INSTRUMENTATIONS: 'request',
      KONG_TRACING_SAMPLING_RATE: 1,
    };

    await resetGatewayContainerEnvVariable(kongTracingConfig, gwContainerName);
    if (isHybrid) {
      await resetGatewayContainerEnvVariable(kongTracingConfig, 'kong-dp1');
    }

    //  wait longer if running kong natively
    await wait(gwContainerName === 'kong-cp' ? 2000 : 5000); // eslint-disable-line no-restricted-syntax
    await wait(jaegerWait); // eslint-disable-line no-restricted-syntax

    // add header to every axios request in this suite
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate';

    //create a service and route for use with plugin
    await createGatewayService('ai-test-service', undefined, undefined, serviceId);
    await createRouteForService(serviceId, [path]);
    await createOTelPlugin();

    await waitForConfigRebuild();
  });

  providers.forEach(provider => {
    const upsertAiProxyPlugin = async (pluginTransformerFn?: (pluginConfig: PluginPayload) => PluginPayload) => {
      let pluginPayloadCopy = _.cloneDeep(pluginPayload);
      pluginPayloadCopy.config.targets = [_.cloneDeep(providerConfigs[provider])];
      if (pluginTransformerFn) {
        pluginPayloadCopy = pluginTransformerFn(pluginPayloadCopy);
      }

      const upsertRespData = await createPlugin(pluginPayloadCopy, undefined, pluginId);
      expect(upsertRespData.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');
    };

    context(`when using ${provider} LLM provider`, async () => {
      before(async function () {
        await upsertAiProxyPlugin();
        await waitForConfigRebuild();
      });

      if (providerRequestModels[provider]['llm/v1/chat']) {
        context(`when ${provider} when llm/v1/chat`, async function () {
          context('with simple chat proxy request', async function () {
            it(`should successfully save OTEL metrics from ${provider}`, async function () {
              const testStart = Date.now().toString();
              await makeSuccessAIRequest({
                messages: [
                  {
                    content: 'Hi! Please pick a random number for me.',
                    role: 'user',
                  },
                ],
              });

              const genAiSpan = await eventually(async () => await makeOtelRequestForTraces(testStart), jaegerWait);

              // Request tags
              expectTagInTrace(genAiSpan, 'gen_ai.input.messages').not.to.exist;
              expectTagInTrace(genAiSpan, 'gen_ai.operation.name').to.equal('chat');
              expectTagInTrace(genAiSpan, 'gen_ai.output.type').to.equal('json');
              expectTagInTrace(genAiSpan, 'gen_ai.provider.name').to.equal(provider);
              expectTagInTrace(genAiSpan, 'gen_ai.request.encoding_formats').not.to.exist;
              expectTagInTrace(genAiSpan, 'gen_ai.request.model').to.equal(
                providerRequestModels[provider]['llm/v1/chat'],
              );

              // Response tags
              expectTagInTrace(genAiSpan, 'gen_ai.response.finish_reasons').to.match(/(stop|length|complete)/);
              if (provider !== 'bedrock') {
                expectTagInTrace(genAiSpan, 'gen_ai.response.id').to.exist;
              }
              expectTagInTrace(genAiSpan, 'gen_ai.response.model').to.equal(
                providerResponseModels[provider]['llm/v1/chat'],
              );
              expectTagInTrace(genAiSpan, 'gen_ai.usage.input_tokens').to.be.greaterThan(0);
              expectTagInTrace(genAiSpan, 'gen_ai.usage.output_tokens').to.be.greaterThan(0);
              expectTagInTrace(genAiSpan, 'gen_ai.output.messages').not.to.exist;
            });
          });

          context('with complex chat proxy request', async function () {
            before(async function () {
              await upsertAiProxyPlugin(pluginConfig => {
                pluginConfig.config.targets[0].logging.log_payloads = true;
                return pluginConfig;
              });

              await waitForConfigRebuild();
            });

            it(`should successfully save all OTEL metrics from ${provider}`, async function () {
              const testStart = Date.now().toString();
              await makeSuccessAIRequest({
                messages: [
                  {
                    content: "I'm interested in various facts about United Kingdom",
                    role: roleMappings[provider]['user'],
                  },
                  {
                    content: 'That is great! What would you like to know?',
                    role: roleMappings[provider]['model'],
                  },
                  {
                    content: 'What is the longest river there?',
                    role: roleMappings[provider]['user'],
                  },
                  {
                    content: 'And what is the capital city?',
                    role: roleMappings[provider]['user'],
                  },
                ],
                n: 2,
                frequency_penalty: -0.5,
                max_tokens: 100,
                presence_penalty: -0.25,
                seed: 1741569952,
                stop: ['capybara'],
                temperature: 0.1,
                top_p: 0.2,
              });

              const genAiSpan = await eventually(async () => await makeOtelRequestForTraces(testStart), jaegerWait);

              expectTagInTrace(genAiSpan, 'gen_ai.input.messages').to.exist;
              expectTagInTrace(genAiSpan, 'gen_ai.operation.name').to.equal('chat');
              expectTagInTrace(genAiSpan, 'gen_ai.output.type').to.equal('json');
              expectTagInTrace(genAiSpan, 'gen_ai.provider.name').to.equal(provider);
              expectTagInTrace(genAiSpan, 'gen_ai.request.choice.count').to.equal(2);
              expectTagInTrace(genAiSpan, 'gen_ai.request.encoding_formats').not.to.exist;
              expectTagInTrace(genAiSpan, 'gen_ai.request.frequency_penalty').to.equal(-0.5);
              expectTagInTrace(genAiSpan, 'gen_ai.request.max_tokens').to.equal(100);
              expectTagInTrace(genAiSpan, 'gen_ai.request.model').to.equal(
                providerRequestModels[provider]['llm/v1/chat'],
              );
              expectTagInTrace(genAiSpan, 'gen_ai.request.presence_penalty').to.equal(-0.25);
              if (provider !== 'mistral') {
                expectTagInTrace(genAiSpan, 'gen_ai.request.seed').to.equal(1741569952);
              }
              expectTagInTrace(genAiSpan, 'gen_ai.request.stop_sequences').to.match(/capybara/);
              expectTagInTrace(genAiSpan, 'gen_ai.request.temperature').to.equal(0.1);
              expectTagInTrace(genAiSpan, 'gen_ai.request.top_p').to.equal(0.2);

              // Response
              expectTagInTrace(genAiSpan, 'gen_ai.response.finish_reasons').to.match(/(stop|length|complete)/);
              if (provider !== 'bedrock') {
                expectTagInTrace(genAiSpan, 'gen_ai.response.id').to.exist;
              }
              expectTagInTrace(genAiSpan, 'gen_ai.response.model').to.equal(
                providerResponseModels[provider]['llm/v1/chat'],
              );
              expectTagInTrace(genAiSpan, 'gen_ai.usage.input_tokens').to.be.greaterThan(0);
              expectTagInTrace(genAiSpan, 'gen_ai.usage.output_tokens').to.be.greaterThan(0);
              expectTagInTrace(genAiSpan, 'gen_ai.output.messages').to.exist;
            });
          });

          // Hugging face model: `meta-llama/Meta-Llama-3-8B-Instruct` does not support function calling
          if (provider !== 'huggingface') {
            context('when tool calling', async function () {
              it(`should successfully save OTEL metrics from ${provider}`, async function () {
                const testStart = Date.now().toString();
                await makeSuccessAIRequest({
                  messages: [
                    {
                      role: roleMappings[provider]['user'],
                      content: 'What is the weather like in Boston today?',
                    },
                  ],
                  tools: [
                    {
                      type: 'function',
                      function: {
                        name: 'get_current_weather',
                        description: 'Get the current weather in a given location in Celsius',
                        parameters: {
                          type: 'object',
                          properties: {
                            location: {
                              type: 'string',
                              description: 'The city and state, e.g. San Francisco, CA',
                            },
                          },
                          required: ['location'],
                        },
                      },
                    },
                  ],
                  tool_choice: 'auto',
                });

                const genAiSpan = await eventually(async () => await makeOtelRequestForTraces(testStart), jaegerWait);

                // Request tags
                expectTagInTrace(genAiSpan, 'gen_ai.operation.name').to.equal('chat');
                expectTagInTrace(genAiSpan, 'gen_ai.output.type').to.equal('json');
                expectTagInTrace(genAiSpan, 'gen_ai.provider.name').to.equal(provider);
                expectTagInTrace(genAiSpan, 'gen_ai.request.encoding_formats').not.to.exist;
                expectTagInTrace(genAiSpan, 'gen_ai.request.model').to.equal(
                  providerRequestModels[provider]['llm/v1/chat'],
                );

                // Response tags
                expectTagInTrace(genAiSpan, 'gen_ai.response.finish_reasons').to.match(/tool_calls/);
                if (provider !== 'bedrock') {
                  expectTagInTrace(genAiSpan, 'gen_ai.response.id').to.exist;
                }
                expectTagInTrace(genAiSpan, 'gen_ai.response.model').to.equal(
                  providerResponseModels[provider]['llm/v1/chat'],
                );
                expectTagInTrace(genAiSpan, 'gen_ai.usage.input_tokens').to.be.greaterThan(0);
                expectTagInTrace(genAiSpan, 'gen_ai.usage.output_tokens').to.be.greaterThan(0);
                if (provider !== 'gemini') {
                  expectTagInTrace(genAiSpan, 'gen_ai.tool.call.id').to.exist;
                }
                expectTagInTrace(genAiSpan, 'gen_ai.tool.name').to.equal('get_current_weather');
                expectTagInTrace(genAiSpan, 'gen_ai.tool.type').to.equal('function');
              });
            });
          }
        });
      }

      if (providerRequestModels[provider]['llm/v1/responses']) {
        context('when llm/v1/responses', async function () {
          before(async function () {
            await upsertAiProxyPlugin(pluginConfig => {
              pluginConfig.config.targets[0].route_type = 'llm/v1/responses';
              return pluginConfig;
            });

            await waitForConfigRebuild();
          });

          it(`should successfully save instructions OTEL metrics for from ${provider}`, async function () {
            const testStart = Date.now().toString();

            await makeSuccessAIRequest({
              input: 'so tell me. how many keys are on a keyboard?',
              instructions: 'Pretend to be from the past. Use old english',
            });

            const genAiSpan = await eventually(async () => await makeOtelRequestForTraces(testStart), jaegerWait);

            expectTagInTrace(genAiSpan, 'gen_ai.operation.name').to.equal('chat');
            expectTagInTrace(genAiSpan, 'gen_ai.output.type').to.equal('json');
            expectTagInTrace(genAiSpan, 'gen_ai.provider.name').to.equal(provider);
            expectTagInTrace(genAiSpan, 'gen_ai.request.encoding_formats').not.to.exist;
            expectTagInTrace(genAiSpan, 'gen_ai.request.model').to.equal(
              providerRequestModels[provider]['llm/v1/responses'],
            );

            // Response
            if (provider !== 'bedrock') {
              expectTagInTrace(genAiSpan, 'gen_ai.response.id').to.exist;
            }
            expectTagInTrace(genAiSpan, 'gen_ai.response.model').to.equal(
              providerResponseModels[provider]['llm/v1/responses'],
            );
            expectTagInTrace(genAiSpan, 'gen_ai.system_instructions').to.equal(
              'Pretend to be from the past. Use old english',
            );
            expectTagInTrace(genAiSpan, 'gen_ai.usage.input_tokens').to.be.greaterThan(0);
            expectTagInTrace(genAiSpan, 'gen_ai.usage.output_tokens').to.be.greaterThan(0);
          });
        });
      }

      if (providerRequestModels[provider]['llm/v1/embeddings']) {
        context('when llm/v1/embeddings', async function () {
          before(async function () {
            await upsertAiProxyPlugin(pluginConfig => {
              pluginConfig.config.targets[0].model.name = providerRequestModels[provider]['llm/v1/embeddings']!;
              if (provider === 'azure') {
                pluginConfig.config.targets[0].model.options.azure_deployment_id =
                  providerRequestModels[provider]['llm/v1/embeddings']!;
              }
              pluginConfig.config.targets[0].route_type = 'llm/v1/embeddings';
              pluginConfig.config.targets[0].logging.log_payloads = true;
              pluginConfig.config.genai_category = 'text/embeddings';
              return pluginConfig;
            });
            await waitForConfigRebuild();
          });

          it(`should successfully save embeddings OTEL metrics for from ${provider}`, async function () {
            const testStart = Date.now().toString();

            await makeSuccessAIRequest({
              input: 'so tell me. how many keys are on a keyboard?',
            });

            const genAiSpan = await eventually(async () => await makeOtelRequestForTraces(testStart), jaegerWait);

            expectTagInTrace(genAiSpan, 'gen_ai.operation.name').to.equal('generate_content');
            expectTagInTrace(genAiSpan, 'gen_ai.output.type').to.equal('json');
            expectTagInTrace(genAiSpan, 'gen_ai.provider.name').to.equal(provider);
            expectTagInTrace(genAiSpan, 'gen_ai.request.encoding_formats').to.equal('float');
            expectTagInTrace(genAiSpan, 'gen_ai.request.model').to.equal(
              providerRequestModels[provider]['llm/v1/embeddings'],
            );

            // Response
            expectTagInTrace(genAiSpan, 'gen_ai.response.model').to.equal(
              providerResponseModels[provider]['llm/v1/embeddings'],
            );
            expectTagInTrace(genAiSpan, 'gen_ai.usage.input_tokens').to.be.greaterThanOrEqual(0);
            if(provider === "mistral") {
              expectTagInTrace(genAiSpan, 'gen_ai.usage.output_tokens').to.be.greaterThanOrEqual(0);
            } else {
              expectTagInTrace(genAiSpan, 'gen_ai.usage.output_tokens').not.to.exist;
            }
          });
        });
      }
    });
  });

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await clearAllKongResources();
    await stopContainerByName('jaeger');

    const gwContainerName = getKongContainerName();
    const isHybrid = isGwHybrid();

    const kongTracingConfig = {
      KONG_TRACING_INSTRUMENTATIONS: 'off',
      KONG_TRACING_SAMPLING_RATE: 0.01,
    };

    await resetGatewayContainerEnvVariable(kongTracingConfig, gwContainerName);
    if (isHybrid) {
      await resetGatewayContainerEnvVariable(kongTracingConfig, 'kong-dp1');
    }
  });
});
