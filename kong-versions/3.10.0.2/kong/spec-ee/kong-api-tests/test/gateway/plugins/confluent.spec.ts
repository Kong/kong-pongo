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
} from '@support'

describe('Gateway Plugins: Confluent', function () {
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

    const confluentTopic = confluentConfig.topics[0]
    const newTopic = confluentConfig.topics[1]

    before(async function () {
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
        console.log('Confluent consume plugin created with ID:', confluentConsumePlugin)

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
        console.log('Logging confluent plugin creation response')
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
        const confluentRecords = await consumeAndExtractConfluentMessage(confluentTopic, consumePath)
        await checkConfluentRecords(confluentRecords, 'body', '{}')

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
        expect(resp.data.config.topic, 'Should have correct topic').to.eql(newTopic)

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
        // update confluent-consume plugin to forward headers
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${confluentPluginId}`,
            data: {
                config: {
                    forward_headers: true,
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

    it('should be able to update message_by_lua_functions to replace message in kafka-log plugin', async function () {
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
        })

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
        console.log(confluentRecords)
        checkConfluentRecords(confluentRecords, 'msg', 'hello world!')
    })

    after(async function () {
        await clearAllKongResources()
    })
})