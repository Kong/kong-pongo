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
    randomString,
    eventually,
    getGatewayBasePath,
    kafkaConfig,
    schemaRegistryConfig,
    sendKafkaMessage,
    updateKafkaLogTopic,
    patchNegative,
    logResponse,
    patchPlugin,
    getGatewayContainerLogs,
    getKongContainerName,
    isGwHybrid,
    createSchema,
    deleteSchemas,
    checkOrStartServiceContainer,
    stopContainerByName,
    makeSchemaRegistryConfig
} from '@support'
import WebSocket from 'promise-ws'

describe('Gateway Plugins: Kafka Consume Plugin', function() {
    const logPath = '/log'
    const consumePath = '/consume'

    const adminUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
    })
    const proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
    })

    let testPluginId: string
    let logPluginId: string
    let logRouteId: string
    let consumeRouteId: string

    const controller = new AbortController()
    let ws: WebSocket

    const output = randomString()
    const consumeTopic = `test-${output}`
    const newTopic = `new-${output}`
    const subjectName = `subject-${output}`

    const schemaRegistryUrl = schemaRegistryConfig.url
    const schemaRegistryUsername = schemaRegistryConfig.username
    const schemaRegistryPassword = schemaRegistryConfig.password

    before(async function () {
        // start schema registry container
        await checkOrStartServiceContainer('schema-registry');

        // create service to use with kafka-log to send messages
        await createGatewayService('kafkaLogService')

        // create route for kafka-log plugin
        const logRoute = await createRouteForService('kafkaLogService', [logPath], {
            name: 'kafkaLogRoute',
        })
        logRouteId = logRoute.id

        // create kafka-log plugin to send messages to kafka
        const kafkaLogPlugin = await createPlugin({
            name: 'kafka-log',
            route: {
                id: logRouteId,
            },
            config: {
                topic: consumeTopic,
                bootstrap_servers: [
                    {
                        host: kafkaConfig.host,
                        port: kafkaConfig.plainPort,
                    },
                ],
            },
        })
        logPluginId = kafkaLogPlugin.id

        // create route to use in testing
        const consumeRoute = await createRoute([consumePath], {
            name: 'kafkaConsumeRoute',
        })
        consumeRouteId = consumeRoute.id

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

    // Covers KAG-6398
    it('should not create kafka-consume plugin without topic parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'kafka-consume',
            route: {
                id: consumeRouteId,
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
            'schema violation (config.topics: required field missing)'
        )
    })

    it('should not create kafka-consume plugin without bootstrap servers parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'kafka-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                topics: [{'name': consumeTopic}],
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.bootstrap_servers: required field missing)'
        )
    })

    // TODO: unskip when KAG-6493 is complete
    it.skip('should not create kafka-consume plugin with authentication mechanism but no strategy', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'kafka-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                topics: [{'name': consumeTopic}],
                bootstrap_servers: [
                    {
                        host: kafkaConfig.host,
                        port: kafkaConfig.plainPort,
                    },
                ],
                authentication: {
                    mechanism: 'PLAIN',
                    user: kafkaConfig.username,
                    password: kafkaConfig.password,
                },
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.authentication.strategy: required field missing)'
        )
    })

    // // TODO: Unskip when KAG-6573 is complete
    it.skip('should not create kafka-consume plugin without authentication mechanism', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'kafka-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                topics: [{'name': consumeTopic}],
                bootstrap_servers: [
                    {
                        host: kafkaConfig.host,
                        port: kafkaConfig.plainPort,
                    },
                ],
                authentication: {
                    strategy: 'sasl',
                    mechanism: null,
                    user: kafkaConfig.username,
                    password: kafkaConfig.password,
                },
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.authentication.mechanism: required field missing)'
        )
    })

    // Covers KAG-6440
    it('should not create kafka-consume plugin with missing mode of operation', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'kafka-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                topics: [{'name': consumeTopic}],
                bootstrap_servers: [
                    {
                        host: kafkaConfig.host,
                        port: kafkaConfig.plainPort,
                    },
                ],
                mode: null,
            },
        })
        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.mode: required field missing)'
        )
    })

    it('should create kafka-consume plugin', async function () {
        const resp = await axios({
            method: 'post',
            url: `${adminUrl}/plugins`,
            data: {
                name: 'kafka-consume',
                route: {
                    id: consumeRouteId,
                },
                config: {
                    topics: [{'name': consumeTopic}],
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
        expect(resp.data.name, 'Should have correct plugin name').to.equal('kafka-consume')
        expect(resp.data.config.topics[0], 'Should have correct topics').to.contain({'name': consumeTopic})
        expect(resp.data.config.bootstrap_servers, 'Should have correct bootstrap servers').to.eql([
            {
                host: kafkaConfig.host,
                port: kafkaConfig.plainPort,
            },
        ])

        testPluginId = resp.data.id

        await waitForConfigRebuild()
    })

    // Covers KAG-6417
    it('should be able to use kafka-consume plugin when topic is empty', async function () {
        const resp = await axios.get(`${proxyUrl}${consumePath}`)

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data[consumeTopic].partitions["0"].records, 'Should have no records').to.eql({})
    })

    it('should be able to consume messages with kafka-consume plugin', async function () {
        const resp = await sendKafkaMessage(logPath)
        const requestId = resp.headers['x-kong-request-id']

        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
            })

            const records = resp.data[consumeTopic].partitions["0"].records

            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(records.length, 'Should have records for topic').to.be.gt(0)
            expect(resp.data[consumeTopic].partitions["0"].records[0].value, 'Should have record for request send with kafka-log plugin').to.contain(requestId)
        }, 30000, 2000, false)
    })

    it('should be able to update kafka-consume plugin topic', async function () {
        await updateKafkaLogTopic(newTopic, logPluginId)

        // update consume plugin
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                config: {
                    topics: [{"name": newTopic}],
                },
            },
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.topics[0], 'Should have correct topics').to.contain({'name': newTopic})

        await waitForConfigRebuild()
    })

    it('should be able to use kafka-consume plugin and new, empty topic', async function () {
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
            })

            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data, 'Should show correct topic').to.have.property(newTopic)
            expect(resp.data[newTopic].partitions["0"].records, 'Should have no records').to.eql({})
        }, 30000, 6000, false)
    })

    it('should be able to consume messages with kafka-consume plugin and new topic', async function () {
        // send message via kafka-log plugin
        await sendKafkaMessage(logPath)

        // consume message via kafka-consume plugin
        await eventually(async() => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
            })

            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data[newTopic].partitions["0"].records, 'Should have records for topic').to.have.length.greaterThan(0)
        }, 30000, 2000, false)
    })

    for (const registry of ['confluent']) { // will have appio eventually
        it('should not be able to update kafka-consume plugin with schema registry authentication and no username or password', async function () {
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

        it('should be able to update kafka-consume plugin with schema registry and no authentication', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: { mode: 'none' },
                },
            });
            const resp = await patchPlugin(testPluginId, payload)
            expect(resp.config.schema_registry[registry].authentication, 'should not include authentication').to.contain({mode: 'none'})
        })

        it('should be able to update kafka-consume plugin with schema registry authentication', async function () {
            // update kafka-log plugin 
            const kafka_log_payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    value_schema: {
                        schema_version: 'latest',
                        subject_name: subjectName,
                    },
                    authentication: {
                        mode: 'basic',
                        basic: {
                            username: schemaRegistryUsername,
                            password: schemaRegistryPassword,
                        },
                    },
                },
            })
            await patchPlugin(logPluginId, kafka_log_payload)


            // update kafka-consume plugin
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
                topics: [{ 'name': newTopic }],
                mode: 'http-get',
            })
            const resp = await patchPlugin(testPluginId, payload)
            expect(resp.config.schema_registry.confluent.authentication.mode, 'Should have correct mode').to.equal('basic');
            expect(resp.config.schema_registry.confluent.authentication.basic.username, 'Should have correct schema Registry username').to.equal(schemaRegistryUsername);
            expect(resp.config.schema_registry.confluent.authentication.basic.password, 'Should have correct schema Registry password').to.equal(schemaRegistryPassword);
            expect(resp.config.topics[0].name, 'First topic name should be correct').to.equal(newTopic);
            await waitForConfigRebuild()
        })

        it('should be able to consume messages with kafka-consume plugin and schema registry authentication', async function () {
            // create schema in registry to use for validation
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


            await createSchema(subjectName, schema, 'http://localhost:8081', 'JSON')


            // send message via kafka-log plugin
            await sendKafkaMessage(logPath)

            // check logs to ensure no errors with schema registry validation
            const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
            await eventually(async () => {
                const logs = getGatewayContainerLogs(kongContainerName, 50)
                expect(logs, 'Should not error in logs').to.not.contain(`failed to send a message on topic ${newTopic}`)
            })

            // consume message via kafka-consume plugin
            await eventually(async () => {
                const resp = await axios({
                    method: 'get',
                    url: `${proxyUrl}${consumePath}`,
                })
                logResponse(resp)
                expect(resp.status, 'Status should be 200').to.equal(200)
                expect(resp.data[newTopic].partitions["0"].records, 'Should have records for topic').to.not.eql({})
            })
        })
    }

    it('should be able to update kafka-consume plugin to use websocket mode', async function () {
        // update consume plugin
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                name: 'kafka-consume',
                config: {
                    mode: 'websocket',
                },
            },
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.mode, 'Should have websockets mode').to.equal('websocket')

        await waitForConfigRebuild()
    })

    it('should not be able to consume messages via http in websocket mode', async function () {
        const resp = await axios({
            method: 'get',
            url: `${proxyUrl}${consumePath}`,
            validateStatus: null,
        })
        expect(resp.status, 'Status should be 500').to.equal(500)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'WebSocket connection failed'
        )
    })

    it('should be able to consume messages with kafka-consume plugin and websocket mode', async function () {
        const wsUrl = `${getGatewayBasePath('wsProxy')}${consumePath}`

        //send message via kafka-log plugin
        setTimeout(async function() {
            await sendKafkaMessage(logPath)
        }, 3000)

        await eventually(async () => {
            // open websocket connection
            ws = await WebSocket.create(wsUrl, {
                rejectUnauthorized: false,
            })
            const data = await new Promise(resolve => ws.on('message', data => resolve(data)))
            await ws.close()

            expect(data, 'Should have records in message').to.not.eql({})
            expect(data, 'Should have records for given kafka topic').to.contain(newTopic)
        }, 30000, 6000, false)
    })

    it('should update kafka-consume plugin to use new topic in websocket mode', async function () {
        // in case last test fails, close websocket connection
        await ws.close()

        // update kafka-log plugin to use new topic
        await updateKafkaLogTopic(`${consumeTopic}-ws`, logPluginId)

        // update consume plugin
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                config: {
                    topics: [{'name': `${consumeTopic}-ws`}],
                },
            },
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.topics[0], 'Should have correct topics').to.contain({'name': `${consumeTopic}-ws`})
        expect(resp.data.config.mode, 'Should have websockets mode').to.equal('websocket')
        testPluginId = resp.data.id

        await waitForConfigRebuild({delay: 10000})
    })

    it('should be able to consume messages with kafka-consume plugin and new topic in websocket mode', async function () {
        // send message via kafka-log plugin
        setTimeout(async function() {
            await sendKafkaMessage(logPath)
        }, 3000)

        const wsUrl = `${getGatewayBasePath('wsProxy')}${consumePath}`

        await eventually(async () => {
            ws = await WebSocket.create(wsUrl, {
                rejectUnauthorized: false,
            })
            // open websocket connection
            const data = await new Promise(resolve => ws.on('message', data => resolve(data)))
            await ws.close()

            expect(data, 'Should have records in message').to.not.eql({})
            expect(data, 'Should have records for given kafka topic').to.contain(`${consumeTopic}-ws`)
        }, 60000, 7000, false)
    })

    // KAG-6441
    it('should be able to update kafka-consume plugin with server-sent events enabled', async function () {
        // close websocket connection just in case
        if (ws) {
            await ws.close()
        }
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                name: 'kafka-consume',
                route: {
                    id: consumeRouteId,
                },
                config: {
                    topics: [{'name': newTopic}],
                    bootstrap_servers: [
                        {
                            host: kafkaConfig.host,
                            port: kafkaConfig.plainPort,
                        },
                    ],
                    mode: 'server-sent-events',
                },
            },
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.topics[0], 'Should have correct topics').to.contain({'name': newTopic})
        expect(resp.data.config.mode, 'Should have server-sent events enabled').to.equal('server-sent-events')
        expect(resp.data.config.bootstrap_servers, 'Should have correct bootstrap servers').to.eql([
            {
                host: kafkaConfig.host,
                port: kafkaConfig.plainPort,
            },
        ])
        testPluginId = resp.data.id

        await waitForConfigRebuild()
    })

    it('should be able to consume messages with kafka-consume plugin and server-sent events enabled', async function () {
        const streamResp = await axios({
            method: 'GET',
            url: `${proxyUrl}${consumePath}`,
            responseType: 'stream',
            signal: controller.signal,
        })
        expect(streamResp.status, 'Status should be 200').to.equal(200)
        expect(streamResp.headers['content-type'], 'Should have correct content type').to.contain('text/event-stream')

        const stream = streamResp.data

        const resp = await sendKafkaMessage(logPath)

        await eventually(async () => {
            await stream.on('data', async(chunk: Buffer) => {
                const data = chunk.toString()
                expect(data, 'should contain topic name').to.contain(newTopic)
                expect(data, 'should contain request ID').to.contain(resp.headers['x-kong-request-id'])
                // close stream
                controller.abort()
            })
        }, 30000)

        // send close signal again just in case
        controller.abort()
    })

    it('should not be able to update kafka-consume plugin with auth mechanism but no username or password', async function () {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                name: 'kafka-consume',
                route: {
                    id: consumeRouteId,
                },
                config: {
                    topics: [{'name': 'test'}],
                    bootstrap_servers: [
                        {
                            host: kafkaConfig.host,
                            port: kafkaConfig.saslPort,
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
        // Covers KAG-6503
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'if authentication strategy is SASL and mechanism is PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512, you have to set user and password'
        )
    })

    //TODO: add SCRAM-SHA-256 and SCRAM-SHA-512 (blocked by KAG-6693)
    for (const authMechanism of ['PLAIN']) {
        const authTopic = `${consumeTopic}-${authMechanism}`

        it(`should update kafka-consume plugin to use ${authMechanism} auth`, async function () {
            // update kafka-log plugin to use new topic
            await updateKafkaLogTopic(authTopic, logPluginId, authMechanism)

            const resp = await axios({
                method: 'patch',
                url: `${adminUrl}/plugins/${testPluginId}`,
                data: {
                    name: 'kafka-consume',
                    config: {
                        topics: [{'name': authTopic}],
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
                            password: 'wrong-password',
                        },
                        mode: 'http-get',
                    },
                }
            })
            await waitForConfigRebuild()

            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data.config.topics[0], 'Should have correct topics').to.contain({'name': authTopic})
        })

        it(`should not be able to consume messages with kafka-consume plugin and wrong password for ${authMechanism}`, async function () {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
                validateStatus: null,
            })
            // this is the current status for all errors, may change
            expect(resp.status, 'Status should be 502').to.equal(502)
        })

        it(`should be able to update kafka-consume plugin with correct password for ${authMechanism}`, async function () {
            const resp = await axios({
                method: 'patch',
                url: `${adminUrl}/plugins/${testPluginId}`,
                data: {
                    name: 'kafka-consume',
                    config: {
                        authentication: {
                            password: kafkaConfig.password,
                        },
                    },
                }
            })
            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data.config.topics[0], 'Should have correct topics').to.contain({'name': authTopic})
            expect(resp.data.config.authentication.password, 'Should have correct password').to.equal(kafkaConfig.password)
        })

        it(`should be able to consume messages with kafka-consume plugin and new but empty topic with ${authMechanism} auth`, async function () {
            await eventually(async () => {
                const resp = await axios({
                    method: 'get',
                    url: `${proxyUrl}${consumePath}`,
                })

                expect(resp.status, 'Status should be 200').to.equal(200)
                expect(resp.data[authTopic].partitions["0"].records, 'Should have no records').to.eql({})
            }, 30000, 2000, false)
        })

        it(`should be able to consume kafka messages with plugin and ${authMechanism} auth`, async function () {
            // send message via kafka-log plugin
            await sendKafkaMessage(logPath)

            await eventually(async () => {
                const resp = await axios({
                    method: 'get',
                    url: `${proxyUrl}${consumePath}`,
                })

                expect(resp.status, 'Status should be 200').to.equal(200)
                expect(resp.data[authTopic].partitions["0"].records, 'Should have records for topic').to.not.eql({})
            }, 30000, 2000, false)
        })
    }

    after(async function () {
        await deleteSchemas([subjectName], 'http://localhost:8081')
        await stopContainerByName('schema-registry');

        // send abort and close signals just in case
        controller.abort()
        ws.close()
        await clearAllKongResources()
    })
})
