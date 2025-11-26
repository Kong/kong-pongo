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
    randomString,
    postNegative,
    updateKafkaConsumeTopic,
    consumeKafkaMessage,
    eventually,
    kafkaConfig,
    logResponse,
    patchNegative,
    schemaRegistryConfig,
    getGatewayContainerLogs,
    createSchema,
    deleteSchemas,
    getKongContainerName,
    isGwHybrid,
    stopContainerByName,
    checkOrStartServiceContainer,
    patchPlugin,
    makeSchemaRegistryConfig
} from '@support'


describe('Gateway Plugins: Kafka Log', function () {
    const logPath = '/log'
    const consumePath = '/consume'

    const adminUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
    })
    const proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
    })
    const gwContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();

    const output = randomString()
    const logTopic = `test-${output}`
    const newTopic = `new-${output}`
    const schemaRegistryTopic = `sr-${output}`
    const validSubjectName = `subject-${output}`
    const invalidSubjectName1 = `subject-invalid-1-${output}`
    const invalidSubjectName2 = `subject-invalid-2-${output}`

    const schemaRegistryUrl = schemaRegistryConfig.url
    const schemaRegistryUsername = schemaRegistryConfig.username
    const schemaRegistryPassword = schemaRegistryConfig.password

    let testPluginId: string
    let kafkaConsumePluginId: string
    let consumeRouteId: string
    let logRouteId: string
    let requestId: string

    before(async function () {
        // start schema registry container
        await checkOrStartServiceContainer('schema-registry');

        // create route to use with kafka-consume to check messages sent to kafka
        const consumeRoute = await createRoute([consumePath], {
            name: 'kafkaConsumeRoute',
        })
        consumeRouteId = consumeRoute.id

        // create kafka-consume plugin to check messages sent to kafka
        const kafkaConsumePlugin = await createPlugin({
            name: 'kafka-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                topics: [{ 'name': logTopic }],
                bootstrap_servers: [
                    {
                        host: kafkaConfig.host,
                        port: kafkaConfig.plainPort,
                    },
                ],
            },
        })
        kafkaConsumePluginId = kafkaConsumePlugin.id

        // create service and route to use in testing
        await createGatewayService('kafkaLogService')

        const logRoute = await createRouteForService('kafkaLogService', [logPath], {
            name: 'kafkaLogRoute',
        })
        logRouteId = logRoute.id

        // Create prefunction plugin to add body in kafka logs
        await createPlugin({
            name: 'pre-function',
            route: {
                id: logRouteId,
            },
            config: {
                access: [`kong.service.request.enable_buffering() local body = kong.request.get_body() kong.log.set_serialize_value("request.body", body)`],
                log: [`local body = kong.service.response.get_body() kong.log.set_serialize_value("response.body", body)`]
            },
        })

        await waitForConfigRebuild()
    })

    it('should not create kafka-log plugin without topic parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'kafka-log',
            route: {
                id: logRouteId,
            },
            config: {
                bootstrap_servers: [
                    {
                        host: kafkaConfig.host,
                        port: kafkaConfig.plainPort,
                    },
                ],
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.topic: required field missing)'
        )
    })

    it('should create kafka-log plugin', async function () {
        const resp = await axios({
            method: 'post',
            url: `${adminUrl}/plugins`,
            data: {
                name: 'kafka-log',
                route: {
                    id: logRouteId,
                },
                config: {
                    topic: logTopic,
                    bootstrap_servers: [
                        {
                            host: kafkaConfig.host,
                            port: kafkaConfig.plainPort,
                        },
                    ],
                },
            },
        })

        expect(resp.status, 'Status should be 201').to.equal(201)
        expect(resp.data.name, 'Should have correct plugin name').to.equal('kafka-log')
        expect(resp.data.config.topic, 'Should have correct topic').to.eql(logTopic)
        expect(resp.data.config.bootstrap_servers, 'Should have correct bootstrap servers').to.eql([
            {
                host: kafkaConfig.host,
                port: kafkaConfig.plainPort,
            },
        ])

        testPluginId = resp.data.id
        await waitForConfigRebuild()
    })

    it('should be able to send messages with kafka-log plugin to empty topic', async function () {
        // send message via kafka-log plugin
        const resp = await axios({
            method: 'get',
            url: `${proxyUrl}${logPath}`,
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        requestId = resp.headers['x-kong-request-id']
    })

    it('should see request data sent by kafka-log in kafka', async function () {
        await consumeKafkaMessage(logTopic, consumePath, requestId)
    })

    it('should be able to update kafka-log plugin topic', async function () {
        await updateKafkaConsumeTopic(newTopic, kafkaConsumePluginId, consumePath)

        // update log plugin
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                config: {
                    topic: newTopic,
                },
            },
            validateStatus: null,
        })

        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.topic, 'Should have correct topic').to.contain(newTopic)

        await waitForConfigRebuild()
    })

    it('should be able to send messages with kafka-log plugin and updated empty topic', async function () {
        const resp = await axios.get(`${proxyUrl}${logPath}`)

        expect(resp.status, 'Status should be 200').to.equal(200)
        requestId = resp.headers['x-kong-request-id']
    })

    it('should be able to see request data sent with kafka-log in kafka with updated topic', async function () {
        await consumeKafkaMessage(newTopic, consumePath, requestId)
    })

    it('should be able to send added headers and querystring with kafka-log plugin', async function () {
        // send message via kafka-log plugin
        const resp = await axios({
            method: 'get',
            url: `${proxyUrl}${logPath}?test=true`,
            headers: {
                'test-header': 'test-header-value',
            }
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        requestId = resp.headers['x-kong-request-id']
        expect(resp.data.headers['Test-Header'], 'Should have correct header').to.equal('test-header-value')
    })

    it('should be able to see added headers and querystring when consuming kafka-log message', async function () {
        const resp = await consumeKafkaMessage(newTopic, consumePath, requestId)
        const data = resp.data[newTopic].partitions["0"].records[0].value

        expect(data, 'Should have expected headers').to.contain('"test-header":"test-header-value"')
        expect(data, 'Should have expected query param').to.contain('"querystring":{"test":"true"}')
    })

    it('should be able to send added body with kafka-log plugin and pre-function plugin', async function () {
        // send message via kafka-log plugin
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${logPath}`,
            headers: {
                'content-type': 'application/json',
            },
            data: {
                test_key: 'test_value',
            },
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        requestId = resp.headers['x-kong-request-id']
        expect(resp.data.data, 'Should have correct body').to.eql('{"test_key":"test_value"}')

        await waitForConfigRebuild()
    })

    it('should be able to see added body when consuming kafka-log message', async function () {
        const resp = await consumeKafkaMessage(newTopic, consumePath, requestId)
        const data = resp.data[newTopic].partitions["0"].records[0].value

        expect(data, 'Should have expected body').to.contain('"test_key":"test_value"')
    })

    it('should be able to update custom_fields_by_lua in kafka-log plugin', async function () {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                config: {
                    custom_fields_by_lua: {
                        custom_field: "return 'by lua'",
                    },
                },
            },
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.custom_fields_by_lua, 'Should have correct custom fields').to.eql({
            custom_field: "return 'by lua'",
        })

        await waitForConfigRebuild()
    })

    it('should be able to send custom fields in kafka-log message', async function () {
        // send message via kafka-log plugin
        const resp = await axios({
            method: 'get',
            url: `${proxyUrl}${logPath}`
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        requestId = resp.headers['x-kong-request-id']
    })

    it('should be able to see custom fields sent when consuming kafka-log message', async function () {
        const resp = await consumeKafkaMessage(newTopic, consumePath, requestId)
        const data = resp.data[newTopic].partitions["0"].records[0].value
        expect(data, 'Should have expected custom field').to.contain('"custom_field":"by lua"')
    })

    for (const registry of ['confluent']) { // will have appio eventually
        it('should not be able to update kafka-log plugin with schema registry authentication and no username or password', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: { mode: 'basic' },
                },
            });
            const resp = await patchNegative(`${adminUrl}/plugins/${testPluginId}`, payload);
            logResponse(resp)
            expect(resp.status, 'Status should be 400').to.equal(400)
            expect(resp.data.message, 'Should have correct error message').to.contain("basic authentication details required when mode is 'basic")
        })

        it('should be able to update kafka-log plugin with schema registry and no authentication', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: { mode: 'none' },
                },
            });
            const resp = await patchPlugin(testPluginId, payload)
            expect(resp.config.schema_registry[registry].authentication, 'should not include authentication').to.contain({ mode: 'none' })
        })

        it('should be able to update kafka-log plugin with schema registry authentication', async function () {
            await updateKafkaConsumeTopic(`${schemaRegistryTopic}`, kafkaConsumePluginId, consumePath)

            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: {
                        mode: 'basic',
                        basic: {
                            username: schemaRegistryUsername,
                            password: schemaRegistryPassword
                        },
                    },
                },
                topic: `${schemaRegistryTopic}_1`
            });
            const resp = await patchPlugin(testPluginId, payload);
            const { authentication, url } = resp.config.schema_registry[registry];
            expect(authentication.mode, 'Should use basic mode').to.equal('basic');
            expect(authentication.basic.username, 'Should have correct username').to.equal(schemaRegistryUsername);
            expect(authentication.basic.password, 'Should have correct password').to.equal(schemaRegistryPassword);
            expect(url, 'Should have correct schema registry url').to.equal(schemaRegistryUrl);
            await waitForConfigRebuild()
        })

        it('should fail to send message when schema configuration is missing', async function () {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`
            })
            logResponse(resp)
            expect(resp.status, 'Status should be 200').to.equal(200)

            // message in 3.12.0.0
            // const errorMessage = `failed to send a message on topic ${schemaRegistryTopic}_1: failed to validate message against schema: schema configuration is required` 
            // message after 3.12.0.0
            const errorMessage = `failed to send a message on topic ${schemaRegistryTopic}_1: failed to validate message against schema: schema configuration for message value is required`
            await eventually(async () => {
                const logs = getGatewayContainerLogs(gwContainerName, 50)
                expect(logs, 'Should have error in logs').to.contain(errorMessage)
            })
        })

        it('should update kafka-log plugin with invalid schema configuration', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    value_schema: {
                        schema_version: 'latest',
                        subject_name: invalidSubjectName1,
                    },
                },
                topic: `${schemaRegistryTopic}_invalid`,
            });
            await patchPlugin(testPluginId, payload)
            await waitForConfigRebuild()
        })

        it('should not be able to send message with invalid schema by using kafka-log plugin (avro type)', async function () {
            // create schema in registry to use for validation
            const schema = {
                "type": "record",
                "name": "KongLog",
                "fields": [
                    { "name": "upstream_uri", "type": "string" },
                    { "name": "source", "type": "string" },
                    { "name": "started_at", "type": "long" }
                ]
            };
            await createSchema(invalidSubjectName1, schema, 'http://localhost:8081')

            // send message via kafka-log plugin
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`,
                validateStatus: null,
            })
            logResponse(resp)

            // message in 3.12.0.0
            // const errorMessage = `failed to send a message on topic ${schemaRegistryTopic}_invalid: failed to validate message against schema: schema validation failed: could not encode (schema validation failed)`  
            // message in after 3.12.0.0
            const errorMessage = `failed to send a message on topic ${schemaRegistryTopic}_invalid: failed to validate message against schema: could not encode (schema validation failed)`
            await eventually(async () => {
                const logs = getGatewayContainerLogs(gwContainerName, 50)
                expect(logs, 'Should have error in logs').to.contain(errorMessage)
            })
        })

        it('should not be able to send message with invalid schema by using kafka-log plugin (json type)', async function () {
            // create invalid schema in registry to use for validation
            const schema = {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "title": "KongLog",
                "type": "object",
                "properties": {
                    "upstream_uri": { "type": "string" }
                },
                "required": ["upstream_uri"]
            }

            await createSchema(invalidSubjectName2, schema, 'http://localhost:8081', 'JSON')

            // send message via kafka-log plugin
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`,
                validateStatus: null,
            })
            logResponse(resp)

            // message in 3.12.0.0
            // const errorMessage = `failed to send a message on topic ${schemaRegistryTopic}_invalid: failed to validate message against schema: schema validation failed: could not encode (schema validation failed)`  
            // message in after 3.12.0.0
            const errorMessage = `failed to send a message on topic ${schemaRegistryTopic}_invalid: failed to validate message against schema: could not encode (schema validation failed)`
            await eventually(async () => {
                const logs = getGatewayContainerLogs(gwContainerName, 50)
                expect(logs, 'Should have error in logs').to.contain(errorMessage)
            })
        })

        it('should be able to update kafka-log plugin with valid schema (json type)', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    value_schema: {
                        schema_version: 'latest',
                        subject_name: validSubjectName,
                    },
                },
                topic: `${schemaRegistryTopic}`,
            })
            const resp = await patchPlugin(testPluginId, payload)
            expect(resp.config.schema_registry.confluent, 'Should include schema configuration').to.have.property('value_schema')
            expect(resp.config.schema_registry.confluent.value_schema, 'Should have correct schema version').to.have.property('schema_version', 'latest')
            expect(resp.config.schema_registry.confluent.value_schema, 'Should have correct subject name').to.have.property('subject_name', validSubjectName)

            await waitForConfigRebuild()
        })

        it('should be able to send message with valid schema by using kafka-log plugin', async function () {
            // create a valid schema in registry to use for validation
            const schema = {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "title": "KongLog",
                "type": "object",
                "properties": {
                    "upstream_uri": { "type": "string" },
                    "source": { "type": "string" },
                    "started_at": { "type": "integer" },
                    "request": {
                        "type": "object",
                        "properties": {
                            "size": { "type": "integer" },
                            "uri": { "type": "string" },
                            "headers": {
                                "type": "object",
                                "additionalProperties": { "type": "string" }
                            },
                            "id": { "type": "string" },
                            "querystring": {
                                "type": "object",
                                "additionalProperties": { "type": "string" }
                            },
                            "method": { "type": "string" },
                            "url": { "type": "string" }
                        },
                        "required": ["size", "uri", "headers", "id", "querystring", "method", "url"]
                    },
                    "workspace_name": { "type": "string" },
                    "service": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "ws_id": { "type": "string" },
                            "retries": { "type": "integer" },
                            "enabled": { "type": "boolean" },
                            "port": { "type": "integer" },
                            "name": { "type": "string" },
                            "read_timeout": { "type": "integer" },
                            "updated_at": { "type": "integer" },
                            "protocol": { "type": "string" },
                            "connect_timeout": { "type": "integer" },
                            "id": { "type": "string" },
                            "created_at": { "type": "integer" },
                            "host": { "type": "string" },
                            "write_timeout": { "type": "integer" }
                        },
                        "required": [
                            "path", "ws_id", "retries", "enabled", "port", "name", "read_timeout",
                            "updated_at", "protocol", "connect_timeout", "id", "created_at", "host", "write_timeout"
                        ]
                    }
                },
                "required": ["upstream_uri", "source", "started_at", "request", "workspace_name", "service"]
            }

            await createSchema(validSubjectName, schema, 'http://localhost:8081', 'JSON')

            // send message via kafka-log plugin
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${logPath}`
            })
            logResponse(resp)
            expect(resp.status, 'Status should be 200').to.equal(200)
            requestId = resp.headers['x-kong-request-id']

            // check that there is no error in the logs about schema validation
            await eventually(async () => {
                const logs = getGatewayContainerLogs(gwContainerName, 50)
                expect(logs, 'Should not error in logs').to.not.contain(`failed to send a message on topic ${schemaRegistryTopic}:`)
            })
        })

        it('should be able to see request data sent with kafka-log in kafka with valid schema', async function () {
            // check if message was sent
            await consumeKafkaMessage(`${schemaRegistryTopic}`, consumePath, requestId)
        })
    }

    it('should not be able to update kafka-log plugin with auth mechanism but no username or password', async function () {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                name: 'kafka-log',
                route: {
                    id: logRouteId,
                },
                config: {
                    topic: newTopic,
                    bootstrap_servers: [
                        {
                            host: kafkaConfig.host,
                            port: kafkaConfig.plainPort,
                        },
                    ],
                    authentication: {
                        strategy: 'sasl',
                        mechanism: 'PLAIN',
                    },
                },
            },
            validateStatus: null,
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'you have to set user and password'
        )
    })

    for (const authMechanism of ['PLAIN']) {
        const authTopic = `${logTopic}-${authMechanism}`

        it(`should update kafka-log plugin to use ${authMechanism} auth`, async function () {
            // update kafka-consume plugin to use new topic
            await updateKafkaConsumeTopic(authTopic, kafkaConsumePluginId, consumePath, authMechanism)

            const resp = await axios({
                method: 'PATCH',
                url: `${adminUrl}/plugins/${testPluginId}`,
                data: {
                    name: 'kafka-log',
                    route: {
                        id: logRouteId,
                    },
                    config: {
                        topic: authTopic,
                        bootstrap_servers: [
                            {
                                host: kafkaConfig.host,
                                port: kafkaConfig.saslPort,
                            },
                        ],
                        authentication: {
                            strategy: 'sasl',
                            mechanism: authMechanism,
                            user: kafkaConfig.username,
                            password: kafkaConfig.password,
                        },
                    },
                },
            })

            await waitForConfigRebuild()

            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data.config.topic, 'Should have correct topic').to.eql(`${logTopic}-${authMechanism}`)
        })

        it(`should be able to log messages with kafka-log plugin and new topic with ${authMechanism} auth`, async function () {
            const resp = await axios.get(`${proxyUrl}/log`)
            expect(resp.status, 'Status should be 200').to.equal(200)
            requestId = resp.headers['x-kong-request-id']
        })

        it(`should be able to see request data sent with kafka-log in kafka and ${authMechanism} auth`, async function () {
            await consumeKafkaMessage(`${logTopic}-${authMechanism}`, consumePath, requestId)
        })
    }

    after(async function () {
        await deleteSchemas([validSubjectName, invalidSubjectName1, invalidSubjectName2], 'http://localhost:8081')
        await stopContainerByName('schema-registry');
        await clearAllKongResources()
    })
})
