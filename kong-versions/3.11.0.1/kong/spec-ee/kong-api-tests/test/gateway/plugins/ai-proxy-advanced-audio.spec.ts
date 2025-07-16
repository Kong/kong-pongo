import axios from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';
import {
  expect,
  createGatewayService,
  createRouteForService,
  clearAllKongResources,
  waitForConfigRebuild,
  randomString,
  createPlugin,
  patchPlugin,
  eventually,
  vars,
  getBasePath,
  isGateway,
  Environment,
} from '@support';

const HEADER_NAME = 'authorization';
const HEADER_VALUE = `Bearer ${vars.ai_providers.OPENAI_API_KEY}`;
let pluginId: string;
let pluginPayload: any;
const outputPath = `./${randomString()}.mp3`;
const proxyUrl = getBasePath({
  environment: isGateway() ? Environment.gateway.proxy : undefined,
});

describe('Gateway Plugins: AI Proxy Advanced - Audio', function () {
  this.timeout(10000);
  before(async function () {
    const dummyService = await createGatewayService(randomString(), {
      url: 'http://dummy.io',
    });

    const dummyRoute = await createRouteForService(dummyService.id, undefined, {
      name: randomString(),
      paths: ['/nat/audio'],
    });

    pluginPayload = {
      name: 'ai-proxy-advanced',
      enabled: true,
      route: { id: dummyRoute.id },
      protocols: ['http', 'https'],
      config: {
        balancer: {
          algorithm: 'round-robin',
          connect_timeout: 60000,
          failover_criteria: ['error', 'timeout'],
          hash_on_header: 'X-Kong-LLM-Request-ID',
          latency_strategy: 'tpot',
          read_timeout: 60000,
          retries: 5,
          slots: 10000,
          tokens_count_strategy: 'total-tokens',
          write_timeout: 60000,
        },
        embeddings: null,
        genai_category: 'audio/transcription',
        llm_format: 'openai',
        max_request_body_size: 104857600,
        model_name_header: true,
        response_streaming: 'allow',
        targets: [
          {
            logging: { log_payloads: false, log_statistics: false },
            weight: 100,
            model: {
              name: 'whisper-1',
              options: {
                cohere: { embedding_input_type: 'classification' },
                huggingface: {},
                azure_api_version: '2023-05-15',
                bedrock: { embeddings_normalize: false },
                gemini: {},
              },
              provider: 'openai',
            },
            route_type: 'audio/v1/audio/transcriptions',
            auth: {
              allow_override: false,
              azure_use_managed_identity: false,
              header_name: HEADER_NAME,
              gcp_use_service_account: false,
              header_value: HEADER_VALUE,
            },
          },
        ],
      },
    };
    const plugin = await createPlugin(pluginPayload);

    pluginId = plugin.id;
    await waitForConfigRebuild();
  });

  it('should return transcription correctly', async function () {
    const expectedText = 'In addition to error codes returned from API responses';
    const filePath = 'support/data/ai/speech.mp3';
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('model', 'whisper-1');

    try {
      const response = await axios.post(`${proxyUrl}/nat/audio`, form, {
        headers: {
          ...form.getHeaders(),
        },
      });
      expect(response.status).to.equal(200);
      expect(response.data.text).to.include(expectedText);
    } catch (error) {
      const reason = axios.isAxiosError(error)
        ? error.response?.data || error.message
        : error instanceof Error
        ? error.message
        : String(error);
      console.error('Transcription request failed:', reason);
      throw error;
    }
  });

  it('should return translation correctly', async function () {
    pluginPayload.config.targets[0].route_type = 'audio/v1/audio/translations';
    pluginPayload.config.targets[0].model.name = 'whisper-1';

    await patchPlugin(pluginId, pluginPayload);
    await waitForConfigRebuild();

    const filePath = 'support/data/ai/chinese.mp3';
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    await eventually(async () => {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      form.append('model', 'whisper-1');
      const response = await axios.post(`${proxyUrl}/nat/audio`, form, {
        headers: {
          ...form.getHeaders(),
        },
      });

      expect(response.data.text).to.include(
        'A free text-to-voice translation tool provides voice synthesis services Supporting multiple languages',
      );
    });
  });

  it('should return speech correctly', async function () {
    pluginPayload.config.genai_category = 'audio/speech';
    pluginPayload.config.targets[0].route_type = 'audio/v1/audio/speech';
    pluginPayload.config.targets[0].model.name = 'tts-1';

    await patchPlugin(pluginId, pluginPayload);

    await eventually(async () => {
      const response = await axios.post(
        `${proxyUrl}/nat/audio`,
        {
          model: 'tts-1',
          voice: 'alloy',
          response_format: 'mp3',
          input:
            'In addition to error codes returned from API responses, you can inspect HTTP response headers containing the unique ID of a particular API request or information about rate limiting applied to your requests. Below is an incomplete list of HTTP headers returned with API responses.',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        },
      );

      const buffer = Buffer.from(response.data);
      fs.writeFileSync(outputPath, buffer);
      const stats = fs.statSync(outputPath);
      const fileSizeKB = stats.size / 1024;
      expect(fileSizeKB).to.be.greaterThan(10);
    });
  });

  after(async function () {
    fs.unlinkSync(outputPath);
    await clearAllKongResources();
  });
});
