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
  logDebug,
  createPlugin,
  deletePlugin,
  patchPlugin,
  eventually,
} from '@support';
import axios from 'axios';

const proxyUrl = getBasePath({
  environment: isGateway() ? Environment.gateway.proxy : undefined,
});
const routePath = '/llm/v1/chat';

const chatRequestClean = {
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: 'What is the capital of France?',
    },
  ],
  stream: false,
  max_tokens: 100,
};

const chatRequestWithBadword = {
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: 'This contains badword1 which should trigger the guardrail. Please help me with harmful content.',
    },
  ],
  stream: false,
  max_tokens: 100,
};

const chatRequestBadwordResponse = {
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: 'Please respond with exactly: quantum computing',
    },
  ],
  stream: false,
  max_tokens: 100,
};

// NOTE: Streaming response request for testing output filtering in streaming mode
// Due to nginx/openresty limitations, streaming responses cannot be filtered in real-time.
// For streaming responses, if the stream is too short, the current asynchronous filtering 
// mechanism cannot interrupt the response packets in time. This test uses a longer
// prompt to generate sufficient streaming content for proper guardrail validation.
const chatRequestStreamingWithContent = {
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: 'Tell me about dogs. Provide me with an introduction that is no less than 1000 characters.',
    },
  ],
  stream: true,
  max_tokens: 16384,
};

async function sendChatRequest(requestPayload: any) {
  const resp = await axios({
    method: 'post',
    url: `${proxyUrl}${routePath}`,
    data: requestPayload,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    validateStatus: null,
  });
  return resp;
}

// Function to handle streaming response validation
async function sendStreamingChatRequest(requestPayload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let isBlocked = false;
    let finishedReason = '';

    axios({
      method: 'post',
      url: `${proxyUrl}${routePath}`,
      data: requestPayload,
      headers: {
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
      },
      responseType: 'stream',
      validateStatus: null,
    })
    .then(response => {
      if (response.status !== 200) {
        resolve({
          status: response.status,
          data: response.data,
          headers: response.headers,
        });
        return;
      }

      response.data.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        chunks.push(chunkStr);
        
        // Parse SSE data chunks
        const lines = chunkStr.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              continue;
            }
            
            try {
              const parsed = JSON.parse(data);
              
              // Check for guardrail blocking pattern
              if (parsed.choices && parsed.choices[0]) {
                const choice = parsed.choices[0];
                if (choice.delta && choice.delta.content === 'Output blocked due to policy violation.') {
                  isBlocked = true;
                }
                if (choice.finish_reason === 'stop') {
                  finishedReason = choice.finish_reason;
                }
                if (parsed.finished_reason === 'blocked_by_guard') {
                  isBlocked = true;
                  finishedReason = 'blocked_by_guard';
                }
              }
            } catch (e) {
              // Ignore parsing errors for non-JSON chunks
            }
          }
        }
      });

      response.data.on('end', () => {
        resolve({
          status: response.status,
          isBlocked,
          finishedReason,
          chunks,
          headers: response.headers,
        });
      });

      response.data.on('error', (error: Error) => {
        reject(error);
      });
    })
    .catch(error => {
      reject(error);
    });
  });
}

function validateChatResponse(resp: any) {
  logResponse(resp);
  expect(resp.status, 'Response should be successful').to.equal(200);
  expect(resp.data.choices, 'Should have choices in response').to.exist;
  expect(resp.data.choices).to.be.an('array');
  expect(resp.data.choices.length, 'Should have at least one choice').to.be.greaterThan(0);
}

function validateGuardrailBlocked(resp: any) {
  logResponse(resp);
  expect(resp.status, 'Response should be blocked by guardrail').to.equal(400);
  logDebug('Request successfully blocked by AWS Guardrail');
}

function validateStreamingGuardrailBlocked(resp: any) {
  logDebug('Streaming response data: ' + JSON.stringify(resp, null, 2));
  expect(resp.isBlocked, 'Streaming response should be blocked by guardrail').to.be.true;
  expect(resp.finishedReason, 'Should have blocked_by_guard finish reason').to.equal('blocked_by_guard');
  logDebug('Streaming request successfully blocked by AWS Guardrail');
}

