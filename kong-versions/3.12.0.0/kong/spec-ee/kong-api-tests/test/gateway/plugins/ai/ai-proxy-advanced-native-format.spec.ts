import axios from 'axios';
import { AxiosResponse } from 'axios';
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
  matchOccurrences,
  logDebug,
} from '@support'
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { BedrockAgentRuntimeClient, RerankCommand, RerankCommandOutput } from "@aws-sdk/client-bedrock-agent-runtime";
import { RankServiceClient } from '@google-cloud/discoveryengine';
import { protos } from '@google-cloud/discoveryengine';
type RankResponse = protos.google.cloud.discoveryengine.v1.IRankResponse;


xdescribe('@ai: Gateway Plugins: AI Proxy native format test', function () {
  const aws_region = 'ap-northeast-1';
  const bedrock_version = "bedrock-2023-05-31";

  type ProviderOptions = {
    gemini?: {
      api_endpoint?: string;
      project_id?: string;
      location_id?: string;
    };
    bedrock?: {
      aws_region: string;
    };
  }
  type ProviderConfig = {
    name: string;
    case: string;
    model: string;
    options?: ProviderOptions| null;
    auth_header?: string | null;
    auth_key?: string | null;
    param_name?: string | null;
    param_location?: string | null;
    param_value?: string | null;
  };

  const providers: ProviderConfig[] = [
    {
      name: 'gemini',
      case: 'gemini-chat',  // Gemini public use (Gemini public AI)
      model: 'gemini-2.0-flash',
      param_name: 'key',
      param_location: 'query',
      param_value: `${vars.ai_providers.GEMINI_API_KEY}`
    },
    {
      name: 'gemini',
      case: 'gemini-vertex-chat', // Gemini Vertex AI (Gemini private use)
      model: 'gemini-2.0-flash',
      options: {
        gemini: {
          api_endpoint: "us-central1-aiplatform.googleapis.com",
          project_id: "gcp-sdet-test",
          location_id: "us-central1",
        },
      },
    },
    {
      name: 'gemini',
      case: 'gemini-vertex-rerank',  // Gemini Vertex AI (Gemini private use)
      model: 'semantic-ranker-default@latest',
      options: {
        gemini: {
          api_endpoint: "discoveryengine.googleapis.com",
          project_id: "gcp-sdet-test",
          location_id: "global",
        },
      },
    },
    //aws bedrock via API does not do audio transcription or image generation or completion mode
    {
      name: 'bedrock',
      case: 'bedrock-chat',
      model: 'anthropic.claude-instant-v1',
      options: {
        "bedrock": {
          "aws_region": aws_region
        }
      },
    },
    // bedrock chat but with an ARN
    {
      name: 'bedrock',
      case: 'bedrock-chat-arn',
      model: `arn:aws:bedrock:${aws_region}::foundation-model/anthropic.claude-instant-v1`,
      options: {
        "bedrock": {
          "aws_region": aws_region
        }
      },
    },
    // bedrock rerank
    {
      name: 'bedrock',
      case: 'bedrock-rerank',
      model: `arn:aws:bedrock:${aws_region}::foundation-model/cohere.rerank-v3-5:0`,
      options: {
        "bedrock": {
          "aws_region": aws_region
        }
      },
    }
  ]

  const rerankDocument = [
    "good morning",
    "claim resolved",
    "user claims are resolved within 24 hours",
  ];

  // Create the rerank command
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-agent-runtime/command/RerankCommand/
  const bedrockRerankPayload = new RerankCommand({
    queries: [
      {
        type: "TEXT",
        textQuery: {
          text: "claim"
        }
      }
    ],
    sources: rerankDocument.map(doc => ({
      type: "INLINE",
      inlineDocumentSource: {
        type: "TEXT",
        textDocument: {
          text: doc
        }
      }
    })),
    rerankingConfiguration: {
      type: "BEDROCK_RERANKING_MODEL",
      bedrockRerankingConfiguration: {
        numberOfResults: 3, // Number of top results to return
        modelConfiguration: {
          modelArn: `arn:aws:bedrock:${aws_region}::foundation-model/cohere.rerank-v3-5:0`,
        },
      }
    }
  });

  const vertexRerankPayload = {
    model: "abc",
    // vertexRerankClient.rankingConfigPath('gcp-sdet-test', 'global', 'default'),
    rankingConfig: "projects/gcp-sdet-test/locations/global/rankingConfigs/default",
    records: rerankDocument.map(doc => ({
      id: `RECORD_ID_${rerankDocument.indexOf(doc) + 1}`,
      title: `TITLE_${rerankDocument.indexOf(doc) + 1}`,
      content: doc
    })),
    query: 'claim',
  }

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })

  const path = '/ai_proxy_test'
  // for rerank client, that doesn't support custom paths
  const pathGcp = '/v1/projects/gcp-sdet-test';
  const promptText = "return plain text to print word 'kong_strong' exactly 3 times, no variations, just the exact text";

  let serviceId: string
  let pluginId: string
  let geminiAI: GoogleGenAI
  let vertexAI: GoogleGenAI
  let vertexRerankClient: RankServiceClient
  let bedrockClient: BedrockRuntimeClient
  let bedrockAgentClient: BedrockAgentRuntimeClient

  function parseNativeResponse(resp: AxiosResponse<any, any>| RankResponse| GenerateContentResponse| RerankCommandOutput| object, providerCase: string): string {
    logDebug('Parsing response for case: ' + providerCase);
    logDebug('Response structure: '  + JSON.stringify(resp, null, 2));
  
    if (providerCase === 'gemini-chat' || providerCase === 'gemini-vertex-chat') {
      const r = resp as GenerateContentResponse;
      expect(r, 'Response should have candidates property').to.have.property('candidates');
      expect(r.candidates, 'candidates should be an array').to.be.an('array');
      expect(r.candidates, 'candidates array should not be empty').to.not.be.empty;
      expect(r, 'Response should have usageMetadata property').to.have.property('usageMetadata');
      expect(r.usageMetadata, 'Usage should be an object').to.be.an('object');
      expect(r.usageMetadata?.promptTokenCount, 'Input tokens should be greater than 1').to.be.greaterThan(1);
      expect(r.usageMetadata?.candidatesTokenCount, 'Output tokens should be greater than 1').to.be.greaterThan(1);
      expect(r.usageMetadata?.candidatesTokensDetails, 'candidates should be an array').to.be.an('array');
      return r.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else if (providerCase === 'gemini-vertex-rerank') {
      const r = resp as RankResponse;
      expect(r, 'Response should have records property').to.have.property('records');
      expect(r.records, 'Records should be an array').to.be.an('array');
      expect(r.records, 'Records array should not be empty').to.not.be.empty;
      expect(r.records?.[0], 'First record should have id, title, content and score').to.have.all.keys('id', 'title', 'content', 'score');
      expect(r.records?.[0].score, 'Score should be a number').to.be.a('number');
      expect(r.records?.[0].content, 'Content should be a string').to.be.a('string');
      return r.records?.[0].content ?? '';
    } else if (providerCase.startsWith('bedrock-chat')) {
      const r = resp as any; // Bedrock chat doesn't have type, awesome!
      expect(r.metrics, 'metrics should be an object').to.be.an('object');
      expect(r.metrics.latencyMs, 'Metrics latency Ms should be greater than 1').to.be.greaterThan(1);
      expect(r.usage, 'usage should not be an object').to.be.an('object');
      expect(r.usage.outputTokens, 'Output tokens should be greater than 1').to.be.greaterThan(1);
      expect(r.usage.inputTokens, 'Input tokens should be greater than 1').to.be.greaterThan(1);
      return r.output.message.content[0].text;
    } else if (providerCase === 'bedrock-rerank') {
      const r = resp as RerankCommandOutput;
      expect(r.results, 'Results should be an array').to.be.an('array');
      expect(r.results, 'Results array should have 3 elements').to.ofSize(3);
      expect(r.results?.[0].index, 'First result should have index').to.equal(1); // this is deterministic
      expect(r.results?.[0].relevanceScore, 'First result should have relevanceScore').to.be.a('number');
      return '';
    }
    throw new Error(`Unsupported case: ${providerCase}`);
  }

  function handleNormalError(err: any, providerCase: string): void {
    if (err instanceof Error) {
      if (err.message.includes('location is not supported')) {
        console.warn('Non-critical error: location is not supported. Skipping failure.');
        return;
      } else if (err.message.includes('The upstream server is timing out')) {
        console.warn('Received expected 504 timeout, skipping failure');
        return;
      } else if (err.message.includes('Rate limit exceeded')) {
        console.error(`Rate limit exceeded for ${providerCase} provider`);
        return;
      }
    }
  
    // Log and re-throw other errors
    console.error(`Error during request for ${providerCase} provider:`, err);
    throw err; // Re-throw the error to fail the test
  }

  before(async function () {
    // add header to every axios request in this suite
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate'

    //create a service and route for use with plugin
    const service = await createGatewayService('ai-test-service')
    serviceId = service.id
    await createRouteForService(serviceId, [path, pathGcp])
    // Initialize the GoogleGenAI client with a custom endpoint pointing to Kong Gateways
    geminiAI = new GoogleGenAI({
      apiKey: vars.ai_providers.GEMINI_API_KEY,
      httpOptions: {
        baseUrl: `${proxyUrl}/${path}`, 
      },
    });
    // Initialize the Vertex AI client with a custom endpoint pointing to Kong Gateway
    vertexAI = new GoogleGenAI({
      httpOptions: {
        baseUrl: `${proxyUrl}/${path}`,
      },
      project: 'gcp-sdet-test',
      location: 'us-central1',
      vertexai: true,
      googleAuthOptions: {
        credentials: JSON.parse(`${vars.ai_providers.VERTEX_API_KEY}`),
      },
    });
    // Initialize the RankServiceClient for reranking
    vertexRerankClient = new RankServiceClient({
      // parse the host
      apiEndpoint: new URL(proxyUrl).host,
      port: parseInt(new URL(proxyUrl).port),
      protocol: new URL(proxyUrl).protocol.replace(':', ''), // 'http' or 'https'
      fallback: true, // HTTP/1.1 Rest
      // googlecloud SDK requires this, so we may not be able to test delegated auth in native format
      credentials: JSON.parse(`${vars.ai_providers.VERTEX_API_KEY}`),
    });
    // Initialize the Bedrock client with a custom endpoint pointing to Kong Gateway
    bedrockClient = new BedrockRuntimeClient({
      region: aws_region,
      endpoint: `${proxyUrl}/${path}`,
    });
    bedrockAgentClient = new BedrockAgentRuntimeClient({
      region: aws_region,
      endpoint: `${proxyUrl}/${path}`,
    });
  })

  providers.forEach((provider) => {

    const pluginPayload = {
      name: 'ai-proxy-advanced',
      service: { id: '' },
      config: {
        llm_format: provider.name,
        targets: [{
          model: {
            name: provider.model,
            provider: provider.name || {},
            options: provider.options || {}
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
            aws_access_key_id: `${vars.aws.AWS_ACCESS_KEY_ID}`,
            aws_secret_access_key: `${vars.aws.AWS_SECRET_ACCESS_KEY}`,
            header_name: provider.auth_header || null,
            header_value: provider.auth_key || null,
            gcp_use_service_account: provider.case.includes('gemini-vertex'),
            gcp_service_account_json: `${vars.ai_providers.VERTEX_API_KEY}`,
          },
          logging: {
            log_statistics: false,
            log_payloads: false
          },
          route_type: 'llm/v1/chat',
        }],
        model_name_header: true
      }
    }

    it(`should create AI proxy plugin using ${provider.case} provider and.model ${provider.model} model`, async function () {
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

      await waitForConfigRebuild();
    })

    //tests for gemini and bedrock native formats
    it(`should send ${provider.case} native format API request and verify response`, async function () {
      let responseText = '';
      if (provider.case === 'gemini-chat') {
        try {
          const resp = await geminiAI.models.generateContent({
            model: provider.model,
            contents: promptText,
          });
          parseNativeResponse(resp, provider.case);
        } catch (err) {
          handleNormalError(err, provider.case);
        }
      } else if (provider.case === 'gemini-vertex-chat') {
        try {
          const resp = await vertexAI.models.generateContent({
            model: provider.model,
            contents: promptText,
          });
          parseNativeResponse(resp, provider.case);
        } catch (err) {
          handleNormalError(err, provider.case);
        }
      } else if (provider.case === 'gemini-vertex-rerank') {
        try {
          const resp = await vertexRerankClient.rank(vertexRerankPayload)
          parseNativeResponse(resp[0], provider.case);
        } catch (err) {
          handleNormalError(err, provider.case);
        }
      } else if (provider.case.startsWith('bedrock-chat')) {
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
              modelId: provider.model,
            })
          );

          // Decode and parse the response
          const decodedResponseBody = new TextDecoder().decode(resp.body);
          const responseBody = JSON.parse(decodedResponseBody);

          // Validate the response
          responseText = parseNativeResponse(responseBody, provider.case);
        } catch (err) {
          handleNormalError(err, provider.case);
        }
      } else if (provider.case === 'bedrock-rerank') {
        try {
          const resp = await bedrockAgentClient.send(
            bedrockRerankPayload
          );

          parseNativeResponse(resp, provider.case);
        } catch (err) {
          handleNormalError(err, provider.case);
        }
      }

      if (responseText !== '') {
        matchOccurrences(responseText, 'kong_strong', 3, 'gte');
      }

    });

    it(`should be able to patch the plugin to force streaming of responses for ${provider.case} AI proxy plugin`, async function () {
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

      await waitForConfigRebuild()
    })

    it(`should be able to send message to ${provider.case} AI model ${provider.case} via route with streaming enabled`, async function () {
      if (provider.case.startsWith('bedrock-chat')) { // Skip streaming test for Bedrock due to AG-270
        console.warn(`Skipping streaming test for ${provider.case} due to known issue (AG-270).`);
        return;
      }

       if (provider.case === 'gemini-vertex-rerank' || provider.case === 'bedrock-rerank') { // Skip streaming test beceause rerank does not support streaming
        return;
      }

      let responseText = '';

      if (provider.case === 'gemini-chat') {
        try {
          const resp = await geminiAI.models.generateContentStream({
            model: provider.model,
            contents: promptText,
          });
          responseText = '';

          for await (const chunk of resp) {
            console.log(chunk.text);
            responseText += chunk.text;
          }
        } catch (err) {
          handleNormalError(err, provider.case);
        }
      } else if (provider.case === 'gemini-vertex-chat') {
        try {
          const resp = await vertexAI.models.generateContentStream({
            model: provider.model,
            contents: promptText,
          });
          responseText = '';

          for await (const chunk of resp) {
            console.log(chunk.text);
            responseText += chunk.text;
          }
        } catch (err) {
          handleNormalError(err, provider.case);
        }
      } else if (provider.case.startsWith('bedrock-chat')) {
        try {
          logDebug('Sending request to AWS Bedrock...');
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

          logDebug('Payload being sent to Bedrock: ' + JSON.stringify(payload, null, 2));

          const command = new InvokeModelWithResponseStreamCommand({
            contentType: "application/json",
            body: JSON.stringify(payload),
            modelId: provider.model,
          });

          const resp = await bedrockClient.send(command);

          console.log('Response body of stream bedrock is: ' + resp.body);
          let completeMessage = '';
          expect(resp.body, 'Response body should be a stream').is.not.null;

          if (resp.body) {
            for await (const item of resp.body) {
              logDebug('Stream item: ' + item); // Log each emitted item
              console.log('>>>>> Stream item: ', item);
              if (item.chunk) {
                const chunk = JSON.parse(new TextDecoder().decode(item.chunk.bytes));
                logDebug('Decoded chunk: ' + chunk); // Log the decoded chunk
                const chunk_type = chunk.type;
            
                if (chunk_type === "content_block_delta") {
                  const text = chunk.delta.text;
                  completeMessage = completeMessage + text;
                }
              } else {
                console.warn('Item does not contain a chunk:', item);
              }
            }
          }

          logDebug('Full streamed response: ' + completeMessage);
          // Ensure the full response is not empty
          if (!completeMessage.trim()) {
            throw new Error('Full response is empty');
          }else {
            // Parse the full response and validate
            responseText = JSON.parse(completeMessage);
            logDebug('Parsed response body: ' + JSON.stringify(responseText, null, 2));
          }
        } catch (err) {
          handleNormalError(err, provider.case);
        }
      }

      if (responseText !== '') {
        matchOccurrences(responseText, 'kong_strong', 3, 'gte');
      }
    })

    it(`should delete AI proxy plugin for ${provider.case}`, async function () {
      const resp = await axios({
        method: 'delete',
        url: `${adminUrl}/services/${serviceId}/plugins/${pluginId}`
      })
      logResponse(resp)
      expect(resp.status, 'Should have 204 status code').to.equal(204)

      await waitForConfigRebuild();
    })
  })

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await clearAllKongResources()
  });
});
