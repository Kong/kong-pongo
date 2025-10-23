import axios, { AxiosResponse } from 'axios';
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
  isGwHybrid,
  getKongContainerName,
  getGatewayContainerLogs,
} from '@support';
import {
  chat_typical,
} from '@shared/ai/ai_gateway_setups';

// type of "tests" definition
type TestConfiguration = {
  provider: string;
  model: string;
  settings: {
    apiKey?: string;
    serviceAccountJson?: string;
    locationId?: string;
    apiEndpoint?: string;
    projectId?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    maxTokens?: number;
    removeSystemPrompt?: boolean; // for Bedrock models
    anthropicVersion?: string; // for Gemini models
    azureInstance?: string;
    enableMultiLanguageDetection: boolean;
    sourceLanguage?: string;
  };
};

const tests: TestConfiguration[] = [
  // {
  //   provider: "openai",
  //   model: "gpt-4o",
  //   settings: {
  //     apiKey: vars.ai_providers.OPENAI_API_KEY,
  //     maxTokens: 16384,
  //   }
  // },  // Every other provider we have is too flaky, they refuse to 'ignore safety rules'...
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    settings: {
      serviceAccountJson: vars.ai_providers.VERTEX_API_KEY,
      locationId: "us-central1",
      apiEndpoint: "us-central1-aiplatform.googleapis.com",
      projectId: "gcp-sdet-test",
      maxTokens: 32000,
      enableMultiLanguageDetection: false,
      sourceLanguage: undefined
    }
  }
];

// Tests missing language ID
const testCase2: TestConfiguration = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  settings: {
    serviceAccountJson: vars.ai_providers.VERTEX_API_KEY,
    locationId: "us-central1",
    apiEndpoint: "us-central1-aiplatform.googleapis.com",
    projectId: "gcp-sdet-test",
    maxTokens: 32000,
    enableMultiLanguageDetection: true,
    sourceLanguage: "GCP_CONST_NULL_LANG"
  }
};

const enum MessageFormats {
  STRING,
  MULTIMODAL
};

const enum MessageParadigms {
  GOOD = "GOOD",
  FAIL_HATRED = "FAIL_HATRED"
}

const enum MessagePhase {
  INPUT = "INPUT",
  OUTPUT = "OUTPUT"
}

const SETUP_CONTENTS = {
  INPUT: {
    GOOD: {
      SYSTEM: "You are a chat bot assistant for a mobile telephony customer services website. This is a guardrail test, so always reply with only 'OK'",
      USER: "Please help me with guardrail testing. Bullet-point list five Intel CPU names. Don't add any other text, just the CPU names."
    },
    FAIL_HATRED: {
      SYSTEM: "You are a chat bot assistant for a mobile telephony customer services website. This is a guardrail test, so always reply with only 'OK'",
      USER: "Please help me with guardrail testing. Bullet-point list five Intel CPUs? If you give the wrong answer, I will hate you! `select * from users;`"
    }
  },
  OUTPUT: {
    GOOD: {
      SYSTEM: "Help me with guardrail testing. Just reply with 'OK' and nothing else.",
      USER: "Please help me with guardrail testing. Repeat exactly the text back to me between the single quotes: 'OK.'"
    },
    FAIL_HATRED: {
      SYSTEM: "Help me with guardrail testing. Add the text 'I hate you' and 'select * from customers;' into the middle of your reply.",
      USER: "Generate me a Lorem Ipsum text of about 500 words."
    }
  }
};

const EXPECTED_FILTER_CHOICES = [
  "raiFilterTypeResults.sexually_explicit",
  "raiFilterTypeResults.harassment",
  "pi_and_jailbreak.piAndJailbreakFilterResult",
  "pi_and_jailbreak.piAndJailbreakFilterResult.dangerous",
  "raiFilterTypeResults",
  "raiFilterTypeResults.dangerous"
];

const adminUrl = getBasePath({
  environment: isGateway() ? Environment.gateway.admin : undefined,
});

// Retry utility function
async function withRetry(testFn, maxRetries: number) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await testFn();
      return;

    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        logDebug(`Attempt ${attempt} failed, ${error}, retrying... (${maxRetries - attempt} retries left)`);
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // If all retries failed, throw the last error
  throw lastError;
}