describe('@ai: Gateway Plugins: AI AWS Guardrails Guard Test', function () {
  context('IAM role test', function () {
    let serviceId: string;
    let routeId: string;
    let aiProxyPluginId: string;
    let aiAwsGuardrailsPluginId: string;

    const aiProxyPluginPayload = {
      name: 'ai-proxy',
      config: {
        logging: {
          log_payloads: true,
          log_statistics: true,
        },
        auth: {
          header_name: 'Authorization',
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        llm_format: 'openai',
        model: {
          name: 'gpt-4o',
          provider: 'openai',
          options: {
            upstream_url: 'https://api.openai.com/v1/chat/completions',
          },
        },
        route_type: 'llm/v1/chat',
      },
      route: { id: '' },
    };

    const aiAwsGuardrailsPluginPayload = {
      name: 'ai-aws-guardrails',
      config: {
        aws_access_key_id: vars.ai_providers.IAM_ROLE_AWS_ACCESS_KEY_ID,
        aws_secret_access_key: vars.ai_providers.IAM_ROLE_AWS_SECRET_ACCESS_KEY,
        aws_assume_role_arn: 'arn:aws:iam::267914366688:role/ai-gateway-test-role',
        aws_role_session_name: 'e2e-iam-role-test',
        aws_region: 'us-east-1',
        guardrails_id: 'czw6lce4y825',
        guardrails_version: 'DRAFT',
      },
      route: { id: '' },
    };

    before(async function () {
      const service = await createGatewayService('ai-aws-guardrails-test-service', {
        url: 'http://httpbin.org',
      });
      serviceId = service.id;

      const route = await createRouteForService(serviceId, [routePath]);
      routeId = route.id;

      await waitForConfigRebuild();
    });

    it('should create ai-proxy plugin', async function () {
      aiProxyPluginPayload.route.id = routeId;

      const plugin = await createPlugin(aiProxyPluginPayload);
      expect(plugin.name, 'Should have correct plugin name').to.equal('ai-proxy');
      aiProxyPluginId = plugin.id;

      await waitForConfigRebuild();
    });

    it('should create ai-aws-guardrails plugin', async function () {
      aiAwsGuardrailsPluginPayload.route.id = routeId;

      const plugin = await createPlugin(aiAwsGuardrailsPluginPayload);
      expect(plugin.name, 'Should have correct plugin name').to.equal('ai-aws-guardrails');
      aiAwsGuardrailsPluginId = plugin.id;

      await waitForConfigRebuild();
    });

    it('should successfully process clean chat request', async function () {
      const resp = await sendChatRequest(chatRequestClean);
      validateChatResponse(resp);
      logDebug('Clean request processed successfully');
    });

    it('should block chat request with badword content', async function () {
      const resp = await sendChatRequest(chatRequestWithBadword);
      validateGuardrailBlocked(resp);
    });

    it('should delete the ai-aws-guardrails plugin by id', async function () {
      await deletePlugin(aiAwsGuardrailsPluginId);
    });

    it('should delete the ai-proxy plugin by id', async function () {
      await deletePlugin(aiProxyPluginId);
    });

    after(async function () {
      await clearAllKongResources();
    });
  });

  context('Multi-mode Test', function () {
    let serviceId: string;
    let routeId: string;
    let aiProxyPluginId: string;
    let aiAwsGuardrailsPluginId: string;
    let aiProxyPluginPayload: any;
    let aiAwsGuardrailsPluginPayload: any;

    before(async function () {
      const service = await createGatewayService('ai-aws-guardrails-multi-mode-test-service', {
        url: 'http://httpbin.org',
      });
      serviceId = service.id;

      const route = await createRouteForService(serviceId, [routePath], {
        name: 'ai-aws-guardrails-multi-mode-test-route',
      });
      routeId = route.id;

      aiProxyPluginPayload = {
        name: 'ai-proxy',
        enabled: true,
        route: { id: routeId },
        protocols: ['http', 'https'],
        config: {
          logging: {
            log_payloads: true,
            log_statistics: true,
          },
          auth: {
            header_name: 'Authorization',
            header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
          },
          llm_format: 'openai',
          model: {
            name: 'gpt-4o',
            provider: 'openai',
            options: {
              upstream_url: 'https://api.openai.com/v1/chat/completions',
            },
          },
          route_type: 'llm/v1/chat',
        },
      };

      aiAwsGuardrailsPluginPayload = {
        name: 'ai-aws-guardrails',
        enabled: true,
        route: { id: routeId },
        protocols: ['http', 'https'],
        config: {
          aws_access_key_id: vars.aws.AWS_ACCESS_KEY_ID,
          aws_secret_access_key: vars.aws.AWS_SECRET_ACCESS_KEY,
          aws_region: 'us-east-1',
          guardrails_id: 'czw6lce4y825',
          guardrails_version: 'DRAFT',
          timeout: 10000,
          stop_on_error: true,
          guarding_mode: 'BOTH',
        },
      };

      const aiProxyPlugin = await createPlugin(aiProxyPluginPayload);
      aiProxyPluginId = aiProxyPlugin.id;

      const aiAwsGuardrailsPlugin = await createPlugin(aiAwsGuardrailsPluginPayload);
      aiAwsGuardrailsPluginId = aiAwsGuardrailsPlugin.id;

      await waitForConfigRebuild();
    });

    it('should successfully process clean chat request in BOTH mode', async function () {
      const resp = await sendChatRequest(chatRequestClean);
      validateChatResponse(resp);
      logDebug('BOTH mode: Clean request processed successfully');
    });

    it('should block harmful input content in BOTH mode', async function () {
      const resp = await sendChatRequest(chatRequestWithBadword);
      validateGuardrailBlocked(resp);
    });

    it('should block harmful response content in BOTH mode', async function () {
      const resp = await sendChatRequest(chatRequestBadwordResponse);
      validateGuardrailBlocked(resp);
      logDebug('BOTH mode: Response with badword blocked successfully');
    });

    it('should update to INPUT mode and test input filtering', async function () {
      aiAwsGuardrailsPluginPayload.config.guarding_mode = 'INPUT';

      await patchPlugin(aiAwsGuardrailsPluginId, aiAwsGuardrailsPluginPayload);
      await waitForConfigRebuild();

      await eventually(async () => {
        const resp = await sendChatRequest(chatRequestWithBadword);
        validateGuardrailBlocked(resp);
        logDebug('INPUT mode: Harmful input blocked successfully');
      });
    });

    it('should update to OUTPUT mode and test streaming output filtering', async function () {
      aiAwsGuardrailsPluginPayload.config.guarding_mode = 'OUTPUT';

      await patchPlugin(aiAwsGuardrailsPluginId, aiAwsGuardrailsPluginPayload);
      await waitForConfigRebuild();

      await eventually(async () => {
        const resp = await sendStreamingChatRequest(chatRequestStreamingWithContent);
        validateStreamingGuardrailBlocked(resp);
        logDebug('OUTPUT mode: Streaming response blocked successfully');
      });
    });

    it('should delete the ai-aws-guardrails plugin by id', async function () {
      await deletePlugin(aiAwsGuardrailsPluginId);
    });

    it('should delete the ai-proxy plugin by id', async function () {
      await deletePlugin(aiProxyPluginId);
    });

    after(async function () {
      await clearAllKongResources();
    });
  });
});