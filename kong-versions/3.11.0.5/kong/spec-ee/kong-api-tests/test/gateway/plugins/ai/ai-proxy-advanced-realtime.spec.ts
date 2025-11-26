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
} from '@support'
import _ from 'lodash';
import axios from 'axios';
import WebSocket from 'promise-ws';

// This test verify the realtime API functionality of the AI Proxy advanced plugin with Openai llm format.
describe('@ai: Gateway Plugins: AI Proxy Advanced Realtime Test', function () {
  // Increase timeout ws realtime test
  this.timeout(600000);
  const azure_instance = "ai-gw-sdet-e2e-test2";
  const audioPath = getDataFilePath('ai/test_pcm16_24khz.raw');

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })
  const routePath = '/ai_proxy_realtime_test';
  const wsUrl = `${proxyUrl.replace('http', 'ws')}${routePath}`;

  let serviceId: string;
  let pluginId: string;

  // Define a type for the providers
  type responsesProvider = 'openai' | 'azure';
  // Define a type for content
  type contentType = 'text' | 'audio';
  // Use typed keys
  const providers: responsesProvider[] = ['openai', 'azure'];

  const responses_models = {
    openai: "gpt-4o-realtime-preview",
    azure: "gpt-4o-mini-realtime-preview"
  };

  const pluginPayload = {
    config: {
      max_request_body_size: 99999,
      genai_category: "realtime/generation",
      llm_format: 'openai', //using openai format for real time test
      model_name_header: true,
      response_streaming: 'allow',
      targets: [] as Array<Record<string, any>>,
      balancer: {
        algorithm: 'consistent-hashing',
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

  // Factory function for generating target configurations
  function createResponsesTarget(provider: responsesProvider) {
    // Common base configuration structure
    const baseConfig: Record<string, any> = {
      logging: {
        log_statistics: false,
        log_payloads: false
      },
      weight: 100
    };


    // Provider-specific configurations
    const providerConfigs = {
      openai: {
        auth: {
          header_name: "Authorization",
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        model: {
          name: responses_models.openai,
          options: {},
          provider: "openai"
        },
        route_type: "realtime/v1/realtime"
      },
      azure: {
        auth: {
          header_name: "api-key",
          header_value: vars.ai_providers.AZUREAI_REALTIME_API_KEY,
        },
        model: {
          name: responses_models.azure,
          options: {
            azure_instance: azure_instance,
            azure_deployment_id: responses_models.azure,
            azure_api_version: "2024-10-01-preview",
          },
          provider: "azure"
        },
        route_type: "realtime/v1/realtime"
      }
    };

    // Combine configurations
    return {
      ...baseConfig,
      ...providerConfigs[provider]
    };
  }

  /**
   * Creates a message payload based on content type
   * @param type The content type ('text' or 'audio')
   * @param content Optional custom content (text string or Buffer for audio)
   * @returns The fully formatted message object ready for sending
   */
  function createMessagePayload(
    type: contentType,
    content?: string | Buffer
  ): Record<string, any> {
    // Build the appropriate content array based on type
    let messageContent: Array<{ type: string, [key: string]: any }>;

    if (type === 'text') {
      // Text content (use provided text or default to "hi")
      messageContent = [{
        type: "input_text",
        text: typeof content === 'string' ? content : "hi"
      }];
    } else {
      // Audio content
      const pcmData = content instanceof Buffer ?
        content : getBinaryFileContent(audioPath);

      messageContent = [{
        type: "input_audio",
        audio: pcmData.toString('base64')
      }];
    }

    // Return the complete message structure
    return {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: messageContent
      }
    };
  }

  /**
   * Unified function to send a message via WebSocket
   */
  async function sendMessage(
    websocket: any,
    type: contentType,
    content?: string | Buffer
  ): Promise<void> {
    // Create the message payload
    const payload = createMessagePayload(type, content);

    logDebug(`Sending ${type} message`);
    // Send the message
    await websocket.send(JSON.stringify(payload));
  }


  /**
   * Function to request a response with appropriate modalities
   */
  async function requestResponse(websocket: any, type: contentType): Promise<void> {
    const payload = {
      type: "response.create",
      response: type === 'text' ? { modalities: ["text"] } : {} // Audio should allow all modalities
    };

    await websocket.send(JSON.stringify(payload));
    logDebug(`${type.charAt(0).toUpperCase() + type.slice(1)} response requested`);
  }

  /**
   * Function to configure session for audio support and wait for update confirmation
   */
  async function configureAudioSession(websocket: any): Promise<void> {
    const config = {
      "type": "session.update",
      "session": {
        "modalities": ["text", "audio"],
        "instructions": "You are a helpful assistant. Keep your responses very short.",
        "voice": "alloy",
        "input_audio_format": "pcm16",
        "output_audio_format": "pcm16"
      }
    };

    logDebug("Sending audio session configuration...");
    await websocket.send(JSON.stringify(config));
    
    await new Promise<void>((resolve, reject) => {
      const updateTimeout = setTimeout(() => {
        websocket.removeListener('message', updateHandler);
        reject(new Error('Timeout waiting for session.updated'));
      }, 10000);
      
      const updateHandler = (message: any) => {
        try {
          const data = JSON.parse(message.toString());
          logDebug(`Received event during audio config: ${data.type}`);
          
          if (data.type === "session.updated") {
            clearTimeout(updateTimeout);
            websocket.removeListener('message', updateHandler);
            logDebug("Session successfully updated for audio");
            resolve();
          }
        } catch (error) {
          logDebug(`Error parsing message while waiting for session update: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      websocket.on('message', updateHandler);
    });
  }

  /**
   * Creates a WebSocket connection with enhanced rate limit handling
   * @param retryCount Current retry attempt (for recursive calls)
   * @param maxRetries Maximum number of retries before giving up
   * @returns Promise resolving to established WebSocket
   */
  async function createWebSocketConnection(retryCount = 0, maxRetries = 5): Promise<any> {
    // Add a random delay between 20 and 35 seconds before each connection to reduce thundering herd effect
    const baseDelay = 20000; // 20 seconds
    const jitter = Math.floor(Math.random() * 15000); // up to 15 seconds extra
    const totalDelay = baseDelay + jitter;
    logDebug(`Jitter: waiting ${totalDelay}ms before starting test`);
    await new Promise(resolve => setTimeout(resolve, totalDelay));
    
    logDebug(`Connecting to WebSocket at: ${wsUrl} (attempt ${retryCount + 1}/${maxRetries + 1})`);

    try {
      // WebSocket.create() returns a Promise that resolves when connected
      const websocket = await WebSocket.create(wsUrl, {
        headers: {
          "OpenAI-Beta": "realtime=v1",
        },
        rejectUnauthorized: false
      });

      logDebug(`WebSocket connection established successfully`);
      return websocket;
    } catch (error: unknown) {
      // Convert to a known type with proper TypeScript handling
      const err = error as Error & { 
        status?: number, 
        headers?: Record<string, string> 
      };
      
      // Log the full error object for debugging
      logDebug(`WebSocket connection error: ${JSON.stringify(
        err, 
        Object.getOwnPropertyNames(err as object)
      )}`);
      
      // Check if this is a rate limit error by examining status code if available
      const isRateLimit = err.status === 429 || 
                           (err instanceof Error && err.message.includes('429'));
      
      if (isRateLimit && retryCount < maxRetries) {
        let delay = 30000 * Math.pow(2, retryCount); // Start at 30s, double each retry
        delay = Math.min(delay, 180000); // Cap at 3 minutes

        // Add significant jitter (±50%) and cap the delay at 4 minutes
        const jitterRetry = 0.5;
        delay = Math.min(delay * (1 + jitterRetry * (Math.random() * 2 - 1)), 240000);
        
        logDebug(`Rate limited (429). Retrying in ${Math.round(delay/1000)} seconds...`);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Recursive retry with incremented count
        return createWebSocketConnection(retryCount + 1, maxRetries);
      }
      
      // For other errors or if we've exhausted retries, propagate the error
      throw error;
    }
  }

  /**
   * Creates a WebSocket connection and waits for session creation
   * @param messageType The type of message ('text' or 'audio')
   * @param provider The provider to use (optional)
   * @param maxRetries Number of retry attempts
   * @returns The established WebSocket with session created
   */
  async function createAndSetupWebSocketConnection(
    messageType: contentType,
    provider?: responsesProvider,
    maxRetries = 2
  ): Promise<any> {
    let attempts = 0;
    let lastError: Error | null = null;
    
    while (attempts <= maxRetries) {
      let websocket: any = null;
      
      try {
        if (attempts > 0) {
          logDebug(`Retry attempt ${attempts} for WebSocket connection (${messageType} mode, ${provider || 'unknown'} provider)`);
          // Add delay with exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempts - 1), 5000)));
        }
        
        // Reuse existing connection function
        websocket = await createWebSocketConnection();
        
        // Set up error handler
        websocket.on('error', (err) => {
          logDebug(`WebSocket error: ${err.message}`);
          throw err;
        });
        
        const timeout = 45000;
        
        // Wait for session creation
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            if (websocket) {
              websocket.removeListener('message', handler);
            }
            reject(new Error(`Timeout waiting for session creation (${messageType} mode)`));
          }, timeout);
          
          const handler = async (message: any) => {
            try {
              const data = JSON.parse(message.toString());
              logDebug(`Received session event: ${data.type}`);
              
              if (data.type === "session.created") {
                clearTimeout(timeoutId);
                logDebug("Session created successfully");
                
                try {
                  // Configure audio if that's the message type
                  if (messageType === 'audio') {
                    await configureAudioSession(websocket);
                  }
                  
                  // Remove this handler after session is created and configured
                  websocket.removeListener('message', handler);
                  resolve();
                } catch (err) {
                  logDebug(`Error in session creation: ${err instanceof Error ? err.message : String(err)}`);
                  reject(err);
                }
              }
            } catch (error) {
              clearTimeout(timeoutId);
              if (websocket) {
                websocket.removeListener('message', handler);
              }
              reject(error);
            }
          };
          
          websocket.on('message', handler);
        });
        
        // If we reach here, session was created successfully
        return websocket;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Cleanup websocket if needed
        if (websocket) {
          try {
            if (websocket.readyState !== WebSocket.CLOSED) {
              await websocket.close();
              logDebug(`Closed WebSocket connection after error`);
            }
          } catch (closeError) {
            logDebug(`Error closing WebSocket: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
          }
        }
        
        // Only retry on timeout errors
        if (lastError.message.includes('Timeout') && attempts < maxRetries) {
          attempts++;
          logDebug(`Retrying WebSocket connection after timeout (attempt ${attempts}/${maxRetries})`);
        } else {
          logDebug(`Failed to create WebSocket session: ${lastError.message}`);
          throw lastError;
        }
      }
    }
    
    // This should never be reached
    throw lastError || new Error('Failed to create WebSocket session');
  }

  /**
   * Handles the conversation item creation and requests a response
   * @param websocket The WebSocket connection
   * @param requestFn Function to request a response
   * @param type The content type ('text' or 'audio')
   * @returns Promise that resolves when message is accepted and response is requested
   */
  async function handleMessageAcceptance(
    websocket: any,
    requestFn: (ws: any, type: contentType) => Promise<void>,
    type: contentType
  ): Promise<void> {
    // Create variables in outer scope so they can be accessed in finally block
    let timeoutId: NodeJS.Timeout | null = null;
    let messageHandler: ((message: any) => void) | null = null;
    
    return new Promise<void>((resolve, reject) => {
      // Set up timeout
      timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for message acceptance'));
      }, 20000);
      
      // Define message handler
      messageHandler = async (message: any) => {
        try {
          const data = JSON.parse(message.toString());
          
          if (data.type === "conversation.item.created") {
            logDebug("Text message accepted");
            
            try {
              // Call requestFn with both websocket and type
              await requestFn(websocket, type);
              resolve();
            } catch (sendError) {
              logDebug(`Error requesting response: ${sendError instanceof Error ? sendError.message : String(sendError)}`);
              reject(sendError);
            }
          }
        } catch (error) {
          reject(error);
        }
      };
      
      // Register the message handler
      websocket.on('message', messageHandler);
    })
    .finally(() => {
      // Always clean up resources regardless of success or failure
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      
      if (messageHandler !== null && websocket) {
        websocket.removeListener('message', messageHandler);
        logDebug("Cleaned up message acceptance handler");
      }
    });
  }

  /**
   * Unified function to collect and validate AI responses (text or audio)
   * @param websocket The WebSocket connection
   * @param type The type of response to collect ('text' or 'audio')
   * @returns Promise resolving to the response data
   */
  async function collectResponse(
    websocket: any,
    type: contentType
  ): Promise<any> {
    // Set appropriate timeout based on response type
    const timeout = 30000;

    return new Promise<any>((resolve, reject) => {

      const timeoutId = setTimeout(() => {
        websocket.removeListener('message', handler);
        reject(new Error(`Timeout waiting for ${type} response completion`));
      }, timeout);

      // Track text deltas for debugging or validation
      const textChunks: string[] = [];

      const handler = async (message: any) => {
        try {
          // Parse message data consistently for both types
          let data: any;

          // Handle different data formats
          const messageData = message.data || message;

          if (typeof messageData === 'string') {
            data = JSON.parse(messageData);
          } else {
            // For non-string data (likely binary audio data), log and continue
            if (type === 'audio') {
              logDebug(`Received non-string message (likely binary audio data)`);
              return; // Continue collecting messages
            } else {
              // For text mode, this is unexpected
              logDebug(`Unexpected message format: ${typeof messageData}`);
              return;
            }
          }

          // Process text deltas for text mode
          if (type === 'text' && data.type === "response.text.delta" && data.delta) {
            textChunks.push(data.delta);
            logDebug(`Received text chunk: ${data.delta}`);
          }

          // Process completion for both modes
          if (data.type === "response.done") {
            clearTimeout(timeoutId);
            logDebug(`${type.charAt(0).toUpperCase() + type.slice(1)} response completed`);

            // Add detailed logging for audio responses
            if (type === 'audio') {
              logDebug(`Response data structure: ${JSON.stringify(data, null, 2)}`);
            }

            // Remove handler
            websocket.removeListener('message', handler);

            // Return the appropriate response format
            resolve(data.response);
            
          }
        } catch (error) {
          if (type === 'audio') {
            // For audio, log the error but don't reject
            // (might be binary audio data that can't be parsed as JSON)
            logDebug(`Error parsing message in audio handler: ${error instanceof Error ? error.message : String(error)}`);

            // Try to log the raw message for debugging
            try {
              logDebug(`Raw message: ${typeof message === 'object' ?
                JSON.stringify(message).substring(0, 100) :
                String(message).substring(0, 100)}`);
            } catch (err) {
              logDebug('Could not stringify message for logging');
            }
          } else {
            // For text mode, parsing errors are unexpected and should cause failure
            clearTimeout(timeoutId);
            websocket.removeListener('message', handler);
            reject(error);
          }
        }
      };

      websocket.on('message', handler);
    });
  }


  /**
   * Unified WebSocket test runner for both text and audio interactions
   * @param provider The provider to test with ('openai' or 'azure')
   * @param type The interaction type ('text' or 'audio')
   */
  async function runWebSocketTest(provider: string, type: contentType) {
    let websocket;

    try {
      // Create connection and wait for session in one step
      websocket = await createAndSetupWebSocketConnection(
        type,
        provider as responsesProvider,
      );
      
      logDebug(`WebSocket connection established for ${provider}${type === 'audio' ? ' audio test' : ''}`);
      // Set up error handler
      websocket.on('error', (err) => {
        logDebug(`WebSocket error: ${err.message}`);
        throw err;
      });

      // Set up a promise race with a timeout
      const testPromise = async () => {
        // Handle session creation
        await sendMessage(websocket, type);

        // Handle message acceptance
        await handleMessageAcceptance(websocket, requestResponse, type);

        // Collect response data
        const response = await collectResponse(websocket, type);

        // Validate token usage with proper assertions
        expect(response, 'Response should exist').to.exist;
        expect(response.usage, 'Response should include token usage').to.exist;

        const usage = response.usage;
        logDebug(`Token usage - Total: ${usage.total_tokens}, Input: ${usage.input_tokens}, Output: ${usage.output_tokens}`);

        expect(usage.total_tokens, 'Total tokens should be greater than 0').to.be.greaterThan(1);
        expect(usage.input_tokens, 'Input tokens should be greater than 0').to.be.greaterThan(1);
        expect(usage.output_tokens, 'Output tokens should be greater than 0').to.be.greaterThan(1);

        // Enhanced checks for output_token_details based on type
        if (type === 'audio') {
          expect(
            usage.output_token_details,
            'Audio response should include output_token_details'
          ).to.exist;
          expect(
            usage.output_token_details.audio_tokens,
            'Audio response should have audio_tokens > 1'
          ).to.be.greaterThan(1);
        } else if (type === 'text') {
          expect(
            usage.output_token_details,
            'Text response should include output_token_details'
          ).to.exist;
          expect(
            usage.output_token_details.text_tokens,
            'Text response should have text_tokens > 1'
          ).to.be.greaterThan(1);
        }
        
        logDebug(`Successfully completed realtime ${type} test with ${provider}`);
      };

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${type.charAt(0).toUpperCase() + type.slice(1)} WebSocket test for ${provider} timed out after 30 seconds`));
        }, 30000);
      });

      // Race the test against the timeout
      await Promise.race([testPromise(), timeoutPromise]);

    } catch (error) {
      logDebug(`${type.charAt(0).toUpperCase() + type.slice(1)} test failed with error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      // Ensure connection is closed
      if (websocket && websocket.readyState !== WebSocket.CLOSED) {
        try {
          await websocket.close();
          logDebug('WebSocket connection closed');
        } catch (err) {
          logDebug(`Error closing WebSocket: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  before(async function () {
    const service = await createGatewayService(
      'ai-realtime-test-service',
      {
        host: "dummywss",
        protocol: "ws",
        name: "ai-realtime-test-service",
        port: 80,
        enabled: true,
        tls_verify: null,
        path: null
      });
    serviceId = service.id;
    await createRouteForService(serviceId, null, {
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
      "name": "ws-ai-proxy-test",
      "protocols": [
        "ws",
        "wss"
      ]
    });
    await waitForConfigRebuild();
  })

  it(`should create AI proxy advanced plugin with empty target for responses test`, async function () {
    pluginPayload.service.id = serviceId;
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
    await waitForConfigRebuild();
  });

  // Create targets for each provider
  providers.forEach((provider) => {

    it(`should patch update AI proxy advanced plugin with provider ${provider} as target`, async function () {
      const targetPayload = _.cloneDeep(pluginPayload);
      const target_per_provider = createResponsesTarget(provider);

      targetPayload.service.id = serviceId;
      targetPayload.config.targets = [target_per_provider];

      const resp = await axios({
        method: 'patch',
        url: `${adminUrl}/plugins/${pluginId}`,
        data: targetPayload,
        validateStatus: null
      });

      logResponse(resp);

      expect(resp.status, 'Status should be 200').to.equal(200);
      expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');

      await waitForConfigRebuild();
    });

    it(`should successfully process realtime text interactions via WebSocket with ${provider}`, async function () {
      await runWebSocketTest(provider, 'text');
    });

    it(`should successfully process realtime audio interactions via WebSocket with ${provider}`, async function () {
      await runWebSocketTest(provider, 'audio');
    });

  });

});


after(async function () {
  await clearAllKongResources();
});
