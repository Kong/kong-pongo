import {
  expect,
  createGatewayService,
  createRouteForService,
  clearAllKongResources,
  getBasePath,
  getDataFilePath,
  getBinaryFileContent,
  isGateway,
  Environment,
  logResponse,
  waitForConfigRebuild,
  vars,
  logDebug,
  createAILogCollectingRoute,
  checkGwVars,
  deletePlugin,
  randomString,
  wait,
} from '@support'
import axios from 'axios';
import { GoogleGenAI, Modality } from '@google/genai';

// This test verifies the realtime API functionality of the AI Proxy advanced plugin using native format.
describe('@ai: Gateway Plugins: AI Proxy Advanced Realtime Native Format Test', function () {
  // Increase timeout for realtime test
  this.timeout(600000);

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })
  const routePath = `/${randomString()}`;
  const logsCollectingPath = '/ai/collect';

  let serviceId: string;

  before(function () {
    checkGwVars('ai_providers');
  });

  context('Gemini Live API Tests', function () {
    const geminiLiveModel = "gemini-live-2.5-flash-preview";
    // gemini-live-2.5-flash-preview is not public available via Vertex AI yet
    const geminiLiveModelForVertex = "gemini-live-2.5-flash-preview-native-audio-09-2025";

    const pluginPayload = {
      config: {
        max_request_body_size: 99999,
        genai_category: "realtime/generation",
        llm_format: 'gemini', // Using gemini native format for real time test
        model_name_header: true,
        response_streaming: 'allow',
        targets: [] as Array<Record<string, any>>,
      },
      service: { id: '' },
      name: 'ai-proxy-advanced'
    };

    const geminiVariants = {
      "gemini": {
        contructClient: (): GoogleGenAI => {
          return new GoogleGenAI({
            httpOptions: {
              baseUrl: `${proxyUrl}${routePath}`,
            },
          });
        },
        target: {
          auth: {
            param_location: "query",
            param_value: `${vars.ai_providers.GEMINI_API_KEY}`,
            gcp_use_service_account: false,
            param_name: "key",
          },
          model: {
            name: geminiLiveModel,
            options: {
              input_cost: 3,
              output_cost: 12,
            },
            provider: "gemini"
          },
          route_type: "realtime/v1/realtime",
          logging: {
            log_statistics: true,
          },
        }
      },
      "gemini-vertex": {
        contructClient: (): GoogleGenAI => {
          return new GoogleGenAI({
            httpOptions: {
              baseUrl: `${proxyUrl}${routePath}`,
            },
            project: 'gcp-sdet-test',
            location: 'us-central1',
            vertexai: true,
            googleAuthOptions: {
              credentials: JSON.parse(`${vars.ai_providers.VERTEX_API_KEY}`),
            },
          });
        },
        target: {
          auth: {
            gcp_use_service_account: true,
            gcp_service_account_json: `${vars.ai_providers.VERTEX_API_KEY}`,
          },
          model: {
            name: geminiLiveModelForVertex,
            options: {
              input_cost: 3,
              output_cost: 12,
              gemini: {
                api_endpoint: "us-central1-aiplatform.googleapis.com",
                project_id: "gcp-sdet-test",
                location_id: "us-central1",
              },
            },
            provider: "gemini"
          },
          route_type: "realtime/v1/realtime",
          logging: {
            log_statistics: true,
          },
        }
      },
    };

    before(async function () {
      const name = `ai-realtime-native-test-service-${randomString()}`;
      const service = await createGatewayService(
        name,
        {
          host: "dummywss",
          protocol: "ws",
          name: name,
          port: 80,
          enabled: true,
          tls_verify: null,
          path: null
        });
      serviceId = service.id;
      const resp = await createRouteForService(serviceId, null, {
        "request_buffering": true,
        "regex_priority": 0,
        "https_redirect_status_code": 426,
        "strip_path": true,
        "path_handling": "v0",
        "paths": [
          routePath
        ],
        "response_buffering": true,
        "preserve_host": false,
        "name": `ai-realtime-native-route-${randomString()}`,
        "protocols": [
          "ws",
          "wss"
        ]
      });
      await createAILogCollectingRoute(`ai-log-service`, resp.id);
      await waitForConfigRebuild();
    })

    for (const variant of Object.keys(geminiVariants)) {
      context(`Gemini live test, variant: ${variant}`, function () {
        let geminiLiveClient: GoogleGenAI;
        let pluginId: string;
        const model = geminiVariants[variant].target.model.name;

        before(async function () {
          pluginPayload.service.id = serviceId;
          const geminiTarget = geminiVariants[variant].target;
          pluginPayload.config.targets = [geminiTarget];
          const resp = await axios({
            method: 'post',
            url: `${adminUrl}/services/${serviceId}/plugins`,
            data: pluginPayload,
            validateStatus: null
          });

          logResponse(resp);

          expect(resp.status, 'Status should be 201').to.equal(201);
          expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

          pluginId = resp.data.id;

          geminiLiveClient = geminiVariants[variant].contructClient();

          await waitForConfigRebuild();
        });

        it(`should successfully process realtime text interactions via Gemini Live API with Google SDK`, async function () {
          let session: any = null;

          try {
            logDebug('Starting Gemini Live session...');

            // Set up event handlers
            let usageMetadata: any = null;
            let sessionEstablished = false;

            // Create a live session using the Google SDK
            session = await geminiLiveClient.live.connect({
              model: model,
              callbacks: {
                onopen: () => {
                  logDebug('Gemini Live session opened');
                  sessionEstablished = true;
                },
                onmessage: (message) => {
                  logDebug(`Received message: size ${JSON.stringify(message).length}`);

                  if (message.usageMetadata) {
                    logDebug(`Message with usageMetadata: ${JSON.stringify(message)}`);
                    usageMetadata = message.usageMetadata;
                  }
                },
                onerror: (error) => {
                  logDebug(`Session error: ${JSON.stringify(error)}`);
                  throw error;
                },
                onclose: () => {
                  logDebug('Session closed by server');
                }
              }
            });

            // Wait for session to be established
            const sessionTimeout = 10000;
            const sessionStartTime = Date.now();
            while (!sessionEstablished) {
              if (Date.now() - sessionStartTime > sessionTimeout) {
                throw new Error('Timeout waiting for Gemini Live session to establish');
              }
              await wait(100); // eslint-disable-line no-restricted-syntax
            }

            logDebug('Gemini Live session connected');

            // Send a text message
            logDebug('Sending text message to Gemini Live...');
            session.sendClientContent({
              turns: 'Say "hello" in one word.',
              turnComplete: true
            });

            // Wait for response with timeout
            const timeout = 30000;
            const startTime = Date.now();

            while (!usageMetadata) {
              if (Date.now() - startTime > timeout) {
                throw new Error('Timeout waiting for Gemini Live response');
              }
              await wait(500); // eslint-disable-line no-restricted-syntax
            }

            logDebug('Response received from Gemini Live');

            // Validate usage metadata
            expect(usageMetadata, 'Usage metadata should exist').to.exist;
            expect(usageMetadata.promptTokenCount, 'Prompt tokens should be greater than 0').to.be.greaterThan(0);
            expect(usageMetadata.responseTokenCount, 'Response tokens should be greater than 0').to.be.greaterThan(0);
            expect(usageMetadata.totalTokenCount, 'Total tokens should be greater than 0').to.be.greaterThan(0);

            logDebug(`Token usage - Total: ${usageMetadata.totalTokenCount}, Prompt: ${usageMetadata.promptTokenCount}, Response: ${usageMetadata.responseTokenCount}`);

          } catch (error) {
            logDebug(`Gemini Live test failed with error: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
          } finally {
            // Close the session
            if (session) {
              session.close();
              logDebug('Gemini Live session closed');
            }
          }
        });

        it(`should successfully process realtime audio interactions via Gemini Live API with Google SDK`, async function () {
          let session: any = null;

          try {
            logDebug('Starting Gemini Live audio session...');

            // Set up event handlers
            let usageMetadata: any = null;
            let sessionEstablished = false;

            // Create a live session using the Google SDK with audio config
            session = await geminiLiveClient.live.connect({
              model: model,
              config: {
                responseModalities: [Modality.AUDIO],
                systemInstruction: "You are a helpful assistant and answer in a friendly tone."
              },
              callbacks: {
                onopen: () => {
                  logDebug('Gemini Live audio session opened');
                  sessionEstablished = true;
                },
                onmessage: (message) => {
                  logDebug(`Received message: size ${JSON.stringify(message).length}`);

                  if (message.usageMetadata) {
                    logDebug(`Message with usageMetadata: ${JSON.stringify(message)}`);
                    usageMetadata = message.usageMetadata;
                  }
                },
                onerror: (error) => {
                  logDebug(`Session error: ${JSON.stringify(error)}`);
                  throw error;
                },
                onclose: () => {
                  logDebug('Audio session closed by server');
                }
              }
            });

            // Wait for session to be established
            const sessionTimeout = 10000;
            const sessionStartTime = Date.now();
            while (!sessionEstablished) {
              if (Date.now() - sessionStartTime > sessionTimeout) {
                throw new Error('Timeout waiting for Gemini Live audio session to establish');
              }
              await wait(100); // eslint-disable-line no-restricted-syntax
            }

            logDebug('Gemini Live audio session connected');

            // Send audio data
            logDebug('Sending audio data to Gemini Live...');
            const audioPath = getDataFilePath('ai/test_pcm16_24khz.raw');
            const audioData = getBinaryFileContent(audioPath);
            const base64Audio = audioData.toString('base64');

            let offset = 0;
            let chunkCount = 0;
            const LIVE_API_SAMPLE_RATE = 24000; // 24kHz
            const AUDIO_CHUNK_SIZE = 4096; // A reasonable chunk size for streaming (in bytes)

            while (offset < base64Audio.length) {
              const end = Math.min(offset + AUDIO_CHUNK_SIZE, base64Audio.length);
              const chunk = base64Audio.slice(offset, end);

              session.sendRealtimeInput({
                audio: {
                  mimeType: `audio/pcm;rate=${LIVE_API_SAMPLE_RATE}`,
                  data: chunk,
                },
              });

              offset = end;
              chunkCount++;
              // Add a small delay to simulate real-time streaming
              await wait(5); // eslint-disable-line no-restricted-syntax
            }

            logDebug(`Finished sending ${chunkCount} chunks. Signaling end of turn.`);

            session.sendClientContent({
              turns: [{ role: 'user', parts: [{"text": "Describe the audio"}]}],
              turnComplete: true
            });

            // Wait for response with timeout
            const timeout = 30000;
            const startTime = Date.now();

            while (!usageMetadata) {
              if (Date.now() - startTime > timeout) {
                throw new Error('Timeout waiting for Gemini Live audio response');
              }
              await wait(500); // eslint-disable-line no-restricted-syntax
            }

            logDebug('Audio response received from Gemini Live');

            // Validate usage metadata
            expect(usageMetadata.promptTokenCount, 'Prompt tokens should be greater than 0').to.be.greaterThan(0);
            expect(usageMetadata.responseTokenCount, 'Response tokens should be greater than 0').to.be.greaterThan(0);
            expect(usageMetadata.totalTokenCount, 'Total tokens should be greater than 0').to.be.greaterThan(0);

            logDebug(`Audio token usage - Total: ${usageMetadata.totalTokenCount}, Prompt: ${usageMetadata.promptTokenCount}, Response: ${usageMetadata.responseTokenCount}`);

          } catch (error) {
            logDebug(`Gemini Live audio test failed with error: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
          } finally {
            // Close the session
            if (session) {
              session.close();
              logDebug('Gemini Live audio session closed');
            }
          }
        });

        it(`should successfully generate metrics`, async function () {
          let logs: any = null;
          const logsResp = await axios({
            method: 'get',
            url: `${proxyUrl}${logsCollectingPath}`,
          });
          logResponse(logsResp);
          logs = logsResp.data;
          expect(logs, 'Logs should be present').to.exist;
          expect(logs.proxy, `Logs should contain proxy information`).to.exist;
          expect(logs.proxy.meta, `Logs should contain meta information`).to.exist;
          expect(logs.proxy.usage, `Logs should contain usage information`).to.exist;
          expect(logs.proxy.meta.response_model, `Response model should be present`).to.equal(model);
          expect(logs.proxy.meta.request_model, `Request model should be present`).to.equal(model);
          expect(logs.proxy.meta.provider_name, `Provider should be present`).to.equal('gemini');
          expect(logs.proxy.meta.request_mode, `Request mode should be present`).to.equal('realtime');
          expect(logs.proxy.usage.time_to_first_token, `Time to first token should be present`).to.be.greaterThan(0);
          expect(logs.proxy.usage.time_per_token, `Time per token should be present`).to.be.greaterThanOrEqual(0);
          expect(logs.proxy.usage.input_tokens, `Input tokens should be present`).to.be.greaterThan(0);
          expect(logs.proxy.usage.input_tokens_details.text_tokens, `Input text tokens should be present`).to.be.greaterThan(0);
          expect(logs.proxy.usage.output_tokens, `Output tokens should be present`).to.be.greaterThanOrEqual(0);
          if (variant === 'gemini-vertex') {
            // It is said that Gemini model itself never actually processes the audio from the speech.
            // It uses Speech-to-Text or Text-to-Speech models to do conversion.
            // However, in Vertex AI, the audio output is counted as tokens.
            expect(logs.proxy.usage.output_tokens_details.audio_tokens, `Output audio tokens should be present for Gemini via Vertex`).to.be.greaterThan(0);
          }
          expect(logs.proxy.usage.cost, `Cost should be present for Gemini`).to.be.greaterThan(0);
        });

        after(async function () {
          await deletePlugin(pluginId);
        })
      });
    }

    after(async function () {
      await clearAllKongResources();
    });
  });
});
