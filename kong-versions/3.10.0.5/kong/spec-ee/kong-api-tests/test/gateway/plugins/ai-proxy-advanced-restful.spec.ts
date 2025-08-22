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
    retryAIRequest
} from '@support'
import _ from 'lodash';
import FormData from 'form-data';
import axios from 'axios';
import * as fs from 'fs';

// This test verify the responses functionality of the AI Proxy advanced plugin with Openai llm format.
describe('Gateway Plugins: AI Proxy Advanced Restful Endpoints Test', function () {

    const sampleText = "Tell me a short joke about programming in 20 words.";

    const adminUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
    });
    const proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
    })

    let serviceId: string;

    // Define a type for the providers
    type restfulEntitiesProvider = 'openai' | 'azure';

    // Use typed keys
    const providers: restfulEntitiesProvider[] = ['openai', 'azure'];

    // Define a type for the restful entities
    type restfulEntity = 'responses' | 'files' | 'batches' | 'assistants';

    type restfulOperations = 'create' | 'get' | 'list' | 'delete';
    type specialOperations = 'inputItems' | 'cancel' | 'content';

    const ENTITY_TEST_FLOWS: Record<restfulEntity, {
        operations: restfulOperations[];
        specialOperations: specialOperations[];
        azureAPIVersion: string;
        validator: (resp: any, provider?: restfulEntitiesProvider, operationType?: string) => any;
        payloadGenerator: (provider) => Record<string, any>;
    }> = {
        responses: {
            operations: ['create', 'get'],           // No list endpoint
            specialOperations: ['inputItems'],       // Get input items
            azureAPIVersion: 'preview',
            validator: validateResponsesApiResponse,
            payloadGenerator: () => {
                return {
                    data: {
                        input: sampleText,
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    },
                };
            },
        },
        files: {
            operations: ['create', 'get', 'list', 'delete'],
            specialOperations: ['content'],             // Get file content
            azureAPIVersion: '2025-04-28',
            validator: validateFilesApiResponse,
            payloadGenerator: (provider) => {
                // this needs to be created fresh otherwise the second request will fail
                const filesPayload = new FormData();
                const filePath = getDataFilePath(`ai/batch-${provider}.jsonl`);
                filesPayload.append('file', fs.createReadStream(filePath), 'batch.jsonl');
                filesPayload.append('purpose', 'batch');

                return {
                    data: filesPayload,
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${filesPayload.getBoundary()}`
                    },
                };
            }
        },
        batches: {
            operations: ['create', 'get', 'list'],  // No delete
            specialOperations: ['cancel'],
            azureAPIVersion: '2025-04-28',
            validator: validateBatchesApiResponse,
            payloadGenerator: () => {
                return {
                    data: {
                        endpoint: "/v1/chat/completions",
                        completion_window: "24h",
                    },
                    headers: {
                        'Content-Type': 'application/json',
                    },
                };
            }
        },
        assistants: {
            operations: ['create', 'get', 'list', 'delete'],
            specialOperations: [],
            azureAPIVersion: '2024-08-01-preview',
            validator: validateAssistantsApiResponse,
            payloadGenerator: () => {
                return {
                    data: {
                        name: "some name",
                    },
                    headers: {
                        'Content-Type': 'application/json',
                        'OpenAI-Beta': 'assistants=v2',
                    },
                };
            }
        }
    };

    // Use typed keys for entities
    const entities : restfulEntity[] = Object.keys(ENTITY_TEST_FLOWS) as restfulEntity[];

    const targetModels = {
        openai: "gpt-4.1",
        azure: "gpt-4.1-mini"
    };

    const pluginPayload = {
        config: {
            max_request_body_size: 1024000,
            genai_category: "text/generation",
            llm_format: 'openai', //using openai format for restful entities
            model_name_header: true,
            response_streaming: 'allow',
            targets: [] as Array<Record<string, any>>,
            balancer: {
                latency_strategy: 'tpot',
                retries: 5,
                slots: 1000,
                failover_criteria: [
                    'error',
                    'timeout'
                ],
                connect_timeout: 60000,
                read_timeout: 60000,
                write_timeout: 60000
            }
        },
        name: 'ai-proxy-advanced'
    };

    // Factory function for generating target configurations
    function createRestfulTarget(provider: restfulEntitiesProvider, entity: restfulEntity) {
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
                    name: targetModels.openai,
                    options: {},
                    provider: "openai"
                },
                route_type: `llm/v1/${entity}`
            },
            azure: {
                auth: {
                    header_name: "api-key",
                    header_value: vars.ai_providers.AZUREAI_API_KEY,
                },
                model: {
                    name: targetModels.azure,
                    options: {
                        azure_instance: "ai-gw-sdet-e2e-test",
                        azure_deployment_id: targetModels.azure,
                        azure_api_version: ENTITY_TEST_FLOWS[entity].azureAPIVersion,
                    },
                    provider: "azure"
                },
                route_type: `llm/v1/${entity}`
            }
        };

        // Combine configurations
        return {
            ...baseConfig,
            ...providerConfigs[provider]
        };
    }


    // Function to create entity request
    async function createRestfulEntity(url: string, entityType: restfulEntity, provider: restfulEntitiesProvider, dynamicFields?: Record<string, any>) {
        const payload = ENTITY_TEST_FLOWS[entityType].payloadGenerator(provider)

        for (const key in dynamicFields) {
            payload.data[key] = dynamicFields[key];
        }

        const resp = await axios({
            method: 'post',
            url: url,
            data: payload.data,
            headers: payload.headers,
            validateStatus: null
        });
        return resp;
    }

    // Function to get entity request
    async function getRestfulEntity(url: string, entityId: string) {
        if (!entityId) {
            throw new Error('Entity ${entity} ID is required for getResponse');
        }

        let headers;
        if (url.includes('assistants')) {
            headers = {
                'OpenAI-Beta': 'assistants=v2',
            };
        } else if (url.includes('files')) {
            headers = {
                'Accept-Encoding': 'identity',
            };
        }

        const resp = await axios({
            method: 'get',
            url: `${url}/${entityId}`,
            headers: headers,
            validateStatus: null
        });
        return resp;
    }

    // Function to list entity request
    async function listRestfulEntity(url: string) {
        let headers = {};
        if (url.includes('assistants')) {
            headers = {
                'OpenAI-Beta': 'assistants=v2',
            };
        }

        const resp = await axios({
            method: 'get',
            url: `${url}?limit=5`,
            headers: headers,
            validateStatus: null
        });
        return resp;
    }

    // Function to delete entity request
    async function deleteRestfulEntity(url: string, entityId: string) {
        if (!entityId) {
            throw new Error('Entity ${entity} ID is required for deleteResponse');
        }

        let headers = {};
        if (url.includes('assistants')) {
            headers = {
                'OpenAI-Beta': 'assistants=v2',
            };
        }

        const resp = await axios({
            method: 'delete',
            url: `${url}/${entityId}`,
            headers: headers,
            validateStatus: null
        });
        return resp;
    }

    // Function to get response input item request
    async function getResponseInputItem(url: string, entityId: string, provider: restfulEntitiesProvider) {
        const apiVersionParam = provider === 'azure' ? '?api-version=preview' : '';

        if (!entityId) {
            throw new Error('Entity ${entity} ID is required for getResponseInputItem');
        }

        const resp = await axios({
            method: 'get',
            url: `${url}/${entityId}/input_items${apiVersionParam}`,
            headers: {
                'Content-Type': 'application/json'
            },
            validateStatus: null
        });
        return resp;
    }

    // Function to validate files API responses with detailed checks
    function validateResponsesApiResponse(resp: any, provider = 'unknown', operationType = 'create') {
        // Universal check for all operations
        expect(resp.status, `${provider} response should be successful`).to.equal(200);
        expect(resp.data, 'Response should be an object').to.be.an('object');
        
        // Log response for debugging
        logDebug(`${operationType} response from ${provider}: ${JSON.stringify(resp.data, null, 2)}`);

        let data = resp.data

        // Different validations based on operation type
        switch (operationType) {
            case 'create':
            case 'get':
            case 'list':
                if (operationType === 'list') {
                    expect(resp.data, 'Data should be an array').to.be.an('array');
                    expect(resp.object, 'Response object should be "list"').to.equal('list');
                    data = resp.data[0]; // For list, we take the first item for validation
                }
                // Universal checks for create/get operations
                expect(data, 'Response should have id property').to.have.property('id');
                expect(data, 'Response should have output property').to.have.property('output');

                if (operationType === 'list') {
                    break;
                }

                expect(data.output, 'Output should be an array').to.be.an('array');
                expect(data.output, 'Output array should not be empty').to.not.be.empty;
                
                // Universal token usage validation (if available)
                if (data.usage) {
                    expect(data.usage, 'Usage should be an object').to.be.an('object');
                    
                    // Log token usage details
                    logDebug(`Token Usage - Input: ${data.usage.input_tokens || 'N/A'}, ` +
                           `Output: ${data.usage.output_tokens || 'N/A'}, ` + 
                           `Total: ${data.usage.total_tokens || 'N/A'}`);
                    
                    // Token counts should be present
                    if (data.usage.output_tokens) {
                        expect(data.usage.input_tokens, 'Input tokens should be greater than 0').to.be.greaterThan(1);
                        expect(data.usage.output_tokens, 'Output tokens should be greater than 0').to.be.greaterThan(1);
                    }
                }
                break;
                
            case 'inputItems':
                expect(data, 'Response should have data property').to.have.property('data');
                expect(data.data, 'Data should be an array').to.be.an('array');                
                break;
                
            case 'delete':
                expect(data, 'Response should have id property').to.have.property('id');
                expect(data, 'Response should have deleted property').to.have.property('deleted');
                expect(data.deleted, 'Deleted should be true').to.be.true;
                
                // Log deletion confirmation
                logDebug(`Delete confirmation - ID: ${data.id}, Object: ${data.object}, Deleted: ${data.deleted}`);
                break;
            default:
                throw new Error(`Unknown operation type: ${operationType}`);
        }
        return resp.data;
    }

    // Function to validate files API responses with detailed checks
    function validateFilesApiResponse(resp: any, provider = 'unknown', operationType = 'create') {
        // Universal check for all operations
        let statusCode = 200;
        if (operationType === 'create' && provider === 'azure') {
            statusCode = 201;
        }
        expect(resp.status, `${provider} response should be successful`).to.equal(statusCode);
        expect(resp.data, 'Response should be an object').to.be.an('object');
        
        // Log response for debugging
        logDebug(`${operationType} response from ${provider}: ${JSON.stringify(resp.data, null, 2)}`);

        let data = resp.data
        // Different validations based on operation type
        switch (operationType) {
            case 'create':
            case 'get':
            case 'list':
                if (operationType === 'list') {
                    expect(data.data, 'Data should be an array').to.be.an('array');
                    expect(data.object, 'Response object should be "list"').to.equal('list');
                    data = data.data[0]; // For list, we take the first item for validation
                }
                // Universal checks for create/get operations
                expect(data.object, 'Response object should be "file"').to.equal('file');
                expect(data.purpose, 'Response purpose should be "batch"').to.equal('batch');
                expect(data.bytes, 'Response bytes should be a number').to.be.a('number');
                expect(data.filename, 'Filename should not be empty').to.not.be.empty;
                break;
                
            case 'delete':
                expect(data, 'Response should have id property').to.have.property('id');
                expect(data, 'Response should have deleted property').to.have.property('deleted');
                expect(data.object, 'Response object should be "file"').to.equal('file');
                expect(data.deleted, 'Deleted should be true').to.be.true;
                
                // Log deletion confirmation
                logDebug(`Delete confirmation - ID: ${data.id}, Object: ${data.object}, Deleted: ${data.deleted}`);
                break;
                
            default:
                throw new Error(`Unknown operation type: ${operationType}`);
        }

        return resp.data;
    }

    // Function to validate batches API responses with detailed checks
    function validateBatchesApiResponse(resp: any, provider = 'unknown', operationType = 'create') {
        // Universal check for all operations
        expect(resp.status, `${provider} response should be successful`).to.equal(200);
        expect(resp.data, 'Response should be an object').to.be.an('object');
        
        // Log response for debugging
        logDebug(`${operationType} response from ${provider}: ${JSON.stringify(resp.data, null, 2)}`);

        let data = resp.data

        // Different validations based on operation type
        switch (operationType) {
            case 'create':
            case 'get':
            case 'list':
                if (operationType === 'list') {
                    expect(data.data, 'Data should be an array').to.be.an('array');
                    if (provider === 'openai') { // only openai has this
                        expect(data.object, 'Response object should be "list"').to.equal('list');
                    }
                    data = data.data[0]; // For list, we take the first item for validation
                }
                // Universal checks for create/get operations
                expect(data, 'Response should have id property').to.have.property('id');
                expect(data, 'Response should have status property').to.have.property('status');
                break;

            // TODO: cancel

            default:
                throw new Error(`Unknown operation type: ${operationType}`);
        }
        return resp.data;
    }

    // Function to validate assistants API responses with detailed checks
    function validateAssistantsApiResponse(resp: any, provider = 'unknown', operationType = 'create') {
        // Universal check for all operations
        expect(resp.status, `${provider} response should be successful`).to.equal(200);
        expect(resp.data, 'Response should be an object').to.be.an('object');
        
        // Log response for debugging
        logDebug(`${operationType} response from ${provider}: ${JSON.stringify(resp.data, null, 2)}`);

        let data = resp.data

        // Different validations based on operation type
        switch (operationType) {
            case 'create':
            case 'get':
            case 'list':
                if (operationType === 'list') {
                    expect(data.data, 'Data should be an array').to.be.an('array');
                    expect(data.object, 'Response object should be "list"').to.equal('list');
                    data = data.data[0]; // For list, we take the first item for validation
                }
                // Universal checks for create/get operations
                expect(data, 'Response should have id property').to.have.property('id');
                expect(data, 'Response should have name property').to.have.property('name');
                break;
                
            case 'delete':
                expect(data, 'Response should have id property').to.have.property('id');
                expect(data.deleted, 'Deleted should be true').to.be.true;
                
                // Log deletion confirmation
                logDebug(`Delete confirmation - ID: ${data.id}, Object: ${data.object}, Deleted: ${data.deleted}`);
                break;
                
            default:
                throw new Error(`Unknown operation type: ${operationType}`);
        }
        return resp.data;
    }

    before(async function () {
        const service = await createGatewayService('ai-restful-test-service');
        serviceId = service.id;
    })

    it(`should create AI proxy advanced plugin with all targets for restful entities test`, async function () {
        await waitForConfigRebuild();
        await Promise.all(providers.map(async (provider) => {
            await Promise.all(entities.map(async (entity) => {
                const route = await createRouteForService(serviceId, [`/${provider}/${entity}`]);
                const targetPayload = _.cloneDeep(pluginPayload);
                const target_per_provider = createRestfulTarget(provider, entity);

                targetPayload.config.targets = [target_per_provider];
                targetPayload.config.model_name_header = entity === 'responses'; // Only set for responses entity

                const resp = await axios({
                    method: 'post',
                    url: `${adminUrl}/routes/${route.id}/plugins`,
                    data: targetPayload,
                    validateStatus: null
                });

                logResponse(resp);

                expect(resp.status, 'Status should be 201').to.equal(201);
                expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');
            }));
        }));
        await waitForConfigRebuild();
    });

    // Create targets for each provider
    providers.forEach((provider) => {
        entities.forEach((entity) => {

            let entityId = '';
            const validate = ENTITY_TEST_FLOWS[entity].validator;
            const routePath = `/${provider}/${entity}`;

            if (ENTITY_TEST_FLOWS[entity].operations.includes('create')) {
                it(`should successfully create ${entity} from ${provider} via ai-proxy-advanced plugin`, async function () {
                    const dynamicFields = {};
                    if (entity === 'batches') {
                        const makeRequest = () => createRestfulEntity(
                            `${proxyUrl}/${provider}/files`,
                            'files',
                            provider
                        );

                        const filesValidator = ENTITY_TEST_FLOWS['files'].validator;

                        const responseData = await retryAIRequest(
                            makeRequest,
                            (resp) => filesValidator(resp, provider, 'create'),
                            provider
                        );
                        expect(responseData, 'Files response data should have id property').to.have.property('id');

                        dynamicFields["input_file_id"] = responseData.id;
                    }

                    const makeRequest = () => createRestfulEntity(
                        `${proxyUrl}${routePath}`,
                        entity,
                        provider,
                        dynamicFields
                    );

                    const responseData = await retryAIRequest(
                        makeRequest,
                        (resp) => validate(resp, provider, 'create'),
                        provider
                    );

                    // Extract ID from the returned data
                    entityId = responseData.id;
                    
                    // Verify we got a entity ${entity} ID
                    expect(entityId, 'Entity ${entity} ID should be present').to.exist;
                    
                    // Log the ID for debugging
                    logDebug(`Created entity ${entity} ID: ${entityId}`);
                });
            }

            if (ENTITY_TEST_FLOWS[entity].operations.includes('get')) {
                it(`should successfully get created ${entity} from ${provider} via ai-proxy-advanced plugin`, async function () {
                    expect(entityId, 'Entity ${entity} ID should be available from previous test').to.exist;
                    expect(entityId, 'Entity ${entity} ID should not be null').to.not.equal('');

                    const makeRequest = () => getRestfulEntity(
                        `${proxyUrl}${routePath}`,
                        entityId
                    );

                    await retryAIRequest(
                        makeRequest,
                        (resp) => validate(resp, provider, 'get'),
                        provider
                    );
                });
            }

            if (ENTITY_TEST_FLOWS[entity].operations.includes('list')) {
                it(`should successfully list ${entity} from ${provider} via ai-proxy-advanced plugin`, async function () {
                    const makeRequest = () => listRestfulEntity(
                        `${proxyUrl}${routePath}`
                    );

                    await retryAIRequest(
                        makeRequest,
                        (resp) => validate(resp, provider, 'list'),
                        provider
                    );
                });
            }

            // entity specific test

            if (ENTITY_TEST_FLOWS[entity].specialOperations.includes('inputItems')) {
                it(`should successfully get input items from created ${entity} from ${provider} via ai-proxy-advanced plugin`, async function () {
                    expect(entityId, 'Entity ${entity} ID should be available from previous test').to.exist;
                    expect(entityId, 'Entity ${entity} ID should not be null').to.not.equal('');

                    const makeRequest = () => getResponseInputItem(
                        `${proxyUrl}${routePath}`,
                        entityId,
                        provider
                    );

                    await retryAIRequest(
                        makeRequest,
                        (resp) => validate(resp, provider, 'inputItems'),
                        provider
                    );
                });
            }

            if (ENTITY_TEST_FLOWS[entity].specialOperations.includes('content')) {  
                it(`should successfully get content from created ${entity} from ${provider} via ai-proxy-advanced plugin`, async function () {
                    expect(entityId, 'Entity ${entity} ID should be available from previous test').to.exist;
                    expect(entityId, 'Entity ${entity} ID should not be null').to.not.equal('');

                    const makeRequest = () => getRestfulEntity(
                        `${proxyUrl}${routePath}`,
                        `${entityId}/content`
                    );
                    await retryAIRequest(
                        makeRequest,
                        // content returns non JSON
                        (resp) => {
                            expect(resp, 'Response should have data property').to.have.property('data');
                            expect(resp.data, 'Data to contain the file content we uploaded').to.include('You are an unhelpful assistant.');
                        },
                        provider
                    );
                });
            }
            
            if (ENTITY_TEST_FLOWS[entity].specialOperations.includes('cancel')) {  
                it.skip(`should successfully cancel ${entity} from ${provider} via ai-proxy-advanced plugin`, async function () {
                    // TODO
                });
            }

            // TODO: metrics

            // Note: Order matters here, delete should be last
            if (ENTITY_TEST_FLOWS[entity].operations.includes('delete')) {
                it(`should successfully delete created ${entity} from ${provider} via ai-proxy-advanced plugin`, async function () {
                    expect(entityId, 'Entity ${entity} ID should be available from previous test').to.exist;
                    expect(entityId, 'Entity ${entity} ID should not be null').to.not.equal('');
                    const makeRequest = () => deleteRestfulEntity(
                        `${proxyUrl}${routePath}`,
                        entityId
                    );

                    await retryAIRequest(
                        makeRequest,
                        (resp) => validate(resp, provider, 'delete'),
                        provider
                    );
                });
            }

        });

    });


});


after(async function () {
    await clearAllKongResources();
});
