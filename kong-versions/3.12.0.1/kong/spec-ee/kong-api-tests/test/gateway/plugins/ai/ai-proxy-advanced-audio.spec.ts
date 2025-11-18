import axios from 'axios';
import { access } from 'fs/promises';
import { constants } from 'fs';
import fs from 'fs';
import FormData from 'form-data';
import _ from 'lodash';
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

let pluginId: string;
let pluginPayload: any;
const proxyUrl = getBasePath({ environment: isGateway() ? Environment.gateway.proxy : undefined });
const input =
  'In addition to error codes returned from API responses, you can inspect HTTP response headers containing the unique ID of a particular API request or information about rate limiting applied to your requests. Below is an incomplete list of HTTP headers returned with API responses.';

function createAudioTarget(provider: 'openai' | 'azure', operation: 'speech' | 'transcription' | 'translation') {
  const baseConfig: Record<string, any> = {
    logging: { log_payloads: false, log_statistics: false },
    weight: 100,
  };
  const authConfig: Record<string, any> = {
    auth: {
      allow_override: false,
      header_name: 'Authorization',
      header_value:
        provider === 'openai'
          ? 'Bearer ' + vars.ai_providers.OPENAI_API_KEY
          : 'Bearer ' + vars.ai_providers.AZUREAI_REALTIME_API_KEY,
    },
  };
  const routeTypeConfig = {
    openai: {
      speech: { route_type: 'audio/v1/audio/speech' },
      transcription: { route_type: 'audio/v1/audio/transcriptions' },
      translation: { route_type: 'audio/v1/audio/translations' },
    },
    azure: {
      speech: { route_type: 'audio/v1/audio/speech' },
      transcription: { route_type: 'audio/v1/audio/transcriptions' },
      translation: { route_type: 'audio/v1/audio/translations' },
    },
  };
  const modelConfigs: Record<string, any> = {
    openai: {
      speech: {
        model: { name: 'tts-1', provider: provider },
      },
      transcription: {
        model: { name: 'whisper-1', provider: provider },
      },
      translation: {
        model: { name: 'whisper-1', provider: provider },
      },
    },
    azure: {
      speech: {
        model: {
          name: 'gpt-4o-mini-tts',
          options: {
            azure_api_version: '2025-03-01-preview',
            azure_instance: 'ai-gw-sdet-e2e-test2',
            azure_deployment_id: 'gpt-4o-mini-tts',
          },
          provider: provider,
        },
      },
      transcription: {
        model: {
          name: 'gpt-4o-mini-transcribe',
          options: {
            azure_api_version: '2025-03-01-preview',
            azure_instance: 'ai-gw-sdet-e2e-test2',
            azure_deployment_id: 'gpt-4o-mini-transcribe',
          },
          provider: provider,
        },
      },
      translation: {
        model: {
          name: 'gpt-4o-mini-audio-preview',
          options: {
            azure_api_version: '2024-02-01',
            azure_instance: 'ai-gw-sdet-e2e-test2',
            azure_deployment_id: 'gpt-4o-mini-audio-preview',
          },
          provider: provider,
        },
      },
    },
  };

  return {
    ...baseConfig,
    ...authConfig,
    ...routeTypeConfig[provider][operation],
    ...modelConfigs[provider][operation],
  };
}

async function patchAudioPlugin(
  category: string,
  provider: 'openai' | 'azure',
  operation: 'speech' | 'transcription' | 'translation',
) {
  const cloned = _.cloneDeep(pluginPayload);
  cloned.config.genai_category = category;
  cloned.config.targets[0] = createAudioTarget(provider, operation);
  console.log('Patching plugin with config:', JSON.stringify(cloned.config, null, 2));
  await patchPlugin(pluginId, cloned);
  await waitForConfigRebuild();
}

async function ensureFileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
}

