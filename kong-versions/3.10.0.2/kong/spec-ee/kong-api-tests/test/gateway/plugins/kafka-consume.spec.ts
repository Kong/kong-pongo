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
    kafkaConfig,
    sendKafkaMessage,
    updateKafkaLogTopic,
} from '@support'

describe('Gateway Plugins: Kafka and Confluent Consume Plugins', function() {
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

    const output = randomString()
    const consumeTopic = `test-${output}`
    const newTopic = `new-${output}`

    before(async function () {
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

    // TODO: Unskip when KAG-6573 is complete
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
        expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': consumeTopic}])
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
        expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': newTopic}])

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

    // KAG-6441
    it('should be able to update kafka-consume plugin with server-sent events enabled', async function () {
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
        expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': newTopic}])
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

    // TODO: add SCRAM-SHA-256 and SCRAM-SHA-512 (blocked by KAG-6693)
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
            expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': authTopic}])
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
            expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': authTopic}])
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
        await clearAllKongResources()
        // send abort and close signals just in case
        controller.abort()
    })
})