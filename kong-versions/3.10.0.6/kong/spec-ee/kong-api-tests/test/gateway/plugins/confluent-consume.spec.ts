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
} from '@support'


describe('@weekly: Gateway Plugins: Confluent Consume', function () {
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

    const controller = new AbortController()

    const confluentTopic = 'confluent-consume-test-' + Date.now()
    const newTopic = 'confluent-consume-test-update-' + Date.now()

    before(async function () {
        checkGwVars('confluent');

        await createConfluentTopics([confluentTopic, newTopic])
        // create service to use with kafka-log to send messages
        const service = await createGatewayService('confluentLogService')
        const serviceId = service.id
        
        // create route for kafka-log plugin
        const logRoute = await createRouteForService(serviceId, [logPath], {
            name: 'confluentLogRoute',
        })
        logRouteId = logRoute.id

        // create kafka-log plugin to send messages to kafka
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
            },
        })
        logPluginId = confluentLogPlugin.id
        
        // create route to use in testing
        const consumeRoute = await createRoute([consumePath], {
            name: 'confluentConsumeRoute',
        })
        consumeRouteId = consumeRoute.id

        await waitForConfigRebuild()
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
        expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': confluentTopic}])
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

        // consume message via kafka-consume plugin
        await eventually(async () => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
            })

            expect(resp.status, 'Status should be 200').to.equal(200)
            expect(resp.data, 'Should show correct topic').to.have.property(confluentTopic)

            const confluentRecords = extractConfluentRecords(resp, confluentTopic)
            expect(confluentRecords, 'Should have records for topic').to.have.length.greaterThan(0)
        }, 90000, 5000)
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
        expect(resp.data.config.topics, 'Should have correct topics').to.eql([{'name': newTopic}])

        await waitForConfigRebuild()
    })

    it('should be able to consume messages with confluent-consume plugin and updated topic', async function () {
        // send message via kafka-log plugin
        await sendConfluentMessage(logPath)

        // consume message via kafka-consume plugin
        await eventually(async() => {
            const resp = await axios({
                method: 'get',
                url: `${proxyUrl}${consumePath}`,
            })
            expect(resp.data, 'Should show correct topic').to.have.property(newTopic)    
            expect(resp.status, 'Status should be 200').to.equal(200)

            const confluentRecords = extractConfluentRecords(resp, newTopic)
            expect(confluentRecords, 'Should have records for topic').to.have.length.greaterThan(0)
        }, 60000, 5000)
    })

    it('should be able to update confluent-consume plugin with server-sent events enabled', async function () {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${testPluginId}`,
            data: {
                name: 'confluent-consume',
                route: {
                    id: consumeRouteId,
                },
                config: {
                    mode: 'server-sent-events',
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
        }, 30000, 5000, false)  
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
        }, 60000, 5000, false)
    })

    after(async function () {
        await deleteConfluentTopics([confluentTopic, newTopic])
        await clearAllKongResources()
        // send abort signal to the stream
        controller.abort()
    })

})