describe('@ai: Gateway Plugins: AI Proxy Advanced - Audio', function () {
  before(async function () {
    const dummyService = await createGatewayService(randomString());

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
        genai_category: '',
        llm_format: 'openai',
        max_request_body_size: 104857600,
        model_name_header: true,
        response_streaming: 'allow',
        targets: [],
      },
    };
    pluginPayload.config.genai_category = 'audio/speech';
    pluginPayload.config.targets[0] = createAudioTarget('azure', 'speech');
    const plugin = await createPlugin(pluginPayload);
    pluginId = plugin.id;
    await waitForConfigRebuild();
  });

  it('should be able to speech with azure gpt-4o-mini-tts', async function () {
    const url = `${proxyUrl}/nat/audio`;
    const body = {
      voice: 'alloy',
      input: input,
    };
    const headers = {
      'Content-Type': 'application/json',
    };

    const response = await axios.post(url, body, {
      headers: headers,
      responseType: 'arraybuffer',
      validateStatus: null,
    });
    const buffer = Buffer.from(response.data);
    const fileSizeKB = buffer.length / 1024;
    expect(fileSizeKB).to.be.greaterThan(0);
    expect(response.status, 'Status code should be 200.').to.equal(200);
  });

  it('should return 400 in bad speech request with azure', async function () {
    const response = await axios.post(
      `${proxyUrl}/nat/audio`,
      {},
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: null,
      },
    );
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('error');
    expect(response.data.error.message).to.include("request body doesn't contain valid inputs");
  });

  it('should be able to transcribe audio correctly with azure', async function () {
    await patchAudioPlugin('audio/transcription', 'azure', 'transcription');
    const expectedText = 'In addition to error codes returned from API responses';
    const filePath = 'support/data/ai/speech.mp3';
    await ensureFileExists(filePath);
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    try {
      const response = await axios.post(`${proxyUrl}/nat/audio`, form, {
        headers: {
          ...form.getHeaders(),
        },
        validateStatus: null,
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

  it('should return 400 in bad transcription request with azure', async function () {
    const form = new FormData();
    const response = await axios.post(`${proxyUrl}/nat/audio`, form, {
      headers: {
        ...form.getHeaders(),
      },
      validateStatus: null,
    });
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('error');
  });

  it('should be able to transcribe audio into text correctly with openai whisper-1', async function () {
    await patchAudioPlugin('audio/transcription', 'openai', 'transcription');
    const expectedText = 'In addition to error codes returned from API responses';
    const filePath = 'support/data/ai/speech.mp3';
    await ensureFileExists(filePath);
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    try {
      const response = await axios.post(`${proxyUrl}/nat/audio`, form, {
        headers: {
          ...form.getHeaders(),
        },
        validateStatus: null,
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

  it('should return 400 in bad transcription request with openai', async function () {
    const form = new FormData();
    // use empty form data, missing mandatory 'file' field

    const response = await axios.post(`${proxyUrl}/nat/audio`, form, {
      headers: {
        ...form.getHeaders(),
      },
      validateStatus: null,
    });
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('error');
  });

  it('should be able to translate audio correctly with openai whisper-1', async function () {
    await patchAudioPlugin('audio/transcription', 'openai', 'translation');

    const filePath = 'support/data/ai/chinese.mp3';
    await ensureFileExists(filePath);
    await eventually(async () => {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      const response = await axios.post(`${proxyUrl}/nat/audio`, form, {
        headers: {
          ...form.getHeaders(),
        },
        validateStatus: null,
      });

      expect(response.data.text).to.include(
        'A free text-to-voice translation tool provides voice synthesis services Supporting multiple languages',
      );
    });
  });

  it('should return 400 in bad translation request with openai', async function () {
    const form = new FormData();
    // use empty form data, missing mandatory 'file' field

    const response = await axios.post(`${proxyUrl}/nat/audio`, form, {
      headers: {
        ...form.getHeaders(),
      },
      validateStatus: null,
    });
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('error');
  });

  it('should be able to speech correctly with openai tts-1', async function () {
    const clonedPluginPayload = _.cloneDeep(pluginPayload);
    clonedPluginPayload.config.genai_category = 'audio/speech';
    clonedPluginPayload.config.targets[0] = createAudioTarget('openai', 'speech');

    await patchPlugin(pluginId, clonedPluginPayload);
    await waitForConfigRebuild();

    const url = `${proxyUrl}/nat/audio`;
    const body = {
      voice: 'alloy',
      input: input,
    };
    const headers = {
      'Content-Type': 'application/json',
    };

    await eventually(async () => {
      const response = await axios.post(url, body, {
        headers: headers,
        responseType: 'arraybuffer',
        validateStatus: null,
      });

      expect(response.status, 'Status code should be 200.').to.equal(200);
      const buffer = Buffer.from(response.data);
      const fileSizeKB = buffer.length / 1024;
      expect(fileSizeKB).to.be.greaterThan(10);
    });
  });

  it('should return 400 in bad speech request with openai', async function () {
    const response = await axios.post(
      `${proxyUrl}/nat/audio`,
      {},
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: null,
      },
    );
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('error');
  });

  after(async function () {
    await clearAllKongResources();
  });
});
