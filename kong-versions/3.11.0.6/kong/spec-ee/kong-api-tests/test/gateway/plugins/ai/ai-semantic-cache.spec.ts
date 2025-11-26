import {
  GoogleGenAI,
} from '@google/genai';
import {
  clearAllKongResources,
  clearSemanticCache,
  createAILogCollectingRoute,
  createGatewayService,
  createPlugin,
  createRouteForService,
  deletePlugin,
  Environment,
  eventually,
  expect,
  getBasePath,
  getGatewayContainerLogs,
  getKongContainerName,
  isGwHybrid,
  logDebug,
  logResponse,
  randomString,
  retryAIRequest,
  vars,
  waitForConfigRebuild,
} from '@support';
import axios from 'axios';

describe('@ai: Gateway Plugins: AI Semantic Cache', function () {
  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
  const DIMENSIONS = 3072;
  const baseAiSemanticCache = {
    name: 'ai-semantic-cache',
    config: {
      vectordb: {
        strategy: 'redis',
        dimensions: DIMENSIONS,
        distance_metric: 'cosine',
        // higher threshold to increase stability of the test
        threshold: 0.2,
        redis: {
          host: 'redis',
          port: 6379,
          username: 'redisuser',
          password: 'redispassword',
        },
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

  const createSemanticCachePlugin = async function (payload: any) : Promise<any> {
    return await createPlugin(payload, "default", "ai-semantic-cache");
  }

  const proxy = getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  });
  let serviceId: string;
  let path: string;

  before(async function () {
    const service = await createGatewayService(randomString());
    serviceId = service.id;
    path = `/${randomString()}`;
    await createRouteForService(serviceId, [path]);
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
            log_payloads: true,
          },
        }],
      },
    };
    createPlugin(payload, "default", "ai-proxy");
  }

  const createVertexProxy = async function () {
    const payload = {
      name: 'ai-proxy-advanced',
      config: {
        targets: [{
          model: {
            name: "gemini-2.0-flash",
            provider: "gemini",
            options: {
              input_cost: 10,
              output_cost: 100,
              gemini: {
                location_id: "us-central1",
                api_endpoint: "us-central1-aiplatform.googleapis.com",
                project_id: "gcp-sdet-test"
              }
            },
          },
          auth: {
            gcp_use_service_account: true,
            gcp_service_account_json: `${vars.ai_providers.VERTEX_API_KEY}`
          },
          route_type: 'llm/v1/chat',
          logging: {
            log_statistics: true,
            log_payloads: true,
          }
        }],
      },
    };
    createPlugin(payload, "default", "ai-proxy");
  }

  const createMistralProxy = async function () {
    const payload = {
      name: 'ai-proxy-advanced',
      config: {
        targets: [{
          model: {
            name: 'mistral-medium-latest',
            provider: "mistral",
            options: {
              mistral_format: 'openai',
            }
          },
          auth: {
            header_name: "Authorization",
            header_value: `Bearer ${vars.ai_providers.MISTRAL_API_KEY}`,
          },
          route_type: 'llm/v1/chat',
          logging: {
            log_statistics: true,
            log_payloads: true,
          }
        }],
      },
    };
    createPlugin(payload, "default", "ai-proxy");
  }

  const createCohereProxy = async function () {
    const payload = {
      name: 'ai-proxy-advanced',
      config: {
        targets: [{
          model: {
            name: "command-r7b-12-2024",
            provider: "cohere",
          },
          auth: {
            header_name: 'Authorization',
            header_value: `Bearer ${vars.ai_providers.COHERE_API_KEY}`,
          },
          route_type: 'llm/v1/chat',
          logging: {
            log_statistics: true,
            log_payloads: true,
          }
        }],
      },
    };
    createPlugin(payload, "default", "ai-proxy");
  }

  const createHuggingfaceProxy = async function () {
    const payload = {
      name: 'ai-proxy-advanced',
      config: {
        targets: [{
          model: {
            name: "meta-llama/Meta-Llama-3-8B-Instruct",
            provider: "huggingface",
          },
          auth: {
            header_name: 'Authorization',
            header_value: `Bearer ${vars.ai_providers.HUGGINGFACE_API_KEY}`,
          },
          route_type: 'llm/v1/chat',
          logging: {
            log_statistics: true,
            log_payloads: true,
          }
        }],
      },
    };
    createPlugin(payload, "default", "ai-proxy");
  }

  context('Cache in OpenAI format', function () {
    const providers = [
      {
        name: 'OpenAI',
        variant: 'openai',
        createProxy: createOpenAIProxy,
      },
      {
        name: 'Vertex AI',
        variant: 'gemini',
        createProxy: createVertexProxy,
      },
      {
        name: 'Mistral AI',
        variant: 'mistral',
        createProxy: createMistralProxy,
      },
      {
        name: 'Cohere',
        variant: 'cohere',
        createProxy: createCohereProxy,
      },
      {
        name: 'Huggingface',
        variant: 'huggingface',
        createProxy: createHuggingfaceProxy,
      },
    ];
    providers.forEach((provider) => {
      it(`set up ${provider.name} proxy`, async function () {
        await provider.createProxy();
        await waitForConfigRebuild();
      });

      it(`should hit cache on upcoming requests for ${provider.name}` , async function () {
        let makeRequest = () => axios({
          method: 'post',
          url: `${proxy}${path}`,
          data: {
            messages: [{
              'role': 'user',
              'content': 'What is the tallest mountain on Earth?'
            }]
          },
          headers: {
            'Accept-Encoding': 'gzip, deflate',
          },
          validateStatus: null
        })

        let content = "";
        await retryAIRequest(
          makeRequest,
          (resp) => {
            logResponse(resp);
            // First request should miss the cache
            expect(resp.headers['x-cache-status']).to.equal('Miss');
            content = resp.data.choices[0].message.content;
          },
          provider.variant,
        );

        let cachedContent = "";
        await retryAIRequest(
          makeRequest,
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Hit');
            cachedContent = resp.data.choices[0].message.content;
          },
          provider.variant,
        );

        expect(cachedContent).to.equal(content);

        makeRequest = () => axios({
          method: 'post',
          url: `${proxy}${path}`,
          data: {
            messages: [{
              'role': 'user',
              'content': 'What is the tallest mountain on Earth?'
            }],
            stream: true,
          },
          headers: {
            'Accept-Encoding': 'gzip, deflate',
          },
          validateStatus: null
        })

        await retryAIRequest(
          makeRequest,
          (resp) => {
            logResponse(resp);
            // the cache doesn't care about streaming
            expect(resp.headers['x-cache-status']).to.equal('Hit');
            // We use a template to convert non-streaming response to streaming, so here we
            // can extract the content in the first sse chunk.
            const firstNewline = resp.data.indexOf('\n');
            const sse = resp.data.slice("data: ".length - 1, firstNewline);
            content = JSON.parse(sse).choices[0].delta.content;
          },
          provider.variant,
        );

        expect(cachedContent).to.equal(content);
      });

      it(`should hit cache on upcoming requests for ${provider.name}, streaming version` , async function () {
        let makeRequest = () => axios({
          method: 'post',
          url: `${proxy}${path}`,
          data: {
            messages: [{
              'role': 'user',
              'content': 'What is the tallest mountain on Moon?'
            }],
            stream: true,
          },
          headers: {
            'Accept-Encoding': 'gzip, deflate',
          },
          validateStatus: null
        })

        let content = "";
        await retryAIRequest(
          makeRequest,
          (resp) => {
            logResponse(resp);
            // First request should miss the cache
            expect(resp.headers['x-cache-status']).to.equal('Miss');
            const events = resp.data.split('\n\n');
            for (const event of events) {
              if (event.startsWith('data: ')) {
                const sse = event.slice("data: ".length);
                if (sse.indexOf('[DONE]') !== -1) {
                  break;
                }
                const deltaContent = JSON.parse(sse).choices[0].delta.content;
                if (deltaContent) {
                  content += deltaContent;
                }
              }
            }
          },
          provider.variant,
        );

        let cachedContent = "";
        await retryAIRequest(
          makeRequest,
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Hit');
            const firstNewline = resp.data.indexOf('\n');
            const sse = resp.data.slice("data: ".length - 1, firstNewline);
            cachedContent = JSON.parse(sse).choices[0].delta.content;
          },
          provider.variant,
        );

        expect(cachedContent).to.equal(content);

        makeRequest = () => axios({
          method: 'post',
          url: `${proxy}${path}`,
          data: {
            messages: [{
              'role': 'user',
              'content': 'What is the tallest mountain on Moon?'
            }],
          },
          headers: {
            'Accept-Encoding': 'gzip, deflate',
          },
          validateStatus: null
        })

        await retryAIRequest(
          makeRequest,
          (resp) => {
            logResponse(resp);
            expect(resp.headers['x-cache-status']).to.equal('Hit');
            cachedContent = resp.data.choices[0].message.content;
          },
          provider.variant,
        );

        expect(cachedContent).to.equal(content);
      });

      it(`should clear cache for ${provider.name}`, async function () {
        await clearSemanticCache();
      });
    });
  });

  context('Cache analytics logging', function () {
    const aiLogPath = '/ai/collect/openai-cost';
    let analyticsServiceId: string;
    let analyticsRouteId: string;
    let analyticsPath: string;
    let semanticPluginId: string;
    let aiProxyPluginId: string;

    before(async function () {
      const service = await createGatewayService(randomString());
      analyticsServiceId = service.id;
      analyticsPath = `/${randomString()}`;
      const route = await createRouteForService(analyticsServiceId, [analyticsPath]);
      analyticsRouteId = route.id;

      const semanticCachePayload = {
        ...baseAiSemanticCacheWithOpenAI,
        route: { id: analyticsRouteId },
      };
      const semanticPlugin = await createPlugin(semanticCachePayload, 'default');
      semanticPluginId = semanticPlugin.id;

      const aiProxyPayload = {
        name: 'ai-proxy-advanced',
        route: { id: analyticsRouteId },
        config: {
          targets: [{
            model: {
              name: 'gpt-4',
              provider: 'openai',
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
      const proxyPlugin = await createPlugin(aiProxyPayload, 'default');
      aiProxyPluginId = proxyPlugin.id;

      await createAILogCollectingRoute('ai-semantic-cache-cost', analyticsRouteId, aiLogPath);
      await waitForConfigRebuild();
    });

    it('should log metrics on cache hit', async function () {
      const makeRequest = (prompt: string) => axios({
        method: 'post',
        url: `${proxy}${analyticsPath}`,
        data: {
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        },
        validateStatus: null,
      });

      let originalContent = '';
      await retryAIRequest(
        () => makeRequest('What is the biggest country in the world?'),
        (resp) => {
          logResponse(resp);
          expect(resp.headers['x-cache-status'], 'First analytics request should miss cache').to.equal('Miss');
          originalContent = resp.data.choices[0].message.content;
        },
        'openai',
      );

      // Check the metrics log for the cache miss, also get the original cost for later comparison
      const missStats = await eventually(async () => {
        const missLogsResp = await axios({
          method: 'get',
          url: `${proxy}${aiLogPath}`,
          validateStatus: null,
        });

        logResponse(missLogsResp);
        expect(missLogsResp.status, 'Log collector should respond with 200 when retrieving miss logs').to.equal(200);
        const stats = missLogsResp.data.proxy;
        if (!stats || !stats.cache || typeof stats.cache.cache_status !== 'string') {
          throw new Error('cache stats not ready');
        }
        if (stats.cache.cache_status.toLowerCase() !== 'miss') {
          throw new Error('waiting for cache miss log');
        }

        return stats;
      });
      expect(missStats.cache.fetch_latency, 'Miss log should record fetch latency').to.be.a('number');
      expect(missStats.cache.embeddings_latency, 'Miss log should record embeddings latency').to.be.a('number').that.is.greaterThan(0);
      expect(missStats.cache.embeddings_provider, 'Miss log should record embeddings provider').to.equal('openai');
      expect(missStats.cache.embeddings_model, 'Miss log should record embeddings model').to.equal('text-embedding-3-large');
      expect(missStats.meta.llm_latency, 'Miss log should capture LLM latency').to.be.a('number').that.is.greaterThan(0);
      expect(missStats.usage.prompt_tokens, 'Miss log should record input tokens').to.be.a('number').that.is.greaterThan(0);
      expect(missStats.usage.completion_tokens, 'Miss log should record completion tokens').to.be.a('number').that.is.greaterThan(0);
      expect(missStats.usage.total_tokens, 'Miss log should record total tokens').to.be.a('number').that.is.greaterThan(0);
      expect(missStats.usage.cost, 'Miss log should record cost').to.be.a('number').that.is.greaterThan(0);
      expect(missStats.usage.time_per_token, 'Miss log should record time per token').to.be.a('number').that.is.greaterThan(0);
      expect(missStats.usage.time_to_first_token, 'Miss log should record time to first token').to.be.a('number').that.is.greaterThan(0);

      let cachedContent = '';
      await retryAIRequest(
        () => makeRequest('Tell me the biggest country in the world.'),
        (resp) => {
          logResponse(resp);
          expect(resp.headers['x-cache-status'], 'Second analytics request should hit cache').to.equal('Hit');
          cachedContent = resp.data.choices[0].message.content;
        },
        'openai',
      );

      expect(cachedContent, "cached content should be equal to original content").to.equal(originalContent);

      // Check the metrics log for the cache hit
      const hitStats = await eventually(async () => {
        const hitLogsResp = await axios({
          method: 'get',
          url: `${proxy}${aiLogPath}`,
          validateStatus: null,
        });

        logResponse(hitLogsResp);
        expect(hitLogsResp.status, 'Log collector should respond with 200 when retrieving hit logs').to.equal(200);
        const stats = hitLogsResp.data.proxy;
        if (!stats || !stats.cache || typeof stats.cache.cache_status !== 'string') {
          throw new Error('cache stats not ready');
        }
        if (stats.cache.cache_status.toLowerCase() !== 'hit') {
          throw new Error('waiting for cache hit log');
        }

        return stats;
      });

      expect(hitStats.cache.fetch_latency, 'Hit log should capture fetch latency').to.be.a('number');
      expect(hitStats.cache.embeddings_latency, 'Hit log should capture embeddings latency').to.be.a('number').that.is.greaterThan(0);
      expect(hitStats.cache.embeddings_provider, 'Embeddings provider should match configuration').to.equal('openai');
      expect(hitStats.cache.embeddings_model, 'Embeddings model should match configuration').to.equal('text-embedding-3-large');
      expect(hitStats.meta.llm_latency, 'Hit log should capture LLM latency').to.be.a('number').that.is.greaterThan(0);
      expect(hitStats.usage.prompt_tokens, 'Hit log should set input tokens to zero').to.be.a('number').that.is.equal(0);
      expect(hitStats.usage.completion_tokens, 'Hit log should set completion tokens to zero').to.be.a('number').that.is.equal(0);
      expect(hitStats.usage.total_tokens, 'Hit log should set total tokens to zero').to.be.a('number').that.is.equal(0);
      expect(hitStats.usage.cost, 'Hit log should set cost to zero').to.be.a('number').that.is.equal(0);
      expect(hitStats.usage.time_per_token, 'Hit log should record time per token').to.be.a('number').that.is.greaterThan(0);
      expect(hitStats.usage.time_to_first_token, 'Hit log should set time to first token to zero').to.be.a('number').that.is.equal(0);
    });

    after(async function () {
      if (aiProxyPluginId) {
        await deletePlugin(aiProxyPluginId);
        aiProxyPluginId = '';
      }
      if (semanticPluginId) {
        await deletePlugin(semanticPluginId);
        semanticPluginId = '';
      }
      await clearSemanticCache();
    });
  });

  context('Cache in Native format', function () {
    const createVertexProxyWithNativeFormat = async function () {
      const payload = {
        name: 'ai-proxy-advanced',
        config: {
          targets: [{
            model: {
              name: "gemini-2.0-flash",
              provider: "gemini",
              options: {
                input_cost: 10,
                output_cost: 100,
                gemini: {
                  location_id: "us-central1",
                  api_endpoint: "us-central1-aiplatform.googleapis.com",
                  project_id: "gcp-sdet-test"
                }
              },
            },
            auth: {
              gcp_use_service_account: true,
              gcp_service_account_json: `${vars.ai_providers.VERTEX_API_KEY}`
            },
            route_type: 'llm/v1/chat',
            logging: {
              log_statistics: true,
              log_payloads: true,
            }
          }],
          llm_format: 'gemini',
        },
      };
      createPlugin(payload, "default", "ai-proxy");
    }

    let geminiAI: GoogleGenAI;

    before(async function () {
      await createVertexProxyWithNativeFormat();
      await waitForConfigRebuild();

      geminiAI = new GoogleGenAI({
        apiKey: vars.ai_providers.GEMINI_API_KEY,
        httpOptions: {
          baseUrl: `${proxy}/${path}`,
        },
      });
    });

    it('should reject non-streaming request as unsupported', async function () {
      try {
        await geminiAI.models.generateContent({
          model: "gemini-2.0-flash",
          contents: "What is the longest river on Earth?",
        });
      } catch (err) {
        if (err instanceof Error) {
          // We don't support native format yet
          expect(err.message).to.match(/400 Bad Request|500 Internal Server Error/);
        } else {
          expect.fail(`Unexpected error: ${err}`);
          return;
        }
      }
    });

    it('should reject streaming request as unsupported', async function () {
      try {
        await geminiAI.models.generateContentStream({
          model: "gemini-2.0-flash",
          contents: "What is the longest river on Earth?",
        });
      } catch (err) {
        if (err instanceof Error) {
          // We don't support native format yet
          expect(err.message).to.match(/400 Bad Request|500 Internal Server Error/);
        } else {
          expect.fail(`Unexpected error: ${err}`);
          return;
        }
      }
    });
  });

  context('Cache control by request headers', function () {
    before(async function () {
      const aiSemanticCache = {
        ...baseAiSemanticCacheWithOpenAI,
        config: {
          ...baseAiSemanticCacheWithOpenAI.config,
          cache_control: true,
        },
      };
      await createSemanticCachePlugin(aiSemanticCache);
      await createOpenAIProxy();
    });

    it("Don't use cache if Cache-Control request header forbids", async function () {
      await waitForConfigRebuild();

      const makeRequest = () => axios({
        method: 'post',
        url: `${proxy}${path}`,
        headers: {
          'Cache-Control': 'no-store',
        },
        data: {
          messages: [{
            'role': 'user',
            'content': 'What is the tallest mountain on Earth?'
          }]
        },
        validateStatus: null
      })

      await retryAIRequest(
        makeRequest,
        (resp) => {
          logResponse(resp);
          expect(resp.headers['x-cache-status']).to.equal('Bypass');
        },
        "openai",
      );
    });
  });

  context('Cache control by response headers', function () {
    let postFunctionPluginId: string;

    before(async function () {
      const aiSemanticCache = {
        ...baseAiSemanticCacheWithOpenAI,
        config: {
          ...baseAiSemanticCacheWithOpenAI.config,
          cache_control: true,
        },
      };
      await createSemanticCachePlugin(aiSemanticCache);
      await createOpenAIProxy();
    });

    it("Don't store cache if Cache-Control response header forbids", async function () {
      const pluginPayload = {
        name: 'pre-function',
        config: {
          header_filter: [
            `kong.response.set_header('Cache-Control', 'no-store')`
          ]
        }
      };
      const resp = await createPlugin(pluginPayload);
      postFunctionPluginId = resp.id;
      await waitForConfigRebuild();

      const makeRequest = () => axios({
        method: 'post',
        url: `${proxy}${path}`,
        data: {
          messages: [{
            'role': 'user',
            'content': 'What is the tallest mountain on Earth?'
          }]
        },
        validateStatus: null
      })

      await retryAIRequest(
        makeRequest,
        (resp) => {
          logResponse(resp);
          expect(resp.headers['x-cache-status']).to.equal('Bypass');
        },
        "openai",
      );
    });

    it("Don't store cache if response header shows that the content is expired", async function () {
      const pluginPayload = {
        name: 'pre-function',
        config: {
          header_filter: [
            `kong.response.set_header('Expires', 'Wed, 06 Aug 2024 06:44:29 GMT')`
          ]
        }
      };
      const resp = await createPlugin(pluginPayload);
      postFunctionPluginId = resp.id;
      await waitForConfigRebuild();

      const makeRequest = () => axios({
        method: 'post',
        url: `${proxy}${path}`,
        data: {
          messages: [{
            'role': 'user',
            'content': 'What is the tallest mountain on Earth?'
          }]
        },
        validateStatus: null
      })

      await retryAIRequest(
        makeRequest,
        (resp) => {
          logResponse(resp);
          expect(resp.headers['x-cache-status']).to.equal('Bypass');
        },
        "openai",
      );
    });

    it("Don't use stale cache", async function () {
      // waitForConfigRebuild can take several seconds and the first inference request also takes
      // several seconds (and might be retried), so here we set the expiration time to 30 seconds.
      const expiredTime = new Date(Date.now() + 30 * 1000).toUTCString();
      logDebug(`Set Expires header to ${expiredTime}`);
      const pluginPayload = {
        name: 'pre-function',
        config: {
          header_filter: [
            `kong.response.set_header('Expires', '${expiredTime}')`
          ]
        }
      };
      const resp = await createPlugin(pluginPayload);
      postFunctionPluginId = resp.id;
      await waitForConfigRebuild();

      const makeRequest = () => axios({
        method: 'post',
        url: `${proxy}${path}`,
        data: {
          messages: [{
            'role': 'user',
            'content': 'What is the largest lake on Earth?'
          }]
        },
        validateStatus: null
      })

      let originalContent = '';
      await retryAIRequest(
        makeRequest,
        (resp) => {
          logResponse(resp);
          expect(resp.headers['x-cache-status'], "Cache status should be Miss").to.equal('Miss');
          originalContent = resp.data.choices[0].message.content;
        },
        "openai",
      );

      let cachedContent = '';
      await retryAIRequest(
        makeRequest,
        (resp) => {
          logResponse(resp);
          expect(resp.headers['x-cache-status'], "Cache status should be Hit").to.equal('Hit');
          cachedContent = resp.data.choices[0].message.content;
        },
        "openai",
      );
      expect(cachedContent, "cached content should be equal to original content").to.equal(originalContent);

      await deletePlugin(postFunctionPluginId);
      postFunctionPluginId = '';
      await waitForConfigRebuild()

      const delta = 1000; // 1 seconds margin
      if (new Date(expiredTime).getTime() - Date.now() + delta > 0) {
        const waitTime = new Date(expiredTime).getTime() - Date.now() + delta;
        logDebug(`Waiting for cache to expire: ${waitTime} ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      await retryAIRequest(
        makeRequest,
        (resp) => {
          logResponse(resp);
          expect(resp.headers['x-cache-status'], "Stale cache should be bypassed").to.equal('Bypass');
        },
        "openai",
      );
    });

    afterEach(async function () {
      if (postFunctionPluginId) {
        await deletePlugin(postFunctionPluginId);
        postFunctionPluginId = '';
      }
    })
  });

  afterEach(async function() {
    if (this.currentTest?.state === 'failed') {
      getGatewayContainerLogs(kongContainerName, 100);
    }
  });

  after(async function () {
    await clearAllKongResources()
  });
});
