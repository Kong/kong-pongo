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
  retryAIRequest,
  createAILogCollectingRoute,
  eventually,
} from '@support';
import _ from 'lodash';
import axios from 'axios';

// This test verifies the video generation functionality of the AI Proxy advanced plugin.
// Supports Azure OpenAI (Sora), OpenAI (Sora), Vertex AI (Veo), and Amazon Bedrock (Nova Reel) providers.
//
// Environment variables:
// - AZUREAI_REALTIME_API_KEY: Required for Azure OpenAI tests (always runs)
// - OPENAI_API_KEY: Required for OpenAI tests
// - OPENAI_VIDEO_API_ENABLED: Set to 'true' to enable OpenAI video tests (Sora API in limited preview)
// - VERTEX_API_KEY: Required for Vertex AI tests
// - AWS_ACCESS_KEY_ID: Required for Amazon Bedrock tests
// - AWS_SECRET_ACCESS_KEY: Required for Amazon Bedrock tests
// - AWS_REGION: AWS region for Bedrock (default: us-east-2)
//
// Test structure:
// - Uses parameterized test factory `createVideoGenerationTests()` to avoid code duplication
// - Azure OpenAI tests: Always run (default behavior)
// - OpenAI tests: Only run when OPENAI_VIDEO_API_ENABLED=true
// - Vertex AI tests: Always run (default behavior)
// - Amazon Bedrock tests: Always run (default behavior)
describe('@weekly @ai: Gateway Plugins: AI Proxy Video Generation Test', function () {
  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });
  const routePath = '/ai_proxy_video';
  const logsCollectingPath = '/ai/collect';
  const azure_instance = 'ai-gw-sdet-e2e-test2';
  const gcp_project_id = 'gcp-sdet-test';
  const gcp_location_id = 'us-central1';
  const bedrock_aws_region = 'us-east-1';

  // Feature flag for OpenAI video generation (Sora API is in limited preview)
  const OPENAI_VIDEO_ENABLED = process.env.OPENAI_VIDEO_API_ENABLED === 'true';

  // Video generation parameters - using minimal values to speed up tests
  // Using OpenAI standard format
  // Different providers may have different optimal parameters
  const AZURE_VIDEO_PARAMS = {
    modelName: 'sora',
    seconds: '5',
    size: '480x480',
  };

  const OPENAI_VIDEO_PARAMS = {
    modelName: 'sora-2',
    seconds: '4',
    size: '720x1280',
  };

  const VERTEX_VIDEO_PARAMS = {
    modelName: 'veo-2.0-generate-001',
    seconds: '5',
    size: '1280x720',
  };

  const VERTEX_VIDEO_PARAMS_GCS = {
    modelName: 'veo-2.0-generate-001',
    seconds: '5',
    size: '1280x720',
    extra_body: {
      parameters: {
        storageUri: 'gs://spdptest/kong-e2e-test-20251104',
      },
    },
  };

  const BEDROCK_VIDEO_PARAMS = {
    modelName: 'amazon.nova-reel-v1:0',
    seconds: '6',
    size: '1280x720',
  };

  // Polling configuration for video job completion
  const POLL_MAX_ATTEMPTS = 60; // Maximum polling attempts (60 * 3s = 3 minutes)
  const POLL_DELAY_MS = 3000; // 3 second delay between polls (video generation is slow)

  // Timeout configuration
  const READ_TIMEOUT_MS = 120000; // 2 minutes - video generation requests can take time

  let serviceId: string;

  // Provider-specific expectations interface
  interface ProviderExpectations {
    jobObjectType?: string;
    jobObjectTypes?: string[];
    supportsDownload?: boolean;
    isAsynchronous?: boolean;
    supportsPolling?: boolean; // Whether polling is supported through Kong gateway
    hasOutputsFieldOneOf?: Array<string>; // At least ONE of these fields must exist in outputs[0]
  }

  // Provider-specific expectations (documents behavioral differences)
  const PROVIDER_EXPECTATIONS: Record<string, ProviderExpectations> = {
    azure: { jobObjectType: 'video', supportsDownload: true },
    openai: { jobObjectType: 'video', supportsDownload: true },
    gemini: {
      jobObjectType: 'video.generation.job', // When outputs exist
      hasOutputsFieldOneOf: ['bytes_base64_encoded', 'gcs_uri'], // Either base64 or GCS URI
      supportsDownload: false, // Use inline or GCS URI instead
    },
    bedrock: {
      jobObjectType: 'video',
      supportsDownload: false, // Returns 400 with guidance
      isAsynchronous: true,
      supportsPolling: true,
      hasOutputsFieldOneOf: ['s3_uri'], // outputs: [{ type: "s3", s3_uri: "..." }]
    },
  };

  const pluginPayload = {
    config: {
      max_request_body_size: 99999,
      genai_category: 'video/generation',
      llm_format: 'openai',
      model_name_header: true,
      response_streaming: 'deny', // Video generation doesn't support streaming
      targets: [] as Array<Record<string, any>>,
      balancer: {
        algorithm: 'round-robin',
        latency_strategy: 'tpot',
        retries: 3,
        slots: 1000,
        hash_on_header: 'X-Kong-LLM-Request-ID',
        failover_criteria: ['error', 'timeout'],
        connect_timeout: 60000,
        read_timeout: READ_TIMEOUT_MS,
        write_timeout: 60000,
      },
    },
    service: { id: '' },
    name: 'ai-proxy-advanced',
  };

  /**
   * Validates binary video content
   * @param videoData - The binary video data
   * @param minSizeBytes - Minimum expected size (default: 1000)
   * @returns The size of the video data in bytes
   */
  function validateBinaryVideo(videoData: any, minSizeBytes = 1000): number {
    expect(videoData, 'Response should contain video data').to.exist;
    expect(videoData.length, 'Video should have content').to.be.greaterThan(minSizeBytes);
    return videoData.length;
  }

  /**
   * Checks if job status indicates in-progress state
   */
  function isInProgressStatus(status: string): boolean {
    return ['queued', 'in_progress'].includes(status);
  }

  /**
   * Sends a video generation request to the specified endpoint using OpenAI standard format
   * @param url - The endpoint URL
   * @param prompt - The video generation prompt
   * @param modelName - The model name to use (e.g., 'sora', 'sora-2')
   * @param videoParams - Video parameters (seconds, size, and extra_body), optional
   */
  async function sendVideoGenerationRequest(
    url: string,
    prompt: string,
    modelName: string,
    videoParams?: { seconds?: string; size?: string; extra_body?: any },
  ) {
    const data: any = {
      prompt: prompt,
      model: modelName,
    };

    // Add optional parameters if provided
    if (videoParams?.seconds) {
      data.seconds = videoParams.seconds;
    }
    if (videoParams?.size) {
      data.size = videoParams.size;
    }
    // Add extra_body for advanced parameters (e.g., GCS storageUri)
    if (videoParams?.extra_body) {
      data.extra_body = videoParams.extra_body;
    }

    const resp = await axios({
      method: 'post',
      url: url,
      data: data,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, video/*', // Accept both JSON (job) and binary video
      },
      responseType: 'arraybuffer', // Handle both JSON and binary responses
      validateStatus: null,
    });

    // Parse response based on Content-Type
    const contentType = resp.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      // Parse JSON response for job-based providers
      const textData = Buffer.from(resp.data).toString('utf-8');
      resp.data = JSON.parse(textData);
    }
    // Otherwise keep resp.data as binary (for video/* content-type)

    return resp;
  }

  /**
   * Polls a video job until it reaches a terminal state (completed or failed)
   * @param jobId The ID of the video generation job
   * @param maxAttempts Maximum number of polling attempts
   * @param delayMs Delay between polling attempts in milliseconds
   */
  async function pollVideoJob(jobId: string, maxAttempts = 30, delayMs = 2000) {
    const job = await eventually(
      async () => {
        const resp = await axios({
          method: 'get',
          url: `${proxyUrl}${routePath}/${jobId}`,
          headers: {
            Accept: 'application/json',
          },
          validateStatus: null,
        });

        if (resp.status !== 200) {
          logDebug(`Polling request failed for job ${jobId}: ${resp.status} - ${JSON.stringify(resp.data)}`);
          throw new Error(`Polling request failed with status ${resp.status}`);
        }

        const status = resp.data.status;
        logDebug(`Job ${jobId} status: ${status}`);

        // Check terminal states (OpenAI standard: completed | failed | canceled)
        if (status === 'completed') {
          return resp.data; // Job completed successfully
        }

        if (status === 'failed' || status === 'canceled') {
          const reason = resp.data.error?.message || resp.data.failure_reason || 'unknown';
          throw new Error(`Job ${status}: ${reason}`);
        }

        // Non-terminal states (queued, in_progress) - continue polling
        if (isInProgressStatus(status)) {
          throw new Error('RETRY_POLLING'); // Triggers retry in eventually()
        }

        // Unknown status - log and retry
        logDebug(`Unknown job status: ${status}, will retry`);
        throw new Error('RETRY_POLLING');
      },
      maxAttempts * delayMs,
      delayMs,
    );

    return job;
  }

  /**
   * Validates the initial response from a video generation request
   * Handles both synchronous (binary video) and asynchronous (job-based) responses
   * @param resp The response from the video generation request
   * @param provider The provider name for logging purposes
   * @param modelName The expected model name in the response
   * @returns Object with jobId (for async) or isSynchronous flag (for sync binary)
   */
  function validateVideoGenerationInitialResponse(resp: any, provider: string, modelName: string) {
    // Use consistent expect assertions for all status code validation
    expect(resp.status, `Response status from ${provider} should be 200 or 201`).to.be.oneOf([200, 201]);

    // Log model information if available
    if (resp.headers['x-kong-llm-model']) {
      logDebug(`Model used: ${resp.headers['x-kong-llm-model']}`);
    }

    // Check if response is binary video (synchronous mode)
    const contentType = resp.headers['content-type'] || '';
    if (contentType.startsWith('video/')) {
      logDebug(`Detected synchronous binary video response from ${provider}`);

      // Validate binary content
      validateBinaryVideo(resp.data);

      return { isSynchronous: true, videoData: resp.data };
    }

    // Otherwise, assume JSON job-based response (asynchronous mode - OpenAI/Azure/Gemini)
    logDebug(`Detected asynchronous job-based response from ${provider}`);

    // Validate job response structure (OpenAI standard format)
    expect(resp.data, `Response should have data`).to.exist;
    // Accept both 'video' (Azure/OpenAI) and 'video.generation.job' (Gemini with outputs)
    expect(resp.data.object, `Response should have object field`).to.be.oneOf(['video', 'video.generation.job']);
    expect(resp.data.id, `Response should have job ID`).to.be.a('string').and.not.empty;
    expect(resp.data.status, `Response should have status`).to.be.a('string');
    // OpenAI standard status values: queued | in_progress | failed | completed | canceled
    expect(resp.data.status, `Initial status should be queued or in_progress`).to.be.oneOf(['queued', 'in_progress']);
    expect(resp.data.created_at, `Response should have created_at`).to.be.a('number');
    expect(resp.data.model, `Response should have model`).to.equal(modelName);

    return { isSynchronous: false, jobId: resp.data.id };
  }

  /**
   * Validates a completed video job (OpenAI standard format)
   * @param job The completed job object
   */
  function validateCompletedVideoJob(job: any) {
    // Accept multiple object types for different providers
    const validObjectTypes = ['video', 'video.generation.job'];
    expect(validObjectTypes, `Job object should be one of the valid types`).to.include(job.object);
    // OpenAI standard terminal status: completed
    expect(job.status, `Job status should be completed`).to.equal('completed');

    // OpenAI format - job ID itself represents the video
    logDebug(`Video job completed: ${job.id}`);

    return job;
  }

  async function validateLogsMetrics(provider: string, model: string) {
    const logsResp = await axios({
      method: 'get',
      url: `${proxyUrl}${logsCollectingPath}`,
    });

    logResponse(logsResp);
    expect(logsResp.status, `Logs response should be 200`).to.equal(200);
    const logs = logsResp.data;
    expect(logs.proxy, `Logs should contain proxy information for ${provider}`).to.exist;
    expect(logs.proxy.meta, `Logs should contain meta information for ${provider}`).to.exist;
    expect(logs.proxy.usage, `Logs should contain usage information for ${provider}`).to.exist;
    expect(logs.proxy.meta.response_model, `Response model should be present for ${provider}`).to.equal(model);
    expect(logs.proxy.meta.request_model, `Request model should be present for ${provider}`).to.equal(model);
    expect(logs.proxy.meta.provider_name, `Provider should be present for ${provider}`).to.equal(provider);
    expect(logs.proxy.meta.request_mode, `Request mode should be present for ${provider}`).to.equal('oneshot');
    expect(logs.proxy.meta.llm_latency, `LLM latency should be present for ${provider}`).to.be.greaterThan(0);
    expect(logs.proxy.tried_targets, `Tried targets should be present for ${provider}`).to.be.an('object');
  }

  // Target configurations for video generation
  const target_azure_video = {
    description: 'azure video generation',
    route_type: 'video/v1/videos/generations',
    logging: {
      log_statistics: true,
      log_payloads: false,
    },
    weight: 100,
    auth: {
      header_name: 'api-key',
      header_value: vars.ai_providers.AZUREAI_REALTIME_API_KEY,
    },
    model: {
      name: AZURE_VIDEO_PARAMS.modelName,
      provider: 'azure',
      options: {
        azure_instance: azure_instance,
        azure_deployment_id: AZURE_VIDEO_PARAMS.modelName,
        azure_api_version: 'preview',
      },
    },
  };

  const target_openai_video = {
    description: 'openai video generation',
    route_type: 'video/v1/videos/generations',
    logging: {
      log_statistics: true,
      log_payloads: false,
    },
    weight: 100,
    auth: {
      header_name: 'Authorization',
      header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
    },
    model: {
      name: OPENAI_VIDEO_PARAMS.modelName,
      provider: 'openai',
    },
  };

  const target_vertex_video = {
    description: 'vertex ai video generation',
    route_type: 'video/v1/videos/generations',
    logging: {
      log_statistics: true,
      log_payloads: false,
    },
    weight: 100,
    auth: {
      gcp_use_service_account: true,
      gcp_service_account_json: vars.ai_providers.VERTEX_API_KEY,
    },
    model: {
      name: VERTEX_VIDEO_PARAMS.modelName,
      provider: 'gemini',
      options: {
        gemini: {
          api_endpoint: `${gcp_location_id}-aiplatform.googleapis.com`,
          project_id: gcp_project_id,
          location_id: gcp_location_id,
        },
      },
    },
  };

  const target_bedrock_video = {
    description: 'bedrock video generation',
    route_type: 'video/v1/videos/generations',
    logging: {
      log_statistics: true,
      log_payloads: false,
    },
    weight: 100,
    auth: {
      aws_access_key_id: vars.aws.AWS_ACCESS_KEY_ID,
      aws_secret_access_key: vars.aws.AWS_SECRET_ACCESS_KEY,
    },
    model: {
      name: BEDROCK_VIDEO_PARAMS.modelName,
      provider: 'bedrock',
      options: {
        bedrock: {
          aws_region: bedrock_aws_region,
          video_output_s3_uri: 's3://aigw-e2e-test-us-east-2/bedrock-videos/',
        },
      },
    },
  };

  before(async function () {
    // Create a service and route for use with plugin
    const service = await createGatewayService('ai-video-test-service');
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [routePath]);
    await createAILogCollectingRoute(`ai-log-video-service`, route.id, `${logsCollectingPath}`);
    await waitForConfigRebuild();
  });

  /**
   * Parameterized test suite factory for video generation
   * Reusable for Azure OpenAI, OpenAI, and Vertex AI (Gemini) providers
   * @param provider - The AI provider ('azure', 'openai', or 'gemini')
   * @param target - The target configuration object
   * @param videoParams - Video generation parameters
   */
  function createVideoGenerationTests(
    provider: 'azure' | 'openai' | 'gemini' | 'bedrock',
    target: any,
    videoParams: { modelName: string; seconds: string; size: string; extra_body?: any },
  ) {
    // Read provider expectations configuration
    const expectations = PROVIDER_EXPECTATIONS[provider];

    describe(`${provider.toUpperCase()} Video Generation`, function () {
      let providerPluginId: string;

      before(async function () {
        // Create plugin once for all parameter configurations
        const videoPayload = _.cloneDeep(pluginPayload);
        videoPayload.service.id = serviceId;
        videoPayload.config.targets = [target];

        const resp = await axios({
          method: 'post',
          url: `${adminUrl}/services/${serviceId}/plugins`,
          data: videoPayload,
          validateStatus: null,
        });

        providerPluginId = resp.data.id;
        logResponse(resp);

        expect(resp.status, 'Status should be 201').to.equal(201);
        expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');
        expect(resp.data.config.genai_category, 'Should have video generation category').to.equal('video/generation');

        await waitForConfigRebuild();
      });

      // Create tests for the given parameter configuration
      createTestsForParams(videoParams);

      after(async function () {
        // Clean up the plugin
        if (providerPluginId) {
          await deletePlugin(providerPluginId);
          await waitForConfigRebuild();
        }
      });

      // Helper function to create tests for a specific parameter configuration
      function createTestsForParams(videoParams: {
        modelName: string;
        seconds: string;
        size: string;
        extra_body?: any;
      }) {
        it(`should send video generation request to ${provider} and receive response`, async function () {
          const prompt = 'A calico cat playing a piano on stage';

          const makeRequest = () =>
            sendVideoGenerationRequest(`${proxyUrl}${routePath}`, prompt, videoParams.modelName, {
              seconds: videoParams.seconds,
              size: videoParams.size,
              extra_body: videoParams.extra_body,
            });

          const resp = await retryAIRequest(
            makeRequest,
            response => {
              const result = validateVideoGenerationInitialResponse(response, provider, videoParams.modelName);
              return { ...response, ...result };
            },
            provider,
          );

          expect(resp, 'Should receive response from video generation request').to.exist;
          expect(resp.status, 'Video generation request should return 2xx').to.be.oneOf([200, 201]);

          if (resp.isSynchronous) {
            // Synchronous response - video received immediately
            const videoSize = validateBinaryVideo(resp.videoData);
            logDebug(`${provider} returned video synchronously, size: ${videoSize} bytes`);
            (this as any).isSynchronous = true;
            (this as any).videoData = resp.videoData;
          } else {
            // Asynchronous response (OpenAI/Azure/Gemini) - job ID received
            expect(resp.jobId, 'Response should contain job ID').to.be.a('string').and.not.empty;
            (this as any).isSynchronous = false;
            (this as any).jobId = resp.jobId;
          }
        });

        it('should poll video job until completion', async function () {
          // Skip polling for synchronous responses (video already received)
          if ((this as any).isSynchronous) {
            logDebug('Skipping job polling for synchronous video response');
            this.skip();
          }

          // Skip polling if provider doesn't support it through Kong gateway
          if (expectations.supportsPolling === false) {
            logDebug(`Skipping job polling for ${provider} - polling not supported through Kong gateway`);
            this.skip();
          }

          const jobId = (this as any).jobId;
          expect(jobId, 'Job ID from previous test should be available').to.be.a('string').and.not.empty;

          // Poll the job until completion
          const completedJob = await pollVideoJob(jobId, POLL_MAX_ATTEMPTS, POLL_DELAY_MS);

          // Validate the completed job
          validateCompletedVideoJob(completedJob);

          // Store completed job for logs validation
          (this as any).completedJob = completedJob;
        });

        it(`should validate logs and metrics for ${provider} video generation`, async function () {
          await validateLogsMetrics(provider, videoParams.modelName);
        });

        it('should download generated video content via OpenAI SDK format', async function () {
          // Skip download for synchronous responses (video already received in initial response)
          if ((this as any).isSynchronous) {
            logDebug('Skipping video download for synchronous response - video already received');
            const videoData = (this as any).videoData;
            const videoSize = validateBinaryVideo(videoData);
            logDebug(`Synchronous video size: ${videoSize} bytes`);
            return;
          }

          // Skip download if polling not supported (no completedJob available)
          if (expectations.supportsPolling === false) {
            logDebug(`Skipping video download for ${provider} - polling not supported, use response_url directly`);
            this.skip();
          }

          // Skip download if provider doesn't support /content endpoint
          if (expectations.supportsDownload === false) {
            logDebug(`Skipping video download for ${provider} - validating output format instead`);
            const completedJob = (this as any).completedJob;

            // Validate provider-specific output fields (at least one field must exist)
            if (expectations.hasOutputsFieldOneOf) {
              logDebug(`${provider}: validating output fields (at least one of: ${expectations.hasOutputsFieldOneOf.join(', ')})`);

              const hasAtLeastOneField = expectations.hasOutputsFieldOneOf.some(field => {
                const fieldValue = completedJob.outputs[0]?.[field];
                return fieldValue !== undefined && fieldValue !== null && fieldValue !== '';
              });

              expect(hasAtLeastOneField,
                `Outputs[0] should have at least one of: ${expectations.hasOutputsFieldOneOf.join(', ')}`
              ).to.be.true;

              logDebug(`${provider}: video output validated successfully`);
            }
            this.skip();
          }

          const completedJob = (this as any).completedJob;
          expect(completedJob, 'Completed job from previous test should be available').to.exist;
          logDebug(`Attempting to download video with job ID: ${completedJob.id}`);

          if (expectations.hasOutputsFieldOneOf) {
            // Validate at least one of the expected output fields exists
            logDebug(`${provider}: detecting output format (at least one of: ${expectations.hasOutputsFieldOneOf.join(', ')})`);

            const hasAtLeastOneField = expectations.hasOutputsFieldOneOf.some(field => {
              const fieldValue = completedJob.outputs[0]?.[field];
              return fieldValue !== undefined && fieldValue !== null && fieldValue !== '';
            });

            expect(hasAtLeastOneField,
              `Outputs[0] should have at least one of: ${expectations.hasOutputsFieldOneOf.join(', ')}`
            ).to.be.true;
          }

          if (expectations.supportsDownload) {
            // Azure/OpenAI: use GET /content
            logDebug(`${provider}: using GET /content for download`);
            const resp = await axios({
              method: 'get',
              url: `${proxyUrl}${routePath}/${completedJob.id}/content`,
              responseType: 'arraybuffer',
              headers: {
                Accept: 'video/*',
              },
              validateStatus: null,
            });

            logDebug(`Download response status: ${resp.status}`);
            logDebug(`Download response headers: ${JSON.stringify(resp.headers)}`);

            expect(resp.status, 'Download should return 200').to.equal(200);
            expect(resp.headers['content-type'], 'Should have video content-type').to.match(/video\//);
            expect(resp.data.length, 'Video should have actual size').to.be.greaterThan(1000);

            logDebug(`Video downloaded successfully via /content, size: ${resp.data.length} bytes`);
            return;
          }

          // If no download method matches, fail the test
          throw new Error(`No download method configured for provider: ${provider}`);
        });

        it('should use default values when seconds and size are not provided', async function () {
          // For Azure: missing seconds/size should use defaults (4 seconds, 720x1280)
          // For OpenAI: these parameters are optional with defaults
          const minimalPayload = {
            prompt: 'A cat playing piano',
            model: videoParams.modelName,
            // No seconds or size - should use defaults
          };

          const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${routePath}`,
            data: minimalPayload,
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            validateStatus: null,
          });

          logResponse(resp);
          // Should succeed with default values
          expect(resp.status, 'Should accept request with default values').to.be.oneOf([200, 201]);
          expect(resp.data.id, 'Should have job ID').to.be.a('string').and.not.empty;
        });

        it('should handle invalid size format', async function () {
          // Invalid size format should return error
          const invalidPayload = {
            prompt: 'test prompt',
            model: videoParams.modelName,
            seconds: videoParams.seconds,
            size: 'invalid-format', // Not in "WIDTHxHEIGHT" format
          };

          const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${routePath}`,
            data: invalidPayload,
            headers: {
              'Content-Type': 'application/json',
            },
            validateStatus: null,
          });

          logResponse(resp);
          expect(resp.status, 'Should return 400 for invalid size format').to.equal(400);
          expect(resp.data.error, 'Should have error information').to.exist;
        });

        it('should handle authentication failures correctly', async function () {
          // Update plugin with invalid auth - provider-specific
          const invalidAuthPayload = _.cloneDeep(pluginPayload);
          invalidAuthPayload.service.id = serviceId;

          // Create invalid auth based on provider's actual auth mechanism
          let invalidAuth: Record<string, any>;
          switch (provider) {
            case 'azure':
              invalidAuth = {
                header_name: 'api-key',
                header_value: 'invalid-key-12345',
              };
              break;
            case 'openai':
              invalidAuth = {
                header_name: 'Authorization',
                header_value: 'Bearer invalid-key-12345',
              };
              break;
            case 'gemini':
              // Use API key auth instead of service account to avoid local SDK validation
              // Invalid API key will be sent to Google, which will return 401/403
              invalidAuth = {
                header_name: 'x-goog-api-key',
                header_value: 'invalid-api-key-12345',
              };
              break;
            case 'bedrock':
              invalidAuth = {
                aws_access_key_id: 'AKIAINVALIDACCESSKEY',
                aws_secret_access_key: 'invalid/secret/access/key/1234567890',
              };
              break;
            default:
              invalidAuth = {
                header_name: 'Authorization',
                header_value: 'invalid-key-12345',
              };
          }

          invalidAuthPayload.config.targets = [
            {
              ...target,
              auth: invalidAuth,
            },
          ];

          const updateResp = await axios({
            method: 'patch',
            url: `${adminUrl}/services/${serviceId}/plugins/${providerPluginId}`,
            data: invalidAuthPayload,
            validateStatus: null,
          });

          expect(updateResp.status, 'Plugin update should succeed').to.equal(200);
          await waitForConfigRebuild();

          // Try to make a request with invalid auth
          const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${routePath}`,
            data: {
              prompt: 'test prompt',
              model: videoParams.modelName,
            },
            headers: {
              'Content-Type': 'application/json',
            },
            validateStatus: null,
          });

          logResponse(resp);
          expect(resp.status, 'Should return 401 or 403 for invalid auth').to.be.oneOf([401, 403]);
        });
      }
    });
  }

  // Run tests for Azure OpenAI with Azure-specific parameters
  createVideoGenerationTests('azure', target_azure_video, AZURE_VIDEO_PARAMS);

  // Run tests for OpenAI only if feature flag is enabled, with OpenAI-specific parameters
  if (OPENAI_VIDEO_ENABLED) {
    createVideoGenerationTests('openai', target_openai_video, OPENAI_VIDEO_PARAMS);
  } else {
    console.warn(
      'Skipping OpenAI video tests: OPENAI_VIDEO_API_ENABLED is not set to "true", as the API is in limited preview.',
    );
  }

  // Run tests for Vertex AI Veo with standard output
  createVideoGenerationTests('gemini', target_vertex_video, VERTEX_VIDEO_PARAMS);
  // Run tests for Vertex AI Veo with GCS storage output
  createVideoGenerationTests('gemini', target_vertex_video, VERTEX_VIDEO_PARAMS_GCS);

  // Run tests for Bedrock
  createVideoGenerationTests('bedrock', target_bedrock_video, BEDROCK_VIDEO_PARAMS);

  after(async function () {
    await clearAllKongResources();
  });
});
