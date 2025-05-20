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
    kafkaConfig,
} from '@support'

describe('Gateway Plugins: Kafka Log', function() {
    const logPath = '/log'
    const consumePath = '/consume'

    const adminUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
    })
    const proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
    })

    const output = randomString()
    const logTopic = `test-${output}`
    const newTopic = `new-${output}`

    let testPluginId: string
    let kafkaConsumePluginId: string
    let consumeRouteId: string
    let logRouteId: string
    let requestId: string

    before(async function () {
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
                topics: [{'name': logTopic}],
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
                access: [`kong.service.request.enable_buffering() kong.log.set_serialize_value("request.body",
                    kong.request.get_body())`],
                log: [`kong.log.set_serialize_value("response.body", kong.service.response.get_body())`]
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
            }
        })

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.topic, 'Should have correct topic').to.eql(newTopic)

        await waitForConfigRebuild()
    })

    it('should be able to send messages with kafka-log plugin and new, empty topic', async function () {
        const resp = await axios.get(`${proxyUrl}${logPath}`)

        expect(resp.status, 'Status should be 200').to.equal(200)
        requestId = resp.headers['x-kong-request-id']
    })

    it('should be able to see request data sent with kafka-log in kafka with new topic', async function () {   
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
        await clearAllKongResources()
    })
})
