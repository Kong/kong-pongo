import {
  GoogleGenAI,
} from '@google/genai';
import {
  clearAllKongResources,
  clearSemanticCache,
  createGatewayService,
  createPlugin,
  createRouteForService,
  deletePlugin,
  Environment,
  expect,
  getBasePath,
  getGatewayContainerLogs,
  getKongContainerName,
  isGwHybrid,
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
        threshold: 0.1,
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
        name: 'post-function',
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
        name: 'post-function',
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
