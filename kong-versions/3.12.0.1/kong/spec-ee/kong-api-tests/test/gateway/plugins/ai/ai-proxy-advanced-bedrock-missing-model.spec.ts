import axios from 'axios';
import {
  expect,
  createGatewayService,
  createRouteForService,
  createPlugin,
  clearAllKongResources,
  waitForConfigRebuild,
  getBasePath,
  isGateway,
  Environment,
  logResponse,
  logSDKResponse,
  retryAIRequest,
  retrySDKRequest,
  vars,
} from '@support';
import {
  BedrockAgentRuntimeClient, 
  RerankCommand, 
  RerankCommandOutput 
} from '@aws-sdk/client-bedrock-agent-runtime';

describe('@ai: Gateway Plugins: AI Proxy Advanced Bedrock Validation', function () {
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });
  const routeBadPath = '/ai-bedrock-missing-model';
  const routePath = '/model/anthropic.claude-3-haiku-20240307-v1:0/converse';
  const rerankPath = '/rerank';
  const aws_region = 'ap-northeast-1';
  let serviceId: string;

  before(async function () {
    const service = await createGatewayService('bedrock-missing-model-service');
    serviceId = service.id;
    await createRouteForService(serviceId, [routePath, routeBadPath, rerankPath]);

    await createPlugin({
      name: 'ai-proxy-advanced',
      service: { id: serviceId },
      config: {
        balancer: {
          algorithm: 'round-robin',
          latency_strategy: 'tpot',
          retries: 5,
          slots: 1000,
          hash_on_header: 'X-Kong-LLM-Request-ID',
          failover_criteria: ['error', 'timeout'],
          connect_timeout: 60000,
          read_timeout: 60000,
          write_timeout: 60000,
        },
        genai_category: 'text/generation',
        llm_format: 'bedrock',
        max_request_body_size: 8192,
        model_name_header: true,
        response_streaming: 'allow',
        targets: [
          {
            description: 'bedrock-missing-model',
            route_type: 'llm/v1/chat',
            logging: {
              log_statistics: false,
              log_payloads: false,
            },
            auth: {
              allow_override: false,
              azure_use_managed_identity: false,
              aws_access_key_id: vars.aws.AWS_ACCESS_KEY_ID,
              aws_secret_access_key: vars.aws.AWS_SECRET_ACCESS_KEY,
            },
            model: {
              provider: 'bedrock',
              options: {
                bedrock: {
                  aws_region: aws_region,
                },
              },
            },
            weight: 100,
          },
        ],
      },
    });

    await waitForConfigRebuild();
  });

  it('accepts Bedrock requests when model name is provided in path', async function () {
    const makeRequest = () =>
      axios({
        method: 'post',
        url: `${proxyUrl}${routePath}`,
        data: {
          messages: [
            {
              role: 'user',
              content: [{ text: 'Hello, world!' }],
            },
          ],
        },
        validateStatus: null,
      });

    await retryAIRequest(
      makeRequest,
      resp => {
        logResponse(resp);
        expect(resp.status).to.equal(200);
        return resp;
      },
      'bedrock',
    );
  });

  it('rejects Bedrock requests when model name is not in path', async function () {
    const resp = await axios({
      method: 'post',
      url: `${proxyUrl}${routeBadPath}`,
      data: {
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello, world!' }],
          },
        ],
      },
      validateStatus: null,
    });

    logResponse(resp);
    expect(resp.status).to.equal(400);
  });

  it('accepts Bedrock Agent Runtime requests with model in request body (rerank operation)', async function () {
    // Create Bedrock Agent Runtime client pointing to Kong Gateway
    const bedrockAgentClient = new BedrockAgentRuntimeClient({
      region: aws_region,
      endpoint: `${proxyUrl}${rerankPath}`,
    });

    const rerankDocument = ['good morning', 'claim resolved', 'user claims are resolved within 24 hours'];

    // Create the rerank command with model ARN in the request body
    const rerankPayload = new RerankCommand({
      queries: [
        {
          type: 'TEXT',
          textQuery: {
            text: 'claim',
          },
        },
      ],
      sources: rerankDocument.map(doc => ({
        type: 'INLINE',
        inlineDocumentSource: {
          type: 'TEXT',
          textDocument: {
            text: doc,
          },
        },
      })),
      rerankingConfiguration: {
        type: 'BEDROCK_RERANKING_MODEL',
        bedrockRerankingConfiguration: {
          numberOfResults: 3,
          modelConfiguration: {
            modelArn: `arn:aws:bedrock:${aws_region}::foundation-model/cohere.rerank-v3-5:0`,
          },
        },
      },
    });

    const makeRequest = () => bedrockAgentClient.send(rerankPayload);

    await retrySDKRequest(
      makeRequest,
      (resp: RerankCommandOutput) => {
        logSDKResponse(resp, 'RerankCommand');

        // Validate the response
        expect(resp.results, 'Results should be an array').to.be.an('array');
        expect(resp.results, 'Results array should have 3 elements').to.have.lengthOf(3);
        expect(resp.results?.[0], 'First result should have index and relevanceScore').to.have.property('index');
        expect(resp.results?.[0], 'First result should have relevanceScore').to.have.property('relevanceScore');
        expect(resp.results?.[0].relevanceScore, 'Relevance score should be a number').to.be.a('number');

        return resp;
      },
      {
        provider: 'bedrock',
        timeout: 70000,
        interval: 5000,
      },
    );
  });

  after(async function () {
    await clearAllKongResources();
  });
});
