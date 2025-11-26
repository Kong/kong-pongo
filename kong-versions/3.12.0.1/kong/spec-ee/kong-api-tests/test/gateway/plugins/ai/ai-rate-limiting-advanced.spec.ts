import axios, {AxiosResponse } from "axios";
import {
  expect,
  createGatewayService,
  createRouteForService,
  getBasePath,
  Environment,
  logResponse,
  waitForConfigRebuild,
  randomString,
  logDebug,
  clearAllKongResources,
  createPlugin,
  vars,
  deletePlugin,
} from '@support'

describe('@ai: Gateway Plugins: AI Rate Limiting Advanced', function () {
  const proxy = getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  });
  const path = `/${randomString()}`;

  async function hit(model: string): Promise<AxiosResponse> {
    const response = await axios.post(`${proxy}${path}`, {
      model: model,
      messages: [
        { role: 'user', content: 'Hello' }
      ],
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      validateStatus: null,
    });
    logResponse(response);
    return response;
  };

  let serviceId: string;

  before(async function () {
    const service = await createGatewayService(randomString());
    serviceId = service.id;
    await createRouteForService(serviceId, [path]);
  });

  context('decrease in fractions with redis', function () {
    let rateLimitingPluginId: string;
    let proxyPluginId: string;

    const model = 'gpt-4o-mini';
    const inputCost = 0.1;
    const outputCost = 0.5;
    const lastHit = 3;
    const pluginPayload = {
      config: {
        strategy: "redis",
        redis: {
          host: "redis",
          port: 6379,
          username: "redisuser",
          password: "redispassword",
        },
        llm_providers: [{
          name: "openai",
          window_size: [60],
          limit: [100],
        }],
        sync_rate: 0.02,
        window_type: "sliding",
        tokens_count_strategy: "cost",
      },
      service: { id: '' },
      name: 'ai-rate-limiting-advanced',
    };

    before(async function () {
      pluginPayload.service.id = serviceId;

      const aiProxyPluginPayload = {
        config: {
          model_name_header: true,
          response_streaming: 'allow',
          targets: [{
            auth: {
              header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
              header_name: 'Authorization',
            },
            model: {
              name: model,
              options: {
                input_cost: inputCost,
                output_cost: outputCost,
              },
              provider: 'openai'
            },
            route_type: 'llm/v1/chat',
          }],
        },
        service: { id: serviceId },
        name: 'ai-proxy-advanced'
      };
      const resp = await createPlugin(aiProxyPluginPayload);
      proxyPluginId = resp.id;
    });

    it(`decrease by whole number with redis by default`, async function () {
      const data = await createPlugin(pluginPayload);
      rateLimitingPluginId = data.id;
      await waitForConfigRebuild();

      let cost = 0;
      let remaining = 100;
      for (let i = 0; i < lastHit; i++) {
        logDebug(`Hit ${i + 1} times`);
        const resp = await hit(model);
        expect(resp.status).to.equal(200);
        remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-openai']);

        if (i < lastHit - 1) {
          const data = resp.data;
          cost += inputCost * data.usage.prompt_tokens + outputCost * data.usage.completion_tokens;
        }
      }
      // Note: the remaining may be different in different runs,
      // because the counter only convert to an integer during sync and sync might be delayed.
      expect(remaining).to.lessThanOrEqual(100 - cost / 1e6);
      expect(remaining).to.greaterThanOrEqual(100 - (lastHit - 1));
    });

    it(`should support decreasing in fraction with redis`, async function () {
      pluginPayload.config["decrease_by_fractions_in_redis"] = true;
      // Use the same namespace as the previous test.
      // Ensure when decrease_by_fractions_in_redis is enabled, we should write to a different Redis key.
      // Otherwise, we will hit the key type conflict error.
      await createPlugin(pluginPayload, 'default', rateLimitingPluginId);
      await waitForConfigRebuild();

      let cost = 0;
      let remaining = 100;
      for (let i = 0; i < lastHit; i++) {
        logDebug(`Hit ${i + 1} times`);
        const resp = await hit(model);
        expect(resp.status).to.equal(200);
        remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-openai']);

        if (i < lastHit - 1) {
          const data = resp.data;
          cost += inputCost * data.usage.prompt_tokens + outputCost * data.usage.completion_tokens;
        }
      }

      // As we sync shdict counter to Redis, the counter in the previous test may be added to the new
      // Redis counter (we use the same namespace to test Redis key type), so the remaining may be
      // less than expected.
      expect(remaining).to.lessThanOrEqual(100 - cost / 1e6);
      const perHitCost = cost / (lastHit - 1);
      expect(remaining).to.greaterThanOrEqual(100 - (lastHit + lastHit - 1) * perHitCost / 1e6);
    });

    after(async function () {
      await deletePlugin(rateLimitingPluginId);
      await deletePlugin(proxyPluginId);
    });
  });

  context('rate limiting with custom provider', async function () {
    let rateLimitingPluginId: string;
    let proxyPluginId: string;

    before(async function () {
      const proxyPluginPayload = {
        config: {
          model_name_header: true,
          response_streaming: 'allow',
          targets: [{
            auth: {
              header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
              header_name: 'Authorization',
            },
            model: {
              provider: 'openai'
            },
            route_type: 'llm/v1/chat',
            logging: {
              log_statistics: true
            },
          }],
        },
        service: { id: serviceId },
        name: 'ai-proxy-advanced'
      };
      const resp = await createPlugin(proxyPluginPayload);
      proxyPluginId = resp.id;
    });

    it('should rate limit based on requestPrompt result', async function () {
      const hits = 2;
      const pluginPayload = {
        config: {
          llm_providers: [{
            name: "requestPrompt",
            window_size: [60],
            limit: [100],
          }],
          request_prompt_count_function: `return 100`,
          tokens_count_strategy: "cost",
        },
        service: { id: serviceId },
        name: 'ai-rate-limiting-advanced',
      };
      const data = await createPlugin(pluginPayload);
      rateLimitingPluginId = data.id;
      await waitForConfigRebuild();

      for (let i = 0; i < hits; i++) {
        logDebug(`Hit ${i + 1} times`);
        const resp = await hit("gpt-4o-mini");
        if (i == 0) {
          expect(resp.status).to.equal(200);
          // AxiosResponseHeaders always lower-case header names
          const remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-requestprompt']);
          expect(remaining).to.equal(100 - 100);
        } else {
          expect(resp.status).to.equal(429);
        }
      }
    });

    it('should rate limit based on customCost', async function () {
      const pluginPayload = {
        config: {
          llm_providers: [
            {
              name: "customCost",
              window_size: [60],
              limit: [4],
            }
          ],
          custom_cost_count_function: `
            local logs = kong.log.serialize()
            -- remember to turn on log_statistics in ai-proxy plugin config
            local model = logs.ai.proxy.meta.request_model
            -- We can do something more like counting the tokens under logs.ai.proxy.usage
            if model == "gpt-4" then
              return 2
            else
              return 1
            end
          `,
        },
        service: { id: serviceId },
        name: 'ai-rate-limiting-advanced',
      };
      const data = await createPlugin(pluginPayload);
      rateLimitingPluginId = data.id;
      await waitForConfigRebuild();

      let resp = await hit('gpt-4');
      expect(resp.status).to.equal(200);
      let remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-customcost']);
      expect(remaining).to.equal(4);

      resp = await hit('gpt-4o-mini');
      expect(resp.status).to.equal(200);
      remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-customcost']);
      expect(remaining).to.equal(2);

      resp = await hit('gpt-4');
      expect(resp.status).to.equal(200);
      remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-customcost']);
      expect(remaining).to.equal(1);

      resp = await hit('gpt-4o-mini');
      expect(resp.status).to.equal(429);
    });

    it('should rate limit based on customCost and other provider result', async function () {
      const pluginPayload = {
        config: {
          llm_providers: [
            {
              name: "customCost",
              window_size: [60],
              limit: [10],
            },
            {
              name: "openai",
              window_size: [60],
              limit: [10],
            }
          ],
          custom_cost_count_function: `return 1`,
          tokens_count_strategy: "prompt_tokens",
        },
        service: { id: serviceId },
        name: 'ai-rate-limiting-advanced',
      };
      const data = await createPlugin(pluginPayload);
      rateLimitingPluginId = data.id;
      await waitForConfigRebuild();

      let resp = await hit('gpt-4o-mini');
      resp = await hit('gpt-4o-mini');
      expect(resp.status).to.equal(200);
      let remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-customcost']);
      expect(remaining).to.equal(9);
      remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-openai']);
      expect(remaining).to.be.greaterThan(0);

      // This time the other provider limit takes effect
      resp = await hit('gpt-4o-mini');
      expect(resp.status).to.equal(429);
    });

    afterEach(async function () {
      await deletePlugin(rateLimitingPluginId);
    });

    after(async function () {
      await deletePlugin(proxyPluginId);
    });
  });

  after(async function () {
    await clearAllKongResources();
  });
});
