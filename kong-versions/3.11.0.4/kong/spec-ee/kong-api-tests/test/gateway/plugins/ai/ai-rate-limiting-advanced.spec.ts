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
} from '@support'

describe('@ai: Gateway Plugins: AI Rate Limiting Advanced', function () {
  const proxy = getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  });
  const path = `/${randomString()}`;
  const model = 'gpt-4o-mini';
  const inputCost = 0.1;
  const outputCost = 0.5;

  let serviceId: string;

  async function hit(): Promise<AxiosResponse> {
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

  before(async function () {
    const service = await createGatewayService(randomString());
    serviceId = service.id;
    await createRouteForService(serviceId, [path]);
    const pluginPayload = {
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
    await createPlugin(pluginPayload);
  });

  it(`should support decrementing in fraction with redis`, async function () {
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
        sync_rate: 0.1,
        window_type: "fixed",
        tokens_count_strategy: "cost"
      },
      service: { id: serviceId },
      name: 'ai-rate-limiting-advanced'
    };
    await createPlugin(pluginPayload);
    await waitForConfigRebuild();

    let cost = 0;
    let remaining = 100;
    const lastHit = 3;
    for (let i = 0; i < lastHit; i++) {
      logDebug(`Hit ${i + 1} times`);
      const resp = await hit();
      expect(resp.status).to.equal(200);
      remaining = Number(resp.headers['x-ai-ratelimit-remaining-minute-openai']);

      if (i < lastHit - 1) {
        const data = resp.data;
        cost += inputCost * data.usage.prompt_tokens + outputCost * data.usage.completion_tokens;
      }
    }
    expect(remaining).to.equal(100 - cost / 1e6);
  });

  after(async function () {
    await clearAllKongResources();
  });
});
