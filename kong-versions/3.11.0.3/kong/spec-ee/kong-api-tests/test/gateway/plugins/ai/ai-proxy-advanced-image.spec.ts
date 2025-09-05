import {
  expect,
  createGatewayService,
  createRouteForService,
  clearAllKongResources,
  getBasePath,
  getDataFilePath,
  isGateway,
  Environment,
  logResponse,
  waitForConfigRebuild,
  vars,
  logDebug,
  retryAIRequest,
  createAILogCollectingRoute,
} from '@support'
import _ from 'lodash';
import FormData from 'form-data';
import axios from 'axios';
import * as fs from 'fs';

// This test verify the image generation and edit functionality of the AI Proxy advanced plugin with Openai llm format.
describe('@weekly @ai: Gateway Plugins: AI Proxy Image Generation and Edit Test', function () {
  const aws_region_image = 'us-east-1';
  const imagePath = getDataFilePath('ai/image_edit.png');
  const maskPath = getDataFilePath('ai/mask.png');
  const image_gen_prompt = '10x10 pixel simple horse, minimal detail, minimal color.';
  const image_edit_prompt = 'Fill the inside of the circle with blue, leave the rest unchanged.';

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })
  const routePath = '/ai_proxy_image';
  const logsCollectingPath = '/ai/collect';

  let serviceId: string;
  let pluginId: string;

  const pluginPayload = {
    config: {
      max_request_body_size: 99999,
      genai_category: "image/generation",
      llm_format: 'openai', //using openai format for image gen and edit
      model_name_header: true,
      response_streaming: 'allow',
      targets: [] as Array<Record<string, any>>,
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
        write_timeout: 60000
      }
    },
    service: { id: '' },
    name: 'ai-proxy-advanced'
  };

  /**
  * Sends an image generation request to the specified endpoint
  */
  async function sendImageGenerationRequest(url: string, prompt: string) {
    const resp = await axios({
      method: 'post',
      url: url,
      data: {
        prompt: prompt,
        response_format: "b64_json"
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*'
      },
      validateStatus: null
    });

    return resp;
  }

  /**
  * Sends an image edit request to the specified endpoint
  */
  async function sendImageEditRequest(url: string, prompt: string) {
    const formData = new FormData();

    // Add text fields
    formData.append('prompt', prompt);
    formData.append('response_format', 'b64_json');
    formData.append('n', '1');
    formData.append('size', '1024x1024');

    // Add image and mask files as streams with filenames
    formData.append('image', fs.createReadStream(imagePath), 'image_edit.png');
    formData.append('mask', fs.createReadStream(maskPath), 'mask.png');

    // Send with multipart/form-data content type (from FormData)
    const resp = await axios({
      method: 'post',
      url: url,
      data: formData,
      headers: {
        ...formData.getHeaders(), // This sets the correct content-type with boundary
        Accept: "application/json",
      },
      validateStatus: null
    });

    return resp;
  }

  /**
  * Validates the response from an image generation request
  * @param resp The response from the image generation request
  * @param provider The provider name for logging purposes
  * @returns The validated image data and buffer
  */
  function validateImageGenerationResponse(resp: any, provider = 'unknown') {
    if (resp.status === 429 || resp.status === 529) {
      console.error(`Rate limit exceeded for ${provider} provider`);
      return;
    }
    if (resp.status === 400) {
      if (provider === 'gemini') {
        // Gemini may return 400 for unsupported locations, don't fail the test
        const errorData = Array.isArray(resp.data) ? resp.data[0].error : resp.data.error;
        expect(errorData).to.have.property('message');
        expect(errorData.message).to.include('location is not supported');
        return;
      }
      expect.fail(`Unexpected 400 response from ${provider}: ${resp.data.error.message}`);
    }
    expect(resp.status, `Response status from ${provider} should be 200`).to.equal(200);

    // Log model information if available
    if (resp.headers['x-kong-llm-model']) {
      logDebug(`Model used: ${resp.headers['x-kong-llm-model']}`);
    }
    // Log total tokens
    if (resp.data.usage && resp.data.usage.output_tokens) {
      logDebug(`Output tokens: ${resp.data.usage.output_tokens}`);
      expect(resp.data.usage.output_tokens).to.be.greaterThan(1);
    }
    // Log image tokens
    if (resp.data.usage && resp.data.usage.input_tokens_details) {
      logDebug(`Image tokens: ${resp.data.usage.input_tokens_details.image_tokens}`);
      expect(resp.data.usage.input_tokens_details.image_tokens).to.be.greaterThan(1);
    }
    // Find image data in the response
    const imagePart = (resp.data.data || []).find(
      (item: any) => typeof item.b64_json === 'string' && item.b64_json.length > 0
    );

    // Validate image data
    expect(imagePart, `Response from ${provider} should contain at least one image part with b64_json`).to.exist;
    const base64Image = imagePart.b64_json;
    expect(base64Image, `Image data from ${provider} should be a non-empty string`).to.be.a('string').and.not.empty;

    // Validate we can convert to a buffer
    let imageBuffer;
    expect(() => {
      imageBuffer = Buffer.from(base64Image, 'base64');
    }, `Image from ${provider} should be valid base64`).to.not.throw();
    expect(imageBuffer.length, `Image buffer from ${provider} should have data`).to.be.greaterThan(0);

    return { imageBuffer, base64Image };
  }

  /**
  * Validates the response from an image edit request
  * @param resp The response from the image edit request
  * @param provider The provider name for logging purposes
  * @returns The validated image data and buffer
  */
  function validateImageEditResponse(resp: any, provider = 'unknown') {
    if (resp.status === 429 || resp.status === 529) {
      console.error(`Rate limit exceeded for ${provider} provider`);
      return;
    }
    if (resp.status === 400) {
      if (provider === 'gemini') {
        // Gemini may return 400 for unsupported locations, don't fail the test
        const errorData = Array.isArray(resp.data) ? resp.data[0].error : resp.data.error;
        expect(errorData).to.have.property('message');
        expect(errorData.message).to.include('location is not supported');
        return;
      }
      expect.fail(`Unexpected 400 response from ${provider}: ${resp.data.error.message}`);
    }
    expect(resp.status, `Response status from ${provider} should be 200`).to.equal(200);

    // Log model information if available
    if (resp.headers['x-kong-llm-model']) {
      console.log(`Model used: ${resp.headers['x-kong-llm-model']}`);
    }
    // Log total tokens
    if (resp.data.usage && resp.data.usage.output_tokens) {
      logDebug(`Output tokens: ${resp.data.usage.output_tokens}`);
      expect(resp.data.usage.output_tokens).to.be.greaterThan(1);
    }
    // Log image tokens
    if (resp.data.usage && resp.data.usage.input_tokens_details) {
      logDebug(`Image tokens: ${resp.data.usage.input_tokens_details.image_tokens}`);
      expect(resp.data.usage.input_tokens_details.image_tokens).to.be.greaterThan(1);
    }
    // Find image data in the response
    const imagePart = (resp.data.data || []).find(
      (item: any) => typeof item.b64_json === 'string' && item.b64_json.length > 0
    );

    // Validate image data
    expect(imagePart, `Response from ${provider} should contain at least one image part with b64_json`).to.exist;
    const base64Image = imagePart.b64_json;
    expect(base64Image, `Image data from ${provider} should be a non-empty string`).to.be.a('string').and.not.empty;

    // Validate we can convert to a buffer
    let imageBuffer;
    expect(() => {
      imageBuffer = Buffer.from(base64Image, 'base64');
    }, `Image from ${provider} should be valid base64`).to.not.throw();
    expect(imageBuffer.length, `Image buffer from ${provider} should have data`).to.be.greaterThan(0);

    return { imageBuffer, base64Image };
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
    expect(logs.proxy.usage.time_to_first_token, `Time to first token should be present for ${provider}`).to.be.greaterThan(0);
    expect(logs.proxy.usage.time_per_token, `Time per token should be present for ${provider}`).to.be.greaterThanOrEqual(0);
    expect(logs.proxy.usage.input_tokens, `Input tokens should be present for ${provider}`).to.be.greaterThan(0);
    expect(logs.proxy.usage.total_tokens, `Total tokens should be present for ${provider}`).to.be.greaterThan(0);
    expect(logs.proxy.usage.output_tokens, `Output tokens should be present for ${provider}`).to.be.greaterThanOrEqual(0);
    expect(logs.proxy.usage.cost, `Cost should be present for ${provider}`).to.be.greaterThan(0);
    expect(logs.proxy.tried_targets, `Tried targets should be present for ${provider}`).to.be.an('object');
  }


  // Create a factory function for generating target configurations
  function createImageTarget(provider: 'gemini' | 'vertex' | 'bedrock' | 'openai', operation: 'generation' | 'edit') {
    // Common base configuration structure
    const baseConfig: Record<string, any> = {
      logging: {
        log_statistics: provider === 'bedrock' ? false : true,
        log_payloads: false
      },
      weight: 100
    };

    // Define operation-specific settings
    const operationConfig = {
      description: `${provider} image ${operation}`,
      route_type: operation === 'generation'
        ? "image/v1/images/generations"
        : "image/v1/images/edits"
    };

    // Provider-specific configurations
    const providerConfigs = {
      openai: {
        auth: {
          header_name: "Authorization",
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        model: {
          name: "dall-e-2",
          options: {
            input_cost: 100,
            output_cost: 100,
          },
          provider: "openai"
        }
      },
      gemini: {
        auth: {
          param_location: "query",
          allow_override: false,
          param_value: `${vars.ai_providers.GEMINI_API_KEY}`,
          gcp_use_service_account: false,
          azure_client_secret: null,
          azure_use_managed_identity: false,
          param_name: "key",
        },
        model: {
          name: "gemini-2.0-flash-preview-image-generation",
          options: {
            input_cost: 100,
            output_cost: 100,
          },
          provider: "gemini"
        }
      },
      vertex: {
        auth: {
          allow_override: false,
          gcp_use_service_account: true,
          gcp_service_account_json: `${vars.ai_providers.VERTEX_API_KEY}`
        },
        model: {
          name: "gemini-2.0-flash-preview-image-generation",
          options: {
            input_cost: 100,
            output_cost: 100,
            gemini: {
              location_id: "us-central1",
              api_endpoint: "us-central1-aiplatform.googleapis.com",
              project_id: "gcp-sdet-test"
            }
          },
          provider: "gemini"
        }
      },
      bedrock: {
        auth: {
          allow_override: false,
          aws_access_key_id: `${vars.aws.AWS_ACCESS_KEY_ID}`,
          aws_secret_access_key: `${vars.aws.AWS_SECRET_ACCESS_KEY}`
        },
        model: {
          name: "amazon.titan-image-generator-v1",
          options: {
            bedrock: {
              aws_region: aws_region_image
            }
          },
          provider: "bedrock"
        }
      }
    };

    // Combine configurations
    return {
      ...baseConfig,
      ...operationConfig,
      ...providerConfigs[provider]
    };
  }

  const target_openai_generation = createImageTarget('openai', 'generation');
  const target_openai_edit = createImageTarget('openai', 'edit');
  const target_gemini_generation = createImageTarget('gemini', 'generation');
  const target_gemini_edit = createImageTarget('gemini', 'edit');
  const target_vertex_generation = createImageTarget('vertex', 'generation');
  const target_vertex_edit = createImageTarget('vertex', 'edit');
  const target_bedrock_generation = createImageTarget('bedrock', 'generation');
  const target_bedrock_edit = createImageTarget('bedrock', 'edit');

  before(async function () {
    //create a service and route for use with plugin
    const service = await createGatewayService('ai-image-test-service');
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [routePath]);
    await createAILogCollectingRoute(`ai-log-service`, route.id, `${logsCollectingPath}`);
    await waitForConfigRebuild();
  })

  it('should create AI proxy advanced plugin with openai image generation', async function () {
    const geminiImagePayload = _.cloneDeep(pluginPayload);
    geminiImagePayload.service.id = serviceId;
    geminiImagePayload.config.targets = [target_openai_generation];

    const resp = await axios({
      method: 'post',
      url: `${adminUrl}/services/${serviceId}/plugins`,
      data: geminiImagePayload,
      validateStatus: null
    });

    pluginId = resp.data.id;
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  it('should be able to send prompt to openai image generation model via route and to generate image', async function () {
    const makeRequest = () => sendImageGenerationRequest(
      `${proxyUrl}${routePath}`, 
      image_gen_prompt
    );
    
    await retryAIRequest(
      makeRequest,
      (resp) => validateImageGenerationResponse(resp, 'openai'),
      'openai'
    );
  });

  it('should be able to collect logs for openai image generation', async () => (await validateLogsMetrics("openai", "dall-e-2")));

  it('should patch update AI proxy advanced plugin with openai image edit', async function () {
    const geminiImagePayload = _.cloneDeep(pluginPayload);
    geminiImagePayload.service.id = serviceId;
    geminiImagePayload.config.targets = [target_openai_edit];

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: geminiImagePayload,
      validateStatus: null
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  it('should be able to send prompt to openai image model via route and to edit image', async function () {
    const makeRequest = () => sendImageEditRequest(
      `${proxyUrl}${routePath}/images/edits`, 
      image_edit_prompt
    );
    
    await retryAIRequest(
      makeRequest,
      (resp) => validateImageEditResponse(resp, 'openai'),
      'openai'
    );
  });

  it('should be able to collect logs for openai image edit', async () => (await validateLogsMetrics("openai", "dall-e-2")));

  it('should patch update AI proxy advanced plugin with google gemini image generation', async function () {
    const geminiImagePayload = _.cloneDeep(pluginPayload);
    geminiImagePayload.service.id = serviceId;
    geminiImagePayload.config.targets = [target_gemini_generation];

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: geminiImagePayload,
      validateStatus: null
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  it('should be able to send prompt to gemini image generation model via route and to generate image', async function () {
    const makeRequest = () => sendImageGenerationRequest(
      `${proxyUrl}${routePath}`, 
      image_gen_prompt
    );
    
    await retryAIRequest(
      makeRequest,
      (resp) => validateImageGenerationResponse(resp, 'gemini'),
      'gemini'
    );
  });

  it('should be able to collect logs for gemini image generation', async () => (await validateLogsMetrics("gemini", "gemini-2.0-flash-preview-image-generation")));

  it('should patch update AI proxy advanced plugin with google gemini image edit', async function () {
    const geminiImagePayload = _.cloneDeep(pluginPayload);
    geminiImagePayload.service.id = serviceId;
    geminiImagePayload.config.targets = [target_gemini_edit];

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: geminiImagePayload,
      validateStatus: null
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  it('should be able to send prompt to gemini image model via route and to edit image', async function () {
    const makeRequest = () => sendImageEditRequest(
      `${proxyUrl}${routePath}/images/edits`, 
      image_edit_prompt
    );
    
    await retryAIRequest(
      makeRequest,
      (resp) => validateImageEditResponse(resp, 'gemini'),
      'gemini'
    );

  });

  it('should be able to collect logs for gemini image edit', async () => (await validateLogsMetrics("gemini", "gemini-2.0-flash-preview-image-generation")));

  it('should patch update AI proxy advanced plugin config support google vertex image generation', async function () {

    const vertexImagePayload = _.cloneDeep(pluginPayload);
    vertexImagePayload.service.id = serviceId;
    vertexImagePayload.config.targets = [target_vertex_generation];

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: vertexImagePayload,
      validateStatus: null
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  // For Vertex
  it('should be able to send prompt to vertex image generation model via route and to generate image', async function () {
    const makeRequest = () => sendImageGenerationRequest(
      `${proxyUrl}${routePath}`, 
      image_gen_prompt
    );
    
    await retryAIRequest(
      makeRequest,
      (resp) => validateImageGenerationResponse(resp, 'vertex'),
      'vertex'
    );
  });

  it('should be able to collect logs for vertex image generation', async () => (await validateLogsMetrics("gemini", "gemini-2.0-flash-preview-image-generation")));

  it('should patch update AI proxy advanced plugin with google vertex image edit', async function () {
    const geminiImagePayload = _.cloneDeep(pluginPayload);
    geminiImagePayload.service.id = serviceId;
    geminiImagePayload.config.targets = [target_vertex_edit];

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: geminiImagePayload,
      validateStatus: null
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  it('should be able to send prompt to vertex image model via route and to edit image', async function () {

    const makeRequest = () => sendImageEditRequest(
      `${proxyUrl}${routePath}/images/edits}`, 
      image_edit_prompt
    );
    
    await retryAIRequest(
      makeRequest,
      (resp) => validateImageEditResponse(resp, 'vertex'),
      'vertex'
    );

  });

  it('should be able to collect logs for vertex image edit', async () => (await validateLogsMetrics("gemini", "gemini-2.0-flash-preview-image-generation")));

  it('should patch update AI proxy advanced plugin config support aws bedrock image generation', async function () {

    const vertexImagePayload = _.cloneDeep(pluginPayload);
    vertexImagePayload.service.id = serviceId;
    vertexImagePayload.config.targets = [target_bedrock_generation];

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: vertexImagePayload,
      validateStatus: null
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  // For Bedrock
  it('should be able to send prompt to bedrock image generation model via route and to generate image', async function () {

    const makeRequest = () => sendImageGenerationRequest(
      `${proxyUrl}${routePath}`, 
      image_gen_prompt
    );
    
    await retryAIRequest(
      makeRequest,
      (resp) => validateImageGenerationResponse(resp, 'bedrock'),
      'bedrock'
    );

  });

  //skipping this test as it is not supported in the current version of the plugin AG-350
  it('should patch update AI proxy advanced plugin with awd bedrock image edit', async function () {
    const geminiImagePayload = _.cloneDeep(pluginPayload);
    geminiImagePayload.service.id = serviceId;
    geminiImagePayload.config.targets = [target_bedrock_edit];

    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
      data: geminiImagePayload,
      validateStatus: null
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

    await waitForConfigRebuild();
  });

  //skipping this test as it is not supported in the current version of the plugin AG-350
  it('should be able to send prompt to bedrock image model via route and to edit image', async function () {

    const makeRequest = () => sendImageEditRequest(
      `${proxyUrl}${routePath}/images/edits`, 
      image_edit_prompt
    );
    
    await retryAIRequest(
      makeRequest,
      (resp) => validateImageEditResponse(resp, 'bedrock'),
      'bedrock'
    );

  });

  after(async function () {
    await clearAllKongResources();
  });

});
