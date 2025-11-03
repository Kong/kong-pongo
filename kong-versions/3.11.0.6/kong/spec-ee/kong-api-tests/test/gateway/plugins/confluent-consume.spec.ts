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
    eventually,
    confluentConfig,
    updateConfluentTopic,
    sendConfluentMessage,
    extractConfluentRecords,
    checkGwVars,
    createConfluentTopics,
    deleteConfluentTopics,
    randomString,
    patchNegative,
    logResponse,
    patchPlugin,
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

describe.skip('@weekly: Gateway Plugins: Confluent Consume', function () {
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
    let stream: any

    const schemaRegistryUrl = confluentConfig.schemaRegistry.url
    const schemaRegistryUsername = confluentConfig.schemaRegistry.username
    const schemaRegistryPassword = confluentConfig.schemaRegistry.password

    const controller = new AbortController()

    const output = randomString()
    const confluentTopic = 'confluent-consume-test-' + Date.now() + `-${output}`
    const newTopic = 'confluent-consume-test-update-' + Date.now() + `-${output}`
    const validSubjectNameForAvro = 'sdet-avro-valid-' + Date.now() + `-${output}`

    before(async function () {
        checkGwVars('confluent');

        await createConfluentTopics([confluentTopic, newTopic])
        // create service to use with confluent plugin to send messages
        const service = await createGatewayService('confluentLogService')
        const serviceId = service.id

        // create route for confluent plugin
        const logRoute = await createRouteForService(serviceId, [logPath], {
            name: 'confluentLogRoute',
        })
        logRouteId = logRoute.id

        // create confluent plugin to send messages to kafka
        const confluentLogPlugin = await createPlugin({
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
        })
        logPluginId = confluentLogPlugin.id

        // create route to use in testing
        const consumeRoute = await createRoute([consumePath], {
            name: 'confluentConsumeRoute',
        })
        consumeRouteId = consumeRoute.id

        await waitForConfigRebuild(4000)
    })

    it('should not create confluent-consume plugin without topic parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
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
                cluster_api_key: confluentConfig.apiKey,
                cluster_api_secret: confluentConfig.apiSecret,
                cluster_name: confluentConfig.clusterName,
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.topics: required field missing)'
        )
    })

    it('should not create confluent-consume plugin without cluster_api_key parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'confluent-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                topics: [{'name': confluentTopic}],
                bootstrap_servers: [
                    {
                        host: confluentConfig.host,
                        port: confluentConfig.port,
                    },
                ],
                cluster_api_secret: confluentConfig.apiSecret,
                cluster_name: confluentConfig.clusterName,
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.cluster_api_key: required field missing)'
        )
    })

    it('should not create confluent-consume plugin without cluster_api_secret parameter', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'confluent-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                topics: [{'name': confluentTopic}],
                bootstrap_servers: [
                    {
                        host: confluentConfig.host,
                        port: confluentConfig.port,
                    },
                ],
                cluster_api_key: confluentConfig.apiSecret,
                cluster_name: confluentConfig.clusterName,
            },
        })

        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.cluster_api_secret: required field missing)'
        )
    })

    it('should not create confluent-consume plugin with missing mode of operation', async function () {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'confluent-consume',
            route: {
                id: consumeRouteId,
            },
            config: {
                topics: [{'name': confluentTopic}],
                bootstrap_servers: [
                    {
                        host: confluentConfig.host,
                        port: confluentConfig.port,
                    },
                ],
                cluster_api_key: confluentConfig.apiKey,
                cluster_api_secret: confluentConfig.apiSecret,
                cluster_name: confluentConfig.clusterName,
                mode: null,
            },
        })
        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Should have correct error message').to.contain(
            'schema violation (config.mode: required field missing)'
        )
    })

    it('should create confluent-consume plugin', async function () {
        const resp = await axios({
            method: 'post',
            url: `${adminUrl}/plugins`,
            data: {
                name: 'confluent-consume',
                route: {
                    id: consumeRouteId,
                },
                config: {
                    topics: [{'name': confluentTopic}],
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

        expect(resp.status, 'Status should be 201').to.equal(201)
        expect(resp.data.name, 'Should have correct plugin name').to.equal('confluent-consume')
        expect(resp.data.config.topics[0], 'Should have correct topics').to.contain({'name': confluentTopic})
        expect(resp.data.config.bootstrap_servers, 'Should have correct bootstrap servers').to.eql([
            {
                host: confluentConfig.host,
                port: confluentConfig.port,
            },
        ])

        testPluginId = resp.data.id

        await waitForConfigRebuild()
    })

    it('should be able to consume messages with confluent-consume plugin', async function () {
        // send message via confluent plugin
        await sendConfluentMessage(logPath)

        // consume message via confluent-consume plugin
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
            })

            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data, 'Should show correct topic').to.have.property(confluentTopic)

            const confluentRecords = extractConfluentRecords(resp, confluentTopic)
            expect(confluentRecords, 'Should have records for topic').to.have.length.greaterThan(0)
        }, 90000, 15000)
    })

    it('should be able to update confluent-consume plugin topic', async function () {
        await updateConfluentTopic(newTopic, logPluginId)

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

    it('should be able to consume messages with confluent-consume plugin and updated topic', async function () {
        // send message via confluent plugin
        await sendConfluentMessage(logPath)

        // consume message via confluent-consume plugin
        await eventually(async() => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
            })
            expect(resp.data, 'Should show correct topic').to.have.property(newTopic)
            expect(resp.status, 'Status should be 200').to.equal(200)

            const confluentRecords = extractConfluentRecords(resp, newTopic)
            expect(confluentRecords, 'Should have records for topic').to.have.length.greaterThan(0)
        }, 90000, 15000)
    })

    it('should be able to update confluent-consume plugin with server-sent events enabled', async function () {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                route: {
                    id: consumeRouteId,
                },
                config: {
                    mode: 'server-sent-events',
                    topics: [{'name': newTopic}],
                },
            },
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.mode, 'Should have server-sent events enabled').to.equal('server-sent-events')
        testPluginId = resp.data.id

        await waitForConfigRebuild()
    })

    it('should be able to consume messages with confluent-consume plugin and server-sent events enabled', async function () {
        const resp = await axios({
            method: 'GET',
            url: `${proxyUrl}${consumePath}`,
            responseType: 'stream',
            signal: controller.signal,
        })
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.headers['content-type'], 'Should have correct content type').to.contain('text/event-stream')

        stream = resp.data

        await sendConfluentMessage(logPath)

        await eventually(async () => {
            await stream.on('data', async(chunk: Buffer) => {
                const data = chunk.toString()
                expect(data, 'should contain topic name').to.contain(newTopic)
            })
        }, 30000, 10000, false)
    })

    it('should be able to send multiple messages with confluent-consume plugin and server-sent events enabled', async function () {
        let messageCount = 0

        setTimeout(() => {
            for (let i = 0; i < 5; i++) {
                sendConfluentMessage(logPath)
            }
        }, 3000)

        await eventually(async () => {
            await stream.on('data', async(chunk: Buffer) => {
                const data = chunk.toString()
                expect(data, 'should contain topic name').to.contain(newTopic)
                messageCount += 1
                if (messageCount == 5) {
                    // close the stream
                    controller.abort()
                }
            })
            expect(messageCount, 'Should have received 5 messages').to.be.gte(5)
        }, 60000, 10000, false)
    })

    for (const registry of ['confluent']) { // will have appio eventually
        it('should not be able to update confluent-consume plugin with schema registry authentication and no username or password', async function () {
           // create a valid avro schema
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

           
            // update confluent plugin to use schema registry for remaining tests
            const confluent_plugin_payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    value_schema: {
                        schema_version: 'latest',
                        subject_name: validSubjectNameForAvro
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
            await patchPlugin(logPluginId, confluent_plugin_payload);

            // update confluent-consume plugin with schema registry but no username or password
            const confluent_consume_plugin_payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: {
                        mode: 'basic',
                    },
                },
            })
            const resp = await patchNegative(`${adminUrl}/plugins/${testPluginId}`, confluent_consume_plugin_payload)
            logResponse(resp)
            expect(resp.status, 'Status should be 400').to.equal(400)
            expect(resp.data.message, 'Should have correct error message').to.contain(
                "basic authentication details required when mode is 'basic"
            )
        })

        it('should be able to update confluent-consume plugin with schema registry and no authentication', async function () {
            const payload = makeSchemaRegistryConfig({
                registry,
                registryConfig: {
                    url: schemaRegistryUrl,
                    authentication: {
                        mode: 'none',
                    }
                }
            })
            const resp = await patchPlugin(testPluginId, payload)

            expect(resp.config.schema_registry[registry].authentication, 'should not include authentication').to.contain({
                mode: 'none',
            })
        })

        // it is skipped now because of https://konghq.atlassian.net/browse/FTI-7019
        xit('should not be able to receive message using secured schema registry without adding authentication in the plugin', async function () {
            await sendConfluentMessage(logPath)
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
                validateStatus: null,   
            })
            logResponse(resp)
            expect(resp.status, 'Status should be 500').to.equal(500)
        })

        it('should be able to update confluent-consume plugin with schema registry authentication', async function () {   
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
            expect(resp.config.topics[0], 'Should have correct topics').to.contain({'name': newTopic})
           
            await waitForConfigRebuild()
        })

        it('should be able to consume messages with confluent-consume plugin and schema registry authentication', async function () {
            // send message via confluent-log plugin
            await sendConfluentMessage(logPath)

            await eventually(async () => {
                const resp = await axios({
                    method: 'get',
                    url: `${proxyUrl}${consumePath}`,
                })
                logResponse(resp)

                expect(resp.status, 'Status should be 200').to.equal(200)
                expect(resp.data, 'Should show correct topic').to.have.property(newTopic)
    
                const confluentRecords = extractConfluentRecords(resp, newTopic)
                expect(confluentRecords, 'Should have records for topic').to.have.length.greaterThan(0)
            }, 90000, 7000)
        })
    }

    after(async function () {
        await deleteConfluentTopics([confluentTopic, newTopic])
        await deleteSchemas([validSubjectNameForAvro], schemaRegistryUrl, { username: schemaRegistryUsername, password: schemaRegistryPassword })
        await clearAllKongResources()
        // send abort signal to the stream
        controller.abort()
    })

})
