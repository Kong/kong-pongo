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
    retryAIRequest
} from '@support'
import _ from 'lodash';
import axios from 'axios';

// This test verify the responses functionality of the AI Proxy advanced plugin with Openai llm format.
describe('Gateway Plugins: AI Proxy Advanced Responses Test', function () {

    const sampleText = "Tell me a short joke about programming.";

    const adminUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
    });
    const proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
    })
    const routePath = '/v1/responses';

    let serviceId: string;
    let pluginId: string;

    // Define a type for the providers
    type responsesProvider = 'openai' | 'azure';

    // Use typed keys
    const providers: responsesProvider[] = ['openai', 'azure'];

    const responses_models = {
        openai: "gpt-4.1",
        azure: "gpt-4.1-mini"
    };

    const pluginPayload = {
        config: {
            max_request_body_size: 8192,
            genai_category: "text/generation",
            llm_format: 'openai', //using openai format for image gen and edit
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
                route_type: "llm/v1/responses"
            },
            azure: {
                auth: {
                    header_name: "api-key",
                    header_value: vars.ai_providers.AZUREAI_API_KEY,
                },
                model: {
                    name: responses_models.azure,
                    options: {
                        azure_instance: "ai-gw-sdet-e2e-test",
                        azure_deployment_id: responses_models.azure,
                        azure_api_version: "preview",
                    },
                    provider: "azure"
                },
                route_type: "llm/v1/responses"
            }
        };

        // Combine configurations
        return {
            ...baseConfig,
            ...providerConfigs[provider]
        };
    }


    // Function to create response request
    async function createResponse(url: string, text: string, provider: responsesProvider) {
        const apiVersionParam = provider === 'azure' ? '?api-version=preview' : '';
        const fullUrl = `${url}${apiVersionParam}`;

        const resp = await axios({
            method: 'post',
            url: fullUrl,
            data: {
                input: text
            },
            headers: {
                'Content-Type': 'application/json'
            },
            validateStatus: null
        });
        return resp;
    }

    // Function to get response request
    async function getResponse(url: string, responseId: string, provider: responsesProvider) {
        const apiVersionParam = provider === 'azure' ? '?api-version=preview' : '';

        if (!responseId) {
            throw new Error('Response ID is required for getResponse');
        }

        const resp = await axios({
            method: 'get',
            url: `${url}/${responseId}${apiVersionParam}`,
            headers: {
                'Content-Type': 'application/json'
            },
            validateStatus: null
        });
        return resp;
    }

    // Function to get response input item request
    async function getResponseInputItem(url: string, responseId: string, provider: responsesProvider) {
        const apiVersionParam = provider === 'azure' ? '?api-version=preview' : '';

        if (!responseId) {
            throw new Error('Response ID is required for getResponseInputItem');
        }

        const resp = await axios({
            method: 'get',
            url: `${url}/${responseId}/input_items${apiVersionParam}`,
            headers: {
                'Content-Type': 'application/json'
            },
            validateStatus: null
        });
        return resp;
    }

    // Function to delete response request
    async function deleteResponse(url: string, responseId: string, provider: responsesProvider) {
        const apiVersionParam = provider === 'azure' ? '?api-version=preview' : '';

        if (!responseId) {
            throw new Error('Response ID is required for deleteResponse');
        }

        const resp = await axios({
            method: 'delete',
            url: `${url}/${responseId}${apiVersionParam}`,
            headers: {
                'Content-Type': 'application/json'
            },
            validateStatus: null
        });
        return resp;
    }

    // Function to validate responses API responses with detailed checks
    function validateResponsesApiResponse(resp: any, provider = 'unknown', operationType = 'create') {
        // Universal check for all operations
        expect(resp.status, `${provider} response should be successful`).to.equal(200);
        expect(resp.data, 'Response should be an object').to.be.an('object');
        
        // Log response for debugging
        logDebug(`${operationType} response from ${provider}: ${JSON.stringify(resp.data, null, 2)}`);

        // Different validations based on operation type
        switch (operationType) {
            case 'create':
            case 'get':
                // Universal checks for create/get operations
                expect(resp.data, 'Response should have id property').to.have.property('id');
                expect(resp.data, 'Response should have output property').to.have.property('output');
                expect(resp.data.output, 'Output should be an array').to.be.an('array');
                expect(resp.data.output, 'Output array should not be empty').to.not.be.empty;
                
                // Universal token usage validation (if available)
                if (resp.data.usage) {
                    expect(resp.data.usage, 'Usage should be an object').to.be.an('object');
                    
                    // Log token usage details
                    logDebug(`Token Usage - Input: ${resp.data.usage.input_tokens || 'N/A'}, ` +
                           `Output: ${resp.data.usage.output_tokens || 'N/A'}, ` + 
                           `Total: ${resp.data.usage.total_tokens || 'N/A'}`);
                    
                    // Token counts should be present
                    if (resp.data.usage.output_tokens) {
                        expect(resp.data.usage.input_tokens, 'Input tokens should be greater than 0').to.be.greaterThan(1);
                        expect(resp.data.usage.output_tokens, 'Output tokens should be greater than 0').to.be.greaterThan(1);
                    }
                }
                break;
                
            case 'inputItems':
                expect(resp.data, 'Response should have data property').to.have.property('data');
                expect(resp.data.data, 'Data should be an array').to.be.an('array');                
                break;
                
            case 'delete':
                expect(resp.data, 'Response should have id property').to.have.property('id');
                expect(resp.data, 'Response should have deleted property').to.have.property('deleted');
                expect(resp.data.deleted, 'Deleted should be true').to.be.true;
                
                // Log deletion confirmation
                logDebug(`Delete confirmation - ID: ${resp.data.id}, Object: ${resp.data.object}, Deleted: ${resp.data.deleted}`);
                break;
                
            default:
                throw new Error(`Unknown operation type: ${operationType}`);
        }

        return resp.data;
    }

    before(async function () {
        const service = await createGatewayService('ai-responses-test-service');
        serviceId = service.id;
        await createRouteForService(serviceId, [routePath]);
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
        let responseId = '';

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

        it(`should successfully create responses from ${provider} via ai-proxy-advanced plugin`, async function () {

            const makeRequest = () => createResponse(
                `${proxyUrl}${routePath}`,
                sampleText,
                provider
            );

            const responseData = await retryAIRequest(
                makeRequest,
                (resp) => validateResponsesApiResponse(resp, provider, 'create'),
                provider
            );

            // Extract ID from the returned data
            responseId = responseData.id;
            
            // Verify we got a response ID
            expect(responseId, 'Response ID should be present').to.exist;
            
            // Log the ID for debugging
            logDebug(`Created response ID: ${responseId}`);
        });

        it(`should successfully get created responses from ${provider} via ai-proxy-advanced plugin`, async function () {
            expect(responseId, 'Response ID should be available from previous test').to.exist;
            expect(responseId, 'Response ID should not be null').to.not.equal('');

            const makeRequest = () => getResponse(
                `${proxyUrl}${routePath}`,
                responseId,
                provider
            );

            await retryAIRequest(
                makeRequest,
                (resp) => validateResponsesApiResponse(resp, provider, 'get'),
                provider
            );
        });

        it(`should successfully get input items from created responses from ${provider} via ai-proxy-advanced plugin`, async function () {
            expect(responseId, 'Response ID should be available from previous test').to.exist;
            expect(responseId, 'Response ID should not be null').to.not.equal('');

            const makeRequest = () => getResponseInputItem(
                `${proxyUrl}${routePath}`,
                responseId,
                provider
            );

            await retryAIRequest(
                makeRequest,
                (resp) => validateResponsesApiResponse(resp, provider, 'inputItems'),
                provider
            );
        });

        it(`should successfully delete created responses from ${provider} via ai-proxy-advanced plugin`, async function () {
            expect(responseId, 'Response ID should be available from previous test').to.exist;
            expect(responseId, 'Response ID should not be null').to.not.equal('');
            const makeRequest = () => deleteResponse(
                `${proxyUrl}${routePath}`,
                responseId,
                provider
            );

            await retryAIRequest(
                makeRequest,
                (resp) => validateResponsesApiResponse(resp, provider, 'delete'),
                provider
            );
        });

    });


});


after(async function () {
    await clearAllKongResources();
});
