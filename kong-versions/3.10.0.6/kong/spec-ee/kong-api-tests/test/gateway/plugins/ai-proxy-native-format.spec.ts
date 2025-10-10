import axios from 'axios';
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
  postNegative,
  retryRequest,
  matchOccurrences,
} from '@support'
import { GoogleGenAI } from '@google/genai';
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

describe('Gateway Plugins: AI Proxy native format test', function () {
  //providers do not support preserve will skip route_type 'preserve' tests
  const aws_region = 'ap-northeast-1';
  const bedrock_version = "bedrock-2023-05-31";
  const providers = [
    {
      name: 'openai',
      variant: 'openai',
      chat: {
        model: 'gpt-4',
        options: null
      },
      completions: {
        model: 'gpt-3.5-turbo-instruct',
        options: null
      },
      image: {
        model: 'gpt-4o-mini',
        options: null
      },
      image_generation: {
        model: 'dall-e-3',
        options: null
      },
      audio: {
        model: 'whisper-1',
        options: null
      },
      auth_header: 'Authorization',
      auth_key: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
    },
    //Google gemini public use via API does not do audio transcription or image generation or completion mode
    {
      name: 'gemini',
      variant: 'gemini',  // Gemini public use (Gemini public AI)
      chat: {
        model: 'gemini-2.0-flash',
        options: null
      },
      auth_header: null,
      auth_key: null,
      param_name: 'key',
      param_location: 'query',
      param_value: `${vars.ai_providers.GEMINI_API_KEY}`
    },
    //aws bedrock via API does not do audio transcription or image generation or completion mode
    {
      name: 'bedrock',
      variant: 'bedrock',
      chat: {
        model: 'anthropic.claude-3-haiku-20240307-v1:0',
        options: {
          "bedrock": {
            "aws_region": aws_region
          }
        }
      },
      auth_header: null,
      auth_key: null,
      aws_access_key_id: `${vars.aws.AWS_ACCESS_KEY_ID}`,
      aws_secret_access_key: `${vars.aws.AWS_SECRET_ACCESS_KEY}`
    }
  ]

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })

  const path = '/ai_proxy_test'
  const promptText = "return plain text to print word 'kong_strong' exactly 3 times, no variations, just the exact text";

  let serviceId: string
  let pluginId: string
  let geminiAI: any
  let bedrockClient: any

  function evaluateResponse(resp, expectedProvider, expectedModel) {
    expect(resp.status, 'Response should have status code 200').to.equal(200)
    const providerName = expectedProvider === 'vertex' ? 'gemini' : expectedProvider

    expect(resp.data, 'Response should have model property').to.have.property('model')
    expect(resp.data, 'Response should have choices property').to.have.property('choices')
    expect(resp.data.model, 'Response should have expected model').to.contain(expectedModel)
    expect(resp.data.choices[0], 'Response should have message property').to.have.property('message')
    expect(resp.data.choices[0].message, 'Response should have role property').to.have.property('role')
    expect(resp.data.choices[0].message, 'Response should have content property').to.have.property('content')

    //assumes that model_name_header is true
    expect(resp.headers, 'Response should have x-kong-llm-model header').to.have.property('x-kong-llm-model')
    expect(resp.headers['x-kong-llm-model'], 'Response header should have expected model and provider').to.contain(expectedModel).and.to.contain(providerName)
  }

  function parseNativeResponse(resp: any, variant: string): string {
    console.log('Parsing response for variant:', variant);
    console.log('Response structure:', JSON.stringify(resp, null, 2));
  
    if (variant === 'gemini') {
      return resp.candidates[0].content.parts[0].text;
    } else if (variant === 'bedrock') {
      if (resp.output && resp.output.message && resp.output.message.content) {
        return resp.output.message.content[0].text;
      }
      throw new Error(`Invalid response structure for Bedrock: ${JSON.stringify(resp)}`);
    }
    throw new Error(`Unsupported variant: ${variant}`);
  }

  function handleNormalError(err: any, providerVariant: string): void {
    if (err instanceof Error) {
      if (err.message.includes('location is not supported')) {
        console.warn('Non-critical error: location is not supported. Skipping failure.');
        return;
      } else if (err.message.includes('The upstream server is timing out')) {
        console.warn('Received expected 504 timeout, skipping failure');
        return;
      } else if (err.message.includes('Rate limit exceeded')) {
        console.error(`Rate limit exceeded for ${providerVariant} provider`);
        return;
      }
    }
  
    // Log and re-throw other errors
    console.error(`Error during request for ${providerVariant} provider:`, err);
    throw err; // Re-throw the error to fail the test
  }

  before(async function () {
    // add header to every axios request in this suite
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate'

    //create a service and route for use with plugin
    const service = await createGatewayService('ai-test-service')
    serviceId = service.id
    await createRouteForService(serviceId, [path])
    // Initialize the GoogleGenAI client with a custom endpoint pointing to Kong Gateways
    geminiAI = new GoogleGenAI({
      apiKey: vars.ai_providers.GEMINI_API_KEY,
      httpOptions: {
        baseUrl: `${proxyUrl}/${path}`, 
      },
    });
    // Initialize the Bedrock client with a custom endpoint pointing to Kong Gateway
    bedrockClient = new BedrockRuntimeClient({
      region: aws_region,
      endpoint: `${proxyUrl}/${path}`
    });

  })

  providers.forEach((provider) => {

    const pluginPayload = {
      name: 'ai-proxy',
      service: { id: '' },
      config: {
        model: {
          name: provider.chat.model,
          provider: provider.name,
          options: provider.chat.options || {}
        },
        auth: {
          param_name: provider.param_name || null,
          param_value: provider.param_value || null,
          param_location: provider.param_location || null,
          allow_override: false,
          azure_client_id: null,
          azure_client_secret: null,
          azure_tenant_id: null,
          azure_use_managed_identity: false,
          aws_access_key_id: provider.aws_access_key_id || null,
          aws_secret_access_key: provider.aws_secret_access_key || null,
          header_name: provider.auth_header,
          header_value: provider.auth_key,
          gcp_use_service_account: false,
          gcp_service_account_json: null
        },
        logging: {
          log_statistics: false,
          log_payloads: false
        },
        route_type: 'llm/v1/chat',
        model_name_header: true
      }
    }

    it(`should create AI proxy plugin using ${provider.variant} provider and chat model ${provider.chat.model} model`, async function () {
      // setting service id to plugin payload as we can now access the serviceId inside it (test) scope
      pluginPayload.service.id = serviceId

      const resp = await axios({
        method: 'post',
        url: `${adminUrl}/services/${serviceId}/plugins`,
        data: pluginPayload,
        validateStatus: null
      })

      pluginId = resp.data.id
      logResponse(resp);

      expect(resp.status, 'Status should be 201').to.equal(201);
      expect(resp.headers['content-type'], 'Should have content-type header set to application/json').to.contain('application/json');
      expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy');

      expect(resp.data.config.model.name, 'Should have correct model name').to.equal(provider.chat.model);
      expect(resp.data.config.model.provider, 'Should have correct provider').to.equal(provider.name);
      expect(resp.data.config.auth.header_name, 'Should have correct auth header name').to.equal(provider.auth_header);
      expect(resp.data.config.auth.header_value, 'Should have correct auth header value').to.equal(provider.auth_key);
      expect(resp.data.config.route_type, 'Should have correct route type').to.equal('llm/v1/chat');

      await waitForConfigRebuild();
    })

    it(`should be able to send properly formatted chat message to ${provider.variant} provider and chat model ${provider.chat.model} via route`, async function () {
      const req = () => postNegative(
        `${proxyUrl}${path}`,
        {
          messages: [{
            'role': 'user',
            'content': 'What is the tallest mountain on Earth?'
          }],
        });

      const assertions = (resp) => {
        if (resp.status === 400) {
          if (provider.variant === 'gemini') {
            // Gemini may return 400 for unsupported locations, don't fail the test
            const errorData = Array.isArray(resp.data) ? resp.data[0].error : resp.data.error;
            expect(errorData).to.have.property('message');
            expect(errorData.message).to.include('location is not supported');
            return;
          }
          expect.fail(`Unexpected 400 response from ${provider.variant}: ${resp.data.error.message}`);
        } else if (resp.status === 504) {
          const msg = resp.data?.message || '';
          if (msg.includes('The upstream server is timing out')) {
            console.warn(`Received expected 504 timeout, skipping failure`);
            return;
          }
          expect.fail(`Unexpected 504 response: ${msg || 'no message'}`);
        } else if (resp.status === 429) {
          console.error(`Rate limit exceeded for ${provider.variant} provider`);
        } else if (resp.status === 200) {
          evaluateResponse(resp, provider.variant, provider.chat.model);
        } else {
          expect.fail(`Unexpected response status: ${resp.status}`);
        }
      };

      await retryRequest(req, assertions);

    })

    //tests for gemini and bedrock native formats
    if (provider.variant === 'gemini' || provider.variant === 'bedrock') {
      it(`should update ai-proxy plugin to use ${provider.variant} native format`, async function () {
        const resp = await axios({
          method: 'patch',
          url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
          data: {
            config: {
              llm_format: provider.variant,
            },
          },
        });
        logResponse(resp);
        expect(resp.status, 'Should have 200 status code').to.equal(200);
        expect(resp.data.config.llm_format, 'Should have correct llm_format').to.equal(provider.variant);

        await waitForConfigRebuild();
      });

      it(`should not allow send open-ai format chat message to ${provider.variant} provider via route`, async function () {
        const resp = await postNegative(
          `${proxyUrl}${path}`,
          {
            messages: [{
              'role': 'user',
              'content': promptText
            }],
          });

        expect(resp.status, 'Response should have status code 400').to.equal(400);
      })

      it(`should send ${provider.variant} native format API request and verify response`, async function () {
        if (provider.variant === 'gemini') {
          try {
            const resp = await geminiAI.models.generateContent({
              model: provider.chat.model,
              contents: promptText,
            });
            parseNativeResponse(resp, provider.variant);
          } catch (err) {
            handleNormalError(err, provider.variant);
          }
        } else if (provider.variant === 'bedrock') {
          try {
            const payload = {
              anthropic_version: bedrock_version,
              max_tokens: 1000,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: promptText,
                    },
                  ],
                },
              ],
            };

            const resp = await bedrockClient.send(
              new InvokeModelCommand({
                contentType: "application/json",
                body: JSON.stringify(payload),
                modelId: provider.chat.model,
              })
            );

            // Decode and parse the response
            const decodedResponseBody = new TextDecoder().decode(resp.body);
            const responseBody = JSON.parse(decodedResponseBody);

            // Validate the response
            const responseText = parseNativeResponse(responseBody, provider.variant);
            matchOccurrences(responseText, 'kong_strong', 3, 'gte');

          } catch (err) {
            handleNormalError(err, provider.variant);
          }
        }

      });

      it(`should be able to patch the plugin to force streaming of responses for ${provider.variant} AI proxy plugin`, async function () {
        const resp = await axios({
          method: 'patch',
          url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
          data: {
            config: {
              response_streaming: 'always',
            }
          },
          validateStatus: null
        })
        logResponse(resp)
        expect(resp.status, 'Should have 200 status code').to.equal(200)
        expect(resp.data.config.response_streaming, 'Should have response_streaming set to always').to.equal('always')
        expect(resp.data.config.model.name, 'Should have correct model name').to.equal(provider.chat.model)
        expect(resp.data.config.route_type, 'Should have correct route type').to.equal('llm/v1/chat')

        await waitForConfigRebuild()
      })

      it(`should be able to send message to ${provider.variant} AI model ${provider.chat.model} via route with streaming enabled`, async function () {
        if (provider.variant === 'bedrock') { // Skip streaming test for Bedrock due to AG-270
          console.warn(`Skipping streaming test for ${provider.variant} due to known issue (AG-270).`);
          return;
        }

        if (provider.variant === 'gemini') {
          try {
            const resp = await geminiAI.models.generateContentStream({
              model: provider.chat.model,
              contents: promptText,
            });
            let responseText = '';

            for await (const chunk of resp) {
              console.log(chunk.text);
              responseText += chunk.text;
            }

            matchOccurrences(responseText, 'kong_strong', 3, 'gte');

          } catch (err) {
            handleNormalError(err, provider.variant);
          }
        } else if (provider.variant === 'bedrock') {
          try {
            console.log('Sending request to AWS Bedrock...');
            const payload = {
              anthropic_version: bedrock_version,
              max_tokens: 1000,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "hello world",
                    },
                  ],
                },
              ],
            };

            console.log('Payload being sent to Bedrock:', JSON.stringify(payload, null, 2));

            const command = new InvokeModelWithResponseStreamCommand({
              contentType: "application/json",
              body: JSON.stringify(payload),
              modelId: provider.chat.model,
            });

            const resp = await bedrockClient.send(command);

            console.log('Response body of stream bedrock is:', resp.body);
            let completeMessage = '';

            for await (const item of resp.body) {
              console.log('Stream item:', item); // Log each emitted item
              if (item.chunk) {
                const chunk = JSON.parse(new TextDecoder().decode(item.chunk.bytes));
                console.log('Decoded chunk:', chunk); // Log the decoded chunk
                const chunk_type = chunk.type;
            
                if (chunk_type === "content_block_delta") {
                  const text = chunk.delta.text;
                  completeMessage = completeMessage + text;
                }
              } else {
                console.warn('Item does not contain a chunk:', item);
              }
            }

            console.log('Full streamed response:', completeMessage);
            // Ensure the full response is not empty
            if (!completeMessage.trim()) {
              throw new Error('Full response is empty');
            }else {
              // Parse the full response and validate
              const responseBody = JSON.parse(completeMessage);
              console.log('Parsed response body:', JSON.stringify(responseBody, null, 2));
              matchOccurrences(responseBody, 'kong_strong', 3, 'gte');
            }
          } catch (err) {
            handleNormalError(err, provider.variant);
          }
        }
      })
    }

    it(`should switch back to openai format after ${provider.variant} native format tests`, async function () {
      const resp = await axios({
        method: 'patch',
        url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`,
        data: {
          config: {
            llm_format: 'openai', // Switch back to openai format
            response_streaming: 'deny'
          },
        },
      });
      logResponse(resp);
      expect(resp.status, 'Should have 200 status code').to.equal(200);
      expect(resp.data.config.llm_format, 'Should have llm_format set back to openai').to.equal('openai');

      await waitForConfigRebuild();
    });


    it(`should not be able to request streaming of responses for ${provider.variant} AI proxy plugin`, async function () {
      const resp = await postNegative(`${proxyUrl}${path}`, {
        messages: [{
          'role': 'user',
          'content': 'Who painted the Mona Lisa?'
        }],
        stream: true
      })
      logResponse(resp)
      expect(resp.status, 'Should have 400 status code').to.equal(400)
      expect(resp.data.error.message, 'Should have correct error message').to.equal('response streaming is not enabled for this LLM')
    })


    it('should delete AI proxy plugin', async function () {
      const resp = await axios({
        method: 'delete',
        url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`
      })
      logResponse(resp)
      expect(resp.status, 'Should have 204 status code').to.equal(204)
    })
  })

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await clearAllKongResources()
  });
});
