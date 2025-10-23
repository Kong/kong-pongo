import axios from 'axios'
import {
    expect,
    Environment,
    getBasePath,
    createGatewayService,
    createRouteForService,
    waitForConfigRebuild,
    isGateway,
    clearAllKongResources,
    createPlugin,
    createRoute,
    postNegative,
    confluentConfig,
    logResponse,
    updateConfluentConsumeTopic,
    checkConfluentRecords,
    consumeAndExtractConfluentMessage,
    patchNegative,
    checkGwVars,
    createConfluentTopics,
    deleteConfluentTopics,
    getGatewayContainerLogs,
    eventually,
    patchPlugin,
    randomString,
    isGwHybrid,
    getKongContainerName,
    makeSchemaRegistryConfig,
    createSchema,
    deleteSchemas
} from '@support'


// ********* Note *********
// In order for this test file to successfully run you need to have defined the following environment variables
// CLUSTER_API_KEY : ${{actual CLUSTER_API_KEY value }}
// CLUSTER_API_SECRET : ${{actual CLUSTER_API_SECRET value }}
// CONFLUENT_CLOUD_SR_PASSWORD : ${{actual CONFLUENT_CLOUD_SR_PASSWORD value }}
// ********* End **********

describe.skip('@weekly: Gateway Plugins: Confluent', function () {
    const consumePath = '/consume'
    const logPath = '/log'

    let confluentConsumePluginId: string
    let confluentPluginId: string
    let consumeRouteId: string
    let logRouteId: string

    const adminUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
    })
    const proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
    })

    const output = randomString()
    const confluentTopic = 'confluent-test-' + Date.now() + `-${output}`
    const newTopic = 'confluent-test-update-' + Date.now() + `-${output}`

    const schemaRegistryUrl = confluentConfig.schemaRegistry.url
    const schemaRegistryUsername = confluentConfig.schemaRegistry.username
    const schemaRegistryPassword = confluentConfig.schemaRegistry.password
    const invalidSubjectNameForJson = 'sdet-json-invalid-' + Date.now() + `-${output}`
    const validSubjectNameForJson = 'sdet-json-valid-' + Date.now() + `-${output}`
    const invalidSubjectNameForAvro = 'sdet-avro-invalid-' + Date.now() + `-${output}`
    const validSubjectNameForAvro = 'sdet-avro-valid-' + Date.now() + `-${output}`

    const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();

    before(async function () {
        checkGwVars('confluent');

        await createConfluentTopics([confluentTopic, newTopic])
        // create route to use with confluent-consume to check messages sent to kafka
        const consumeRoute = await createRoute([consumePath], {
            name: 'confluentConsumeRoute',
        })
        consumeRouteId = consumeRoute.id
        // create confluent-consume plugin to check messages sent to kafka
        const confluentConsumePlugin = await createPlugin({
            name: 'confluent-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                bootstrap_servers: [
                    {
                        host: confluentConfig.host,
                        port: confluentConfig.port,
                    },
                ],
                topics: [{'name': confluentTopic}],
                cluster_api_key: confluentConfig.apiKey,
                cluster_api_secret: confluentConfig.apiSecret,
                cluster_name: confluentConfig.clusterName,
            },
        })
        confluentConsumePluginId = confluentConsumePlugin.id

        // create service and route to use in testing
        const service = await createGatewayService('confluentService')
        const serviceId = service.id

        const logRoute = await createRouteForService(serviceId, [logPath], {
            name: 'confluentRoute',
        })
        logRouteId = logRoute.id

        await waitForConfigRebuild()
    })

    it('should not create confluent plugin without topic parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'confluent',
            route: {
                id: logRouteId,
            },
            config: {
                bootstrap_servers: [
                    {
                        host: confluentConfig.host,
                        port: confluentConfig.port,
                    },
                ],
                cluster_api_key: confluentConfig.apiKey,
                cluster_api_secret: confluentConfig.apiSecret,
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.topic: required field missing)'
        )
    })

    it('should not create confluent plugin without cluster_api_key parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'confluent',
            route: {
                id: logRouteId,
            },
            config: {
                topic: confluentTopic,
                bootstrap_servers: [
                    {
                        host: confluentConfig.host,
                        port: confluentConfig.port,
                    },
                ],
                cluster_api_secret: confluentConfig.apiSecret

            },
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.cluster_api_key: required field missing)'
        )
    })

    it('should not create confluent plugin without confluent_cluster_secret parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'confluent',
            route: {
                id: logRouteId,
            },
            config: {
                topic: confluentTopic,
                bootstrap_servers: [
                    {
                        host: confluentConfig.host,
                        port: confluentConfig.port,
                    },
                ],
                cluster_api_key: confluentConfig.apiKey
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.cluster_api_secret: required field missing)'
        )
    })

    it('should create confluent plugin', async function () {
        const resp = await axios({
            method: 'post',
            url: `${adminUrl}/plugins`,
            data: {
                name: 'confluent',
                route: {
                    id: logRouteId,
                },
                config: {
                    topic: confluentTopic,
                    bootstrap_servers: [
                        {
                            host: confluentConfig.host,
                            port: confluentConfig.port,
                        },
                    ],
                    cluster_api_key: confluentConfig.apiKey,
                    cluster_api_secret: confluentConfig.apiSecret,
                    cluster_name: confluentConfig.clusterName,
                },
            },
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 201').to.equal(201)
        expect(resp.data.name, 'Should have correct plugin name').to.equal('confluent')
        expect(resp.data.config.topic, 'Should have correct topic').to.eql(confluentTopic)
        expect(resp.data.config.bootstrap_servers, 'Should have correct bootstrap servers').to.eql([
            {
                host: confluentConfig.host,
                port: confluentConfig.port,
            },
        ])
        confluentPluginId = resp.data.id

        await waitForConfigRebuild()
    })

    it('should be able to send messages with confluent plugin and topic with empty body', async function () {
        // send message via confluent plugin
        const resp = await axios.get(`${proxyUrl}${logPath}`, {validateStatus: null})
        logResponse(resp)

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should indicate that message sent successfully').to.have.property('message', 'message sent')

        // ensure message was successfully sent
        const confluentRecords = await consumeAndExtractConfluentMessage(confluentTopic, consumePath, 80000)
        console.log('Confluent records:', confluentRecords)
        await checkConfluentRecords(confluentRecords, 'body', '')

    })

    it('should be able to send complex body with confluent plugin', async function () {
        // send message via confluent plugin with weird characters
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${logPath}`,
            data: {
                'complex_body': [{
                    'emoji': '💜 💙',
                    'language': '田中さんにあげて下さい',
                    'lua': 'print("hello")',
                }],
            }
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should indicate that message sent successfully').to.have.property(
            'message',
            'message sent'
        )

        // ensure message was successfully sent
        const confluentRecords = await consumeAndExtractConfluentMessage(confluentTopic, consumePath)
        checkConfluentRecords(confluentRecords, 'body', '💜 💙')
        checkConfluentRecords(confluentRecords, 'body', '田中')
        checkConfluentRecords(confluentRecords, 'body', 'print')
    })

    it('should be able to update confluent plugin topic', async function () {
        // update confluent-consume plugin to use new topic
        await updateConfluentConsumeTopic(newTopic, confluentConsumePluginId)

        // update log plugin
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${confluentPluginId}`,
            data: {
                config: {
                    topic: newTopic,
                },
            },
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.topic, 'Should have correct topic').to.contain(newTopic)

        await waitForConfigRebuild()
    })

    it('should be able to send messages with confluent plugin and new topic', async function () {
        const resp = await axios.get(`${proxyUrl}${logPath}`)

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should indicate that message sent successfully').to.have.property('message', 'message sent')

        // ensure message was successfully sent
        const confluentRecords = await consumeAndExtractConfluentMessage(newTopic, consumePath, 80000)
        checkConfluentRecords(confluentRecords, 'body', '""')
    })

    for (const registry of ['confluent']) { // will have appio eventually
        it('should not be able to update confluent plugin with schema registry authentication and no username or password', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: {
                        mode: 'basic',
                    },
                },
            })
            const resp = await patchNegative(`${adminUrl}/plugins/${confluentPluginId}`, payload)
            logResponse(resp)
            expect(resp.status, 'Status should be 400').to.equal(400)
            expect(resp.data.message, 'Should have correct error message').to.contain(
                "basic authentication details required when mode is 'basic"
            )
        })

        it('should be able to update confluent plugin with schema registry and no authentication', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: {
                        mode: 'none',
                    },
                },
            })
            const resp = await patchPlugin(confluentPluginId, payload)
            expect(resp.config.schema_registry[registry].authentication, 'should not include authentication').to.contain({
                mode: 'none',
            })
        })

        it('should be able to update confluent plugin with schema registry authentication', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: {
                        mode: 'basic',
                        basic: {
                            username: schemaRegistryUsername,
                            password: schemaRegistryPassword,
                        },
                    },
                },
            })
            const resp = await patchPlugin(confluentPluginId, payload)
            expect(resp.config.schema_registry.confluent.authentication.mode, 'Should have correct mode').to.equal('basic');
            expect(resp.config.schema_registry.confluent.authentication.basic.username, 'Should have correct schema Registry username').to.equal(schemaRegistryUsername);
            expect(resp.config.schema_registry.confluent.authentication.basic.password, 'Should have correct schema Registry password').to.equal(schemaRegistryPassword);
            expect(resp.config.schema_registry[registry].url, 'Should have correct schema registry url').to.equal(schemaRegistryUrl)
            await waitForConfigRebuild()
        })

        it('should fail to send message when schema configuration is missing', async function () {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`,
                validateStatus: null,
            })
            logResponse(resp) 
            expect(resp.status, 'Status should be 400').to.equal(400)
            expect(resp.data.error, 'Should have correct error message').to.contain('failed to validate message against schema')

            const errorMessage = `failed to validate message against schema: schema configuration for message value is required`
            await eventually(async () => {
                const logs = getGatewayContainerLogs(kongContainerName, 50)
                expect(logs, 'Should have error in logs').to.contain(errorMessage)
            })
        })

        it('should update confluent plugin with invalid schema configuration (json type)', async function () {
            const schema = {
                "$id": "http://example.com/myURI.schema.json",
                "$schema": "http://json-schema.org/draft-07/schema#",
                "additionalProperties": false,
                "description": "Sample schema to help you get started.",
                "properties": {
                    "myField1": {
                        "description": "The integer type is used for integral numbers.",
                        "type": "integer"
                    },
                    "myField2": {
                        "description": "The number type is used for any numeric type, either integers or floating point numbers.",
                        "type": "number"
                    },
                    "myField3": {
                        "description": "The string type is used for strings of text.",
                        "type": "string"
                    }
                },
                "title": "SampleRecord",
                "type": "object"
            }
            await createSchema(invalidSubjectNameForJson, schema, schemaRegistryUrl, 'JSON', { username: schemaRegistryUsername, password: schemaRegistryPassword })

            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    value_schema: {
                        schema_version: 'latest',
                        subject_name: invalidSubjectNameForJson
                    },
                },
            })
            await patchPlugin(confluentPluginId, payload)
            await waitForConfigRebuild()
        })

        // it is skipped because of https://konghq.atlassian.net/browse/FTI-7020
        xit('should not be able to send message that is invalid by schema using confluent plugin (json type)', async function () {
            // send message via confluent plugin
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`,
                validateStatus: null,
            })
            logResponse(resp)
            expect(resp.status, 'Status should be 400').to.equal(400)
            expect(resp.data.error, 'Should have correct error message').to.contain('failed to validate message against schema')

            // get docker logs
            await eventually(async () => {
                const logs = getGatewayContainerLogs(kongContainerName, 50)
                expect(logs, 'Should have error in logs').to.contain(`failed to validate message against schema`)
            })
        })

        it('should be able to update confluent plugin with valid schema (json type)', async function () {
            // create a valid json schema 
            const schema = {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "$id": "http://example.com/logmessage.schema.json",
                "title": "LogMessage",
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "body": {
                        "type": "string",
                        "description": "Body of the message"
                    },
                    "body_args": {
                        "type": "string",
                        "description": "Body arguments"
                    },
                    "body_base64": {
                        "type": "string",
                        "description": "Base64 encoded body"
                    }
                },
                "required": ["body", "body_args", "body_base64"]
            }
            await createSchema(validSubjectNameForJson, schema, schemaRegistryUrl, 'JSON', { username: schemaRegistryUsername, password: schemaRegistryPassword })

            // update confluent plugin with valid json schema
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    value_schema: {
                        schema_version: 'latest',
                        subject_name: validSubjectNameForJson
                    },
                },
            })
            const resp = await patchPlugin(confluentPluginId, payload)
            expect(resp.config.schema_registry.confluent, 'Should include schema configuration').to.have.property('value_schema')
            expect(resp.config.schema_registry.confluent.value_schema, 'Should have correct schema version').to.have.property('schema_version', 'latest')
            expect(resp.config.schema_registry.confluent.value_schema, 'Should have correct subject name').to.have.property('subject_name', validSubjectNameForJson)
            await waitForConfigRebuild()
        })

        it('should be able to send message that is valid by schema using confluent plugin (json type)', async function () {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`
            })
            logResponse(resp)
            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data, 'Should indicate that message sent successfully').to.have.property('message', 'message sent')

            // ensure message was successfully sent
            const confluentRecords = await consumeAndExtractConfluentMessage(newTopic, consumePath)
            console.log('Confluent records:', confluentRecords)
            expect(confluentRecords.length, 'Should have at least one record').to.be.greaterThan(0)
        })

        it('should update confluent plugin with invalid schema configuration (avro type)', async function () {
            const schema = {
                "doc": "Sample schema to help you get started.",
                "fields": [
                    {
                        "doc": "The int type is a 32-bit signed integer.",
                        "name": "my_field1",
                        "type": "int"
                    },
                    {
                        "doc": "The double type is a double precision (64-bit) IEEE 754 floating-point number.",
                        "name": "my_field2",
                        "type": "double"
                    },
                    {
                        "doc": "The string is a unicode character sequence.",
                        "name": "my_field3",
                        "type": "string"
                    }
                ],
                "name": "sampleRecord",
                "namespace": "com.mycorp.mynamespace",
                "type": "record"
            }
            await createSchema(invalidSubjectNameForAvro, schema, schemaRegistryUrl, 'AVRO', { username: schemaRegistryUsername, password: schemaRegistryPassword })

            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    value_schema: {
                        schema_version: 'latest',
                        subject_name: invalidSubjectNameForAvro
                    },
                },
            })
            await patchPlugin(confluentPluginId, payload)
            await waitForConfigRebuild()
        })

        it('should not be able to send message that is invalid by schema using confluent plugin (avro type)', async function () {
            // send message via confluent plugin
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`,
                validateStatus: null,
            })
            logResponse(resp)
            expect(resp.status, 'Status should be 400').to.equal(400)
            expect(resp.data.error, 'Should have correct error message').to.contain('failed to validate message against schema')

            // get docker logs
            await eventually(async () => {
                const logs = getGatewayContainerLogs(kongContainerName, 50)
                expect(logs, 'Should have error in logs').to.contain(`failed to validate message against schema`)
            })
        })

        it('should be able to update confluent plugin with valid schema (avro type)', async function () {
            const schema = {
                "fields": [
                    {
                        "name": "body",
                        "type": "string"
                    },
                    {
                        "name": "body_args",
                        "type": "string"
                    },
                    {
                        "name": "body_base64",
                        "type": "string"
                    }
                ],
                "name": "LogMessage",
                "type": "record"
            };
            await createSchema(validSubjectNameForAvro, schema, schemaRegistryUrl, 'AVRO', { username: schemaRegistryUsername, password: schemaRegistryPassword })

            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    value_schema: {
                        schema_version: 'latest',
                        subject_name: validSubjectNameForAvro
                    },
                },
            })
            const resp = await patchPlugin(confluentPluginId, payload)
            expect(resp.config.schema_registry.confluent, 'Should include schema configuration').to.have.property('value_schema')
            expect(resp.config.schema_registry.confluent.value_schema, 'Should have correct schema version').to.have.property('schema_version', 'latest')
            expect(resp.config.schema_registry.confluent.value_schema, 'Should have correct subject name').to.have.property('subject_name', validSubjectNameForAvro)
            await waitForConfigRebuild()
        })

        it('should be able to send message that is valid by schema using confluent plugin (avro type)', async function () {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`
            })
            logResponse(resp)
            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data, 'Should indicate that message sent successfully').to.have.property('message', 'message sent')

            // ensure message was successfully sent
            const confluentRecords = await consumeAndExtractConfluentMessage(newTopic, consumePath)
            console.log('Confluent records:', confluentRecords)
            expect(confluentRecords.length, 'Should have at least one record').to.be.greaterThan(0)
        })
    }

    it('should not be able to update plugin with no forwarding parameters checked', async function () {
        const resp = await patchNegative(`${adminUrl}/plugins/${confluentPluginId}`, {
            config: {
                forward_body: false,
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            '"at least one of these attributes must be true: forward_method, forward_uri, forward_headers, forward_body"'
        )
    })

    it('should be able to update confluent plugin to forward headers', async function () {
        // update confluent-consume plugin to forward headers and remove schema registry
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${confluentPluginId}`,
            data: {
                config: {
                    forward_headers: true,
                    schema_registry: {
                        confluent: null, // remove schema registry config
                    },
                },
            },
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.forward_headers, 'Should have setting to forward headers').to.eql(true)

        await waitForConfigRebuild()
    })

    it('should be able to send header data with confluent plugin', async function () {
        // send message via confluent plugin
        const resp = await axios({
            method: 'get',
            url: `${proxyUrl}${logPath}`,
            headers: {
                'X-Test-Header': 'test-header',
            },
            data: {
                'test': 'header-forwarding-test'
            }
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should indicate that message sent successfully').to.have.property(
            'message',
            'message sent'
        )

        // ensure message was successfully sent
        const confluentRecords = await consumeAndExtractConfluentMessage(newTopic, consumePath)
        checkConfluentRecords(confluentRecords, 'body', '"test":"header-forwarding-test"')
        checkConfluentRecords(confluentRecords, 'headers', '"x-test-header":"test-header"')
    })

    it('should be able to update confluent-consume plugin to forward method', async function () {
        // update confluent-consume plugin to forward headers
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${confluentPluginId}`,
            data: {
                config: {
                    forward_method: true,
                },
            },
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.forward_method, 'Should have setting to forward method').to.eql(true)
        await waitForConfigRebuild()
    })

    it('should be able to send method with confluent plugin', async function () {
        // send message via confluent plugin
        const resp = await axios.get(`${proxyUrl}${logPath}`, {
            headers: {
                'X-Test-Header': 'test-header-method',
            },
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should indicate that message sent successfully').to.have.property(
            'message',
            'message sent'
        )

        const confluentRecords = await consumeAndExtractConfluentMessage(newTopic, consumePath)
        checkConfluentRecords(confluentRecords, 'body', '""')
        checkConfluentRecords(confluentRecords, 'headers', '"x-test-header":"test-header-method"')
    })

    it('should be able to update confluent-consume plugin to forward URI', async function () {
        // update confluent-consume plugin to forward headers
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${confluentPluginId}`,
            data: {
                config: {
                    forward_uri: true
                },
            },
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.forward_uri, 'Should have setting to forward uri').to.eql(true)
        await waitForConfigRebuild()
    })

    it('should be able to send uri data with confluent plugin', async function () {
        // send message via confluent plugin
        const resp = await axios.get(`${proxyUrl}${logPath}`, {
            headers: {
                'X-Test-Header': 'test-header-uri',
            },
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should indicate that message sent successfully').to.have.property(
            'message',
            'message sent'
        )

        const confluentRecords = await consumeAndExtractConfluentMessage(newTopic, consumePath)
        checkConfluentRecords(confluentRecords, 'body', '""')
        checkConfluentRecords(confluentRecords, 'headers', '"x-test-header":"test-header-uri"')
        checkConfluentRecords(confluentRecords, 'method', 'GET')
    })

    it('should be able to update confluent-consume plugin to not forward body', async function () {
        // update confluent-consume plugin to forward headers
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${confluentPluginId}`,
            data: {
                config: {
                    forward_body: false,
                },
            },
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.forward_body, 'Should have setting to not forward body').to.eql(false)
        await waitForConfigRebuild()
    })

    it('should be able to send message without forwarding body data with confluent plugin', async function () {
        const resp = await axios({
            method: 'get',
            url: `${proxyUrl}${logPath}`,
            headers: {
                'X-Test-Header': 'test-header-no-body',
            },
            data: {
                'test': 'this should not appear'
            }
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should indicate that message sent successfully').to.have.property(
            'message',
            'message sent'
        )

        const confluentRecords = await consumeAndExtractConfluentMessage(newTopic, consumePath)
        checkConfluentRecords(confluentRecords, 'headers', '"x-test-header":"test-header-no-body"')
        checkConfluentRecords(confluentRecords, 'method', 'GET')
        checkConfluentRecords(confluentRecords, 'uri', logPath)
        confluentRecords.forEach((record) => {
            expect(record, 'Should not have body').to.not.have.property('body')
        })
    })

    it('should be able to update message_by_lua_functions to replace message in confluent plugin', async function () {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${confluentPluginId}`,
            data: {
                config: {
                    message_by_lua_functions: [
                        'return function(message) return { msg = "hello world!" } end'
                    ],
                },
            },
            validateStatus: null,
        })

        logResponse(resp)

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.message_by_lua_functions, 'Should have correct custom message_by_lua_functions').to.eql([
            'return function(message) return { msg = "hello world!" } end',
        ])

        await waitForConfigRebuild()
    })

    it('should be able to send message with message_by_lua_functions', async function () {
        // send message via confluent plugin
        const resp = await axios.get(`${proxyUrl}${logPath}`, {
            headers: {
                'X-Test-Header': 'test-header-lua-check',
            },
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data, 'Should indicate that message sent successfully').to.have.property(
            'message',
            'message sent'
        )

        const confluentRecords = await consumeAndExtractConfluentMessage(newTopic, consumePath)
        checkConfluentRecords(confluentRecords, 'msg', 'hello world!')
    })

    after(async function () {
        // delete created confluent topics
        await deleteConfluentTopics([confluentTopic, newTopic])

        // delete created confluent schemas
        const subjectsToDelete = [
            invalidSubjectNameForJson,
            validSubjectNameForJson,
            invalidSubjectNameForAvro,
            validSubjectNameForAvro
        ];
        await deleteSchemas(subjectsToDelete, schemaRegistryUrl, {
            username: schemaRegistryUsername,
            password: schemaRegistryPassword
        });

        // clean up kong resources
        await clearAllKongResources()
    })
})