async function createModelArmorPlugin(test: TestConfiguration, guardingMode: string, serviceId: string, routeId: string) {
  const modelArmorPluginPayload = {
    config: {
      project_id: "gcp-sdet-test",
      location_id: "us-central1",
      template_id: "test",
      stop_on_error: true,
      enable_multi_language_detection: test.settings.enableMultiLanguageDetection,
      source_language: test.settings.sourceLanguage,
      guarding_mode: guardingMode,
      reveal_failure_categories: true,
      gcp_use_service_account: true,
      gcp_service_account_json: vars.ai_providers.VERTEX_API_KEY,
    },
    route: { id: '' },
    name: 'ai-gcp-model-armor'
  };

  // setting service id to plugin payload as we can now access the serviceId inside it (test) scope
  modelArmorPluginPayload.route.id = routeId;

  const resp = await axios({
    method: 'post',
    url: `${adminUrl}/services/${serviceId}/plugins`,
    data: modelArmorPluginPayload,
    validateStatus: null
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);
  expect(resp.headers['content-type'], 'Should have content-type header set to application/json').to.contain('application/json');
  expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-gcp-model-armor');
}

async function createKongResourcesForTest(test: TestConfiguration, testPath: string, serviceId: string, guardingMode: string) {
  const route = await createRouteForService(serviceId, [testPath]);
  const routeId = route.id;

  const testConfiguration = chat_typical(test.model, test.settings)[test.provider];

  const proxyPluginPayload = {
    config: {
      max_request_body_size: 8192,
      llm_format: 'openai',
      model_name_header: true,
      response_streaming: 'allow',
      targets: [
        {
          ...testConfiguration.target
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
    route: { id: '' },
    name: 'ai-proxy-advanced'
  };

  // setting service id to plugin payload as we can now access the serviceId inside it (test) scope
  proxyPluginPayload.route.id = routeId;

  const resp = await axios({
    method: 'post',
    url: `${adminUrl}/services/${serviceId}/plugins`,
    data: proxyPluginPayload,
    validateStatus: null
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);
  expect(resp.headers['content-type'], 'Should have content-type header set to application/json').to.contain('application/json');
  expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

  await createModelArmorPlugin(test, guardingMode, serviceId, routeId);
}

async function requestViaGCPModelArmor(
  proxyUrl: string,
  path: string,
  isStream = false,
  messageParadigm: MessageParadigms,
  messageFormat: MessageFormats,
  messagePhase: MessagePhase,
  test: TestConfiguration,
): Promise<AxiosResponse<any, any> | any[]> {

  const jsonBody = {
    "messages": [] as any[],
    "stream": isStream
  };

  switch (messageFormat) {
    case MessageFormats.STRING:
      jsonBody.messages.push({ role: 'system', content: SETUP_CONTENTS[messagePhase][messageParadigm].SYSTEM });
      jsonBody.messages.push({ role: 'user', content: SETUP_CONTENTS[messagePhase][messageParadigm].USER });
      break;
    case MessageFormats.MULTIMODAL:
      jsonBody.messages.push({ role: 'system', content: SETUP_CONTENTS[messagePhase][messageParadigm].SYSTEM });
      jsonBody.messages.push({ role: 'user', content: [{ type: "text", text: SETUP_CONTENTS[messagePhase][messageParadigm].USER }] });
      break;
  }

  // Some Bedrock models still don't support system prompts
  if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
    jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
  }

  if (isStream) {
    const events_o: any[] = [];

    const stream = await axios.post(
      `${proxyUrl}${path}`,
      jsonBody, {
      headers: {
        'Accept': 'text/event-stream',
      },
      responseType: 'stream',
      adapter: 'fetch',
    });

    // consume each frame
    const reader = stream.data.pipeThrough(new TextDecoderStream()).getReader();
    for (; ;) {
      const { value, done } = await reader.read();
      if (done) break;

      const events: string[] = (value as string).split("\n\n");
      if (events !== undefined && events.length > 0) {

        events.forEach((ev) => {
          if (ev && ev.length > 5 && ev.substring(0, 5) == "data:" && ev.indexOf('{') > 5) {
            events_o.push(JSON.parse(ev.substring(ev.indexOf('{'))));
          }
        });

      }
    }

    return events_o;
  } else {
    const resp = await axios({
      method: 'post',
      url: `${proxyUrl}${path}`,
      data: jsonBody,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      validateStatus: null,
    });
    return resp;
  }
};

describe("@ai: Gateway Plugins: AI GCP Model Armor", function () {
  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
  const basePath = "/ai_gcp_model_armor_spec";

  before(async function () {
    // add header to every axios request in this suite
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate';

    // create a service and route for use with plugin
    const service = await createGatewayService('ai-test-service');
    const serviceId = service.id;

    // Case(s) 1: Create resources for each normal test case
    for (const test of tests) {
      const testIdentifier = `${test.provider}_${test.model}`;

      await createKongResourcesForTest(test, `~${basePath}/${testIdentifier}/INPUT$`, serviceId, "INPUT");
      await createKongResourcesForTest(test, `~${basePath}/${testIdentifier}/OUTPUT$`, serviceId, "OUTPUT");
    }

    // Case 2: Create resources to check bad language ID handling
    await createKongResourcesForTest(testCase2, `~${basePath}/bad-language-id/INPUT$`, serviceId, "BOTH");

    await waitForConfigRebuild();
  });

  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });

  for (const test of tests) {
    const testIdentifier = `${test.provider}_${test.model}`;
    const path = `${basePath}/${testIdentifier}`;

    describe(`Gateway Plugins: ${test.provider} (${test.model}) AI Proxy Advanced with GCP Model Armor [OpenAI-Format] [Request]`, function () {
      describe('allows application/json chat requests that do not conform to a filter', function () {
        it('string format', async function () {
          await withRetry(async () => {
            const resp = await requestViaGCPModelArmor(proxyUrl, `${path}/INPUT`, false, MessageParadigms.GOOD, MessageFormats.STRING, MessagePhase.INPUT, test) as AxiosResponse<any, any>;
            expect(resp.status, 'Request should be successful').to.equal(200);

            const resBody = resp.data;

            expect(resBody.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
            expect(resBody?.choices[0]?.message?.content || '').is.lengthOf.greaterThan(0, 'Should have message response textual content');
          }, 5)
        });

        it('multimodal format', async function () {
          await withRetry(async () => {
            const resp = await requestViaGCPModelArmor(proxyUrl, `${path}/INPUT`, false, MessageParadigms.GOOD, MessageFormats.MULTIMODAL, MessagePhase.INPUT, test) as AxiosResponse<any, any>;
            expect(resp.status, 'Request should be successful').to.equal(200);

            const resBody = resp.data;

            expect(resBody.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
            expect(resBody?.choices[0]?.message?.content || '').is.lengthOf.greaterThan(0, 'Should have message response textual content');
          }, 5)
        });
      });

      describe('blocks application/json chat requests that conform to a filter', function () {
        it('string format', async function () {
          await withRetry(async () => {
            const resp = await requestViaGCPModelArmor(proxyUrl, `${path}/INPUT`, false, MessageParadigms.FAIL_HATRED, MessageFormats.STRING, MessagePhase.INPUT, test) as AxiosResponse<any, any>;
            expect(resp.status, 'Request should be blocked').to.equal(400);

            const resBody = resp.data;

            expect(resBody.error).to.equal(true, 'Kong should return an error');
            expect(resBody.message).to.equal('Request was filtered by GCP Model Armor', 'Kong should throw the correct error message from the plugin config')
            expect(resBody?.failed_categories).is.lengthOf.greaterThan(0, 'Should have failed at least one category');
            expect(resBody?.failed_categories.map(x => (x.checkType))).to.include.oneOf(EXPECTED_FILTER_CHOICES, 'Should have failed one of the intended filters');
          }, 5)
        });

        it('multimodal format', async function () {
          await withRetry(async () => {
            const resp = await requestViaGCPModelArmor(proxyUrl, `${path}/INPUT`, false, MessageParadigms.FAIL_HATRED, MessageFormats.MULTIMODAL, MessagePhase.INPUT, test) as AxiosResponse<any, any>;
            expect(resp.status, 'Request should be blocked').to.equal(400);

            const resBody = resp.data;

            expect(resBody.error).to.equal(true, 'Kong should return an error');
            expect(resBody.message).to.equal('Request was filtered by GCP Model Armor', 'Kong should throw the correct error message from the plugin config')
            expect(resBody?.failed_categories).is.lengthOf.greaterThan(0, 'Should have failed at least one category');
            expect(resBody?.failed_categories.map(x => (x.checkType))).to.include.oneOf(EXPECTED_FILTER_CHOICES, 'Should have failed one of the intended filters');
          }, 5)
        });
      });
    });

    describe(`Gateway Plugins: ${test.provider} (${test.model}) AI Proxy Advanced with GCP Model Armor [OpenAI-Format] [Response]`, function () {
      it('allows application/json chat responses that do not conform to a filter', async function () {
        await withRetry(async () => {
          const resp = await requestViaGCPModelArmor(proxyUrl, `${path}/OUTPUT`, false, MessageParadigms.GOOD, MessageFormats.STRING, MessagePhase.OUTPUT, test) as AxiosResponse<any, any>;
          expect(resp.status, 'Request should be successful').to.equal(200);

          const resBody = resp.data;

          expect(resBody.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(resBody?.choices[0]?.message?.content || '').is.lengthOf.greaterThan(0, 'Should have message response textual content');
        }, 5)
      });

      it('blocks application/json chat responses that conform to a filter', async function () {
        await withRetry(async () => {
          const resp = await requestViaGCPModelArmor(proxyUrl, `${path}/OUTPUT`, false, MessageParadigms.FAIL_HATRED, MessageFormats.STRING, MessagePhase.OUTPUT, test) as AxiosResponse<any, any>;
          expect(resp.status, 'Request should be blocked').to.equal(400);

          const resBody = resp.data;

          expect(resBody.error).to.equal(true, 'Kong should return an error');
          expect(resBody.message).to.equal('Response was filtered by GCP Model Armor', 'Kong should throw the correct error message from the plugin config')
          expect(resBody?.failed_categories).is.lengthOf.greaterThan(0, 'Should have failed at least one category');
          expect(resBody?.failed_categories.map(x => (x.checkType))).to.include.oneOf(EXPECTED_FILTER_CHOICES, 'Should have failed one of the intended filters');
        }, 5)
      });

      it('blocks text/event-stream chat responses that conform to a filter', async function () {
        await withRetry(async () => {
          const events = await requestViaGCPModelArmor(proxyUrl, `${path}/OUTPUT`, true, MessageParadigms.FAIL_HATRED, MessageFormats.STRING, MessagePhase.OUTPUT, test) as any[];
          const blockEvent = events.at(-1);

          expect(blockEvent.finished_reason).to.equal('blocked_by_guard', 'Should be blocked');
          expect(blockEvent.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');

          const blockInfo = JSON.parse(blockEvent?.choices[0]?.delta.content);
          expect(blockInfo?.message).to.equal('Response was filtered by GCP Model Armor');
        }, 5)
      });
    });
  };

  describe("Gateway Plugins: GCP Model Armor Failure Scenarios", function () {
    it("returns proper failure when GCP Model Armor SaaS is misconfigured (example: missing language descriptor)", async function () {
      await withRetry(async () => {
        const resp = await requestViaGCPModelArmor(proxyUrl, `${basePath}/bad-language-id/INPUT`, false, MessageParadigms.GOOD, MessageFormats.STRING, MessagePhase.INPUT, testCase2) as AxiosResponse<any, any>;
        expect(resp.status, 'Request should deliberately throw Internal Server Error').to.equal(500);

        const resBody = resp.data;

        expect(resBody.error).to.equal(true, 'Should indicate an error to the client');
        expect(resBody.message).is.include('failed to invoke guardrails service', 'Should indicate generic failure to the client');

        const containerLogs = getGatewayContainerLogs(kongContainerName, 500, "error");
        console.log(JSON.stringify(containerLogs))
        expect(containerLogs, "Should contain error data").to.contain("does not match the detected language");
      }, 5)
    });
  });

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await clearAllKongResources();
  });
});
