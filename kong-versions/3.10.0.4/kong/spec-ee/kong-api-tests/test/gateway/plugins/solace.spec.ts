import axios from 'axios'
import  {
    expect,
    Environment,
    getBasePath,
    isGateway,
    createGatewayService,
    createRouteForService,
    postNegative,
    clearAllKongResources,
    logResponse,
    waitForConfigRebuild,
    eventually,
    isGwHybrid,
    getSolaceConfig,
    initSolace,
    setUpSolaceConsumer,
    checkSolaceMessage,
    createSolaceQueues,
    deleteSolaceQueues,
    deletePlugin,
} from '@support'
import solace from 'solclientjs' 

describe.skip('Gateway Plugins: Solace Upstream Plugin', () => {
    const solacePath = '/solace'

    let session: solace.Session
    let initialConsumer: solace.MessageConsumer
    let backupConsumer: solace.MessageConsumer
    let receivedMessage: string
    let backupMessage: string 
    let initialDestination: solace.Destination | null = null
    let backupDestination: solace.Destination | null = null

    let solacePluginId: string
    let solaceRouteId: string

    let solaceConfig: any

    const isHybrid = isGwHybrid()

    const testTimeout = isHybrid ? 10000 : 2000

    const adminUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
    })

    const proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
    })

    before(async function()  {
        console.log('Initializing Solace session.')
        session = await initSolace()

        solaceConfig = await getSolaceConfig()
        console.log('Solace configuration:', solaceConfig)

        console.log('Creating Solace consumers.')
        initialConsumer = await setUpSolaceConsumer(session, solaceConfig.queueNames[0])
        backupConsumer = await setUpSolaceConsumer(session, solaceConfig.queueNames[1])

        // event listeners for message consumers
        initialConsumer.on(solace.MessageConsumerEventName.MESSAGE, (message: solace.Message) => {
            receivedMessage = (message.getBinaryAttachment() || '').toString()
            initialDestination = message.getDestination()
        })

        backupConsumer.on(solace.MessageConsumerEventName.MESSAGE, (message: solace.Message) => {
            backupMessage = (message.getBinaryAttachment() || '').toString()
            backupDestination = message.getDestination()
        })
    
        console.log('Creating Solace queues.')
        await createSolaceQueues(solaceConfig.queueNames)

        // Create a gateway service and route for Solace
        console.log('Creating Solace service and route.')
        await createGatewayService('solaceService')
        const solaceRoute = await createRouteForService('solaceService', [solacePath], {
            name: 'solaceRoute',
        })
        solaceRouteId = solaceRoute.id

    })

    it('should not create solace-upstream plugin without destinations field', async () => {
        const resp = await postNegative(`${adminUrl}/plugins`, {
             name: 'solace-upstream',
             config: {
                session: {
                    host: solaceConfig.host,
                    authentication: {
                        scheme: 'BASIC',
                        username: solaceConfig.username,
                        password: solaceConfig.password
                    }
                },
                message: {
                    destinations: null
                }
             }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Error message should include "required field missing"').to.include('destinations = "required field missing"')
    })

    it('should not be able to create solace-upstream plugin with authentication scheme but no credentials', async () => {
        const resp = await postNegative(`${adminUrl}/plugins`, {
            name: 'solace-upstream',
            route: { id: solaceRouteId },
            config: {
                session: {
                    host: solaceConfig.host,
                    authentication: {
                        scheme: 'BASIC'
                    }
                },
                message: {
                    destinations: [{"name": "kong"}],
                    forward_body: true,
                }
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 400').to.equal(400)
        expect(resp.data.message, 'Error message should include "required field missing"').to.include('username = "required field missing"')
    })

    it('should successfully create solace plugin with valid configuration', async () => {
        const resp = await axios({
            method: 'post',
            url: `${adminUrl}/plugins`,
            data: {
                name: 'solace-upstream',
                route: { id: solaceRouteId },
                config: {
                    session: {
                        vpn_name: solaceConfig.vpnName,
                        host: solaceConfig.host,
                        authentication: {
                            scheme: 'BASIC',
                            username: solaceConfig.username,
                            password: solaceConfig.password
                        }
                    }, 
                    message: {
                        destinations: [{"name": solaceConfig.queueNames[0]}],
                        forward_body: true,
                    }
                }
            }
        })
        logResponse(resp)

        expect(resp.status, 'Status should be 201').to.equal(201)
        expect(resp.data.name, 'Name should be solace-upstream').to.equal('solace-upstream')
        solacePluginId = resp.data.id

        await waitForConfigRebuild()
    })

    it('should send a message to Solace', async () => {
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${solacePath}`,
            data: {
                message: 'Hello Solace!'
            },
            validateStatus: null, 
        })
        logResponse(resp)

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.message, 'Response should include message sent confirmation').to.include('message sent as a non-guaranteed direct delivery')

        initialConsumer.connect()

        await eventually(async () => {
            await checkSolaceMessage(receivedMessage, 'Hello Solace!', initialDestination, solaceConfig.queueNames[0])
        }, testTimeout)
    })

    it('should be able to update Solace Upstream plugin configuration to not forward body and add default message', async () => {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${solacePluginId}`,
            data: {
                config: {
                    message: {
                        forward_body: false,
                        default_content: 'Default message content!'
                    }
                }
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.message.forward_body, 'Forward body should be false').to.be.false
        expect(resp.data.config.message.default_content, 'Default content should be set').to.equal('Default message content!')

        await waitForConfigRebuild()
    })

    it('should successfully send a message to Solace queue without body forwarding with solace-upstream plugin', async () => {
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${solacePath}`,
            data: {
                message: 'Hello Solace without body forwarding!'
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.message, 'Response should include message sent confirmation').to.include('message sent as a non-guaranteed direct delivery')

        await eventually(async () => {
            expect(receivedMessage, 'Received message should not include body').to.not.include("body_args")
            await checkSolaceMessage(receivedMessage, 'Default message content!', initialDestination, solaceConfig.queueNames[0])
        }, testTimeout)
    })

    it('should update Solace Upstream plugin to forward all parameters', async () => {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${solacePluginId}`,
            data: {
                config: {
                    message: {
                        forward_body: true,
                        forward_headers: true,
                        forward_method: true,
                        forward_uri: true,
                    }
                }
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.message.forward_body, 'Forward body should be true').to.be.true
        expect(resp.data.config.message.forward_headers, 'Forward headers should be true').to.be.true

        await waitForConfigRebuild()
    })

    it('should send a message to Solace with all parameters forwarded', async () => {
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${solacePath}`,
            headers: {
                'X-Kong-Header': 'TestHeader',
            },
            data: {
                message: 'Hello Solace with all parameters!'
            }
        })

        logResponse(resp)

        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.message, 'Response should include message sent confirmation').to.include('message sent as a non-guaranteed direct delivery')

        await eventually(async () => {
            checkSolaceMessage(receivedMessage, 'Hello Solace with all parameters!', initialDestination, solaceConfig.queueNames[0])
            expect(receivedMessage, 'Received message should include "X-Kong-Header: TestHeader"').to.include('"x-kong-header":"TestHeader"')
            expect(receivedMessage, 'Received message should include "POST" method').to.include('POST')
            expect(receivedMessage, 'Received message should include the URI').to.include(solacePath)
        }, testTimeout)
    })

    it('should be able to update solace-upstream plugin to use dead message queue', async () => {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${solacePluginId}`,
            data: {
                config: {
                    message: {
                        dmq_eligible: true,
                    }
                }
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.message.dmq_eligible, 'DMQ eligible should be true').to.be.true

        await waitForConfigRebuild()
    })

    it('should send a message to Solace with dead message queue enabled', async () => {
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${solacePath}`,
            data: {
                message: 'Hello Solace with DMQ!'
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.message, 'Response should include message sent confirmation').to.include('message sent as a non-guaranteed direct delivery')

        await eventually(async () => {
            checkSolaceMessage(receivedMessage, 'Hello Solace with DMQ!', initialDestination, solaceConfig.queueNames[0])
        }, testTimeout)
    })

    it('should be able to change message delivery mode of solace-upstream plugin to guaranteed', async () => {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${solacePluginId}`,
            data: {
                config: {
                    message: {
                        delivery_mode: 'PERSISTENT',
                    }
                }
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.message.delivery_mode, 'Delivery mode should be guaranteed').to.equal('PERSISTENT')

        await waitForConfigRebuild()
    })

    it('should send a message to Solace with guaranteed delivery mode', async () => {
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${solacePath}`,
            data: {
                message: 'Hello Solace with guaranteed delivery!'
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.message, 'Response should include message sent confirmation').to.include('message sent')

        await eventually(async () => {
            checkSolaceMessage(receivedMessage, 'Hello Solace with guaranteed delivery!', initialDestination, solaceConfig.queueNames[0])
        }, testTimeout)
    })

    it('should be able to update solace-upstream to deliver message to multiple destinations', async () => {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${solacePluginId}`,
            data: {
                config: {
                    message: {
                        destinations: [
                            {"name": solaceConfig.queueNames[0]},
                            {"name": solaceConfig.queueNames[1]}
                        ],
                    }
                }
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.message.destinations.length, 'Destinations should be 2').to.equal(2)

        await waitForConfigRebuild()
    })

    it('should send a message to multiple destinations using solace-upstream plugin', async () => {
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${solacePath}`,
            data: {
                message: 'Hello Solace with multiple destinations!'
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.message, 'Response should include message sent confirmation').to.include('message sent')

        await eventually(async () => {
            checkSolaceMessage(receivedMessage, 'Hello Solace with multiple destinations!', initialDestination, solaceConfig.queueNames[0])
        }, testTimeout)

        backupConsumer.connect()

        await eventually(async () => {
            checkSolaceMessage(backupMessage, 'Hello Solace with multiple destinations!', backupDestination, solaceConfig.queueNames[1])
        }, testTimeout)
    })

    it('should be able to remove one of the destinations from solace-upstream plugin', async () => {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${solacePluginId}`,
            data: {
                config: {
                    message: {
                        destinations: [
                            {"name": solaceConfig.queueNames[1]}
                        ],
                    }
                }
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.message.destinations.length, 'Destinations should be 1').to.equal(1)

        await waitForConfigRebuild()
    })

    it('should send a message to the remaining destination using solace-upstream plugin', async () => {
        const resp = await axios({
            method: 'post',
            url: `${proxyUrl}${solacePath}`,
            data: {
                message: 'Hello Solace with one destination!'
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.message, 'Response should include message sent confirmation').to.include('message sent')

        backupConsumer.connect()

        await eventually(async () => {
            checkSolaceMessage(backupMessage, 'Hello Solace with one destination!', backupDestination, solaceConfig.queueNames[1])
        }, testTimeout)
    })

    it('should not see message while consuming messages from removed destination', async () => {
        await eventually(async () => {
            expect(receivedMessage, 'Received message should not include "Hello Solace with one destination!"').to.not.include('Hello Solace with one destination!')
        }, testTimeout)
    })

    it('should be able to change session vpn name', async () => {
        const resp = await axios({
            method: 'patch',
            url: `${adminUrl}/plugins/${solacePluginId}`,
            data: {
                config: {
                    session: {
                        vpn_name: 'not_a_vpn',
                    },
                    message: {
                        destinations: [
                            {"name": solaceConfig.queueNames[0]}
                        ],
                    }
                }
            }
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 200').to.equal(200)
        expect(resp.data.config.session.vpn_name, 'VPN name should be not_a_vpn').to.equal('not_a_vpn')

        await waitForConfigRebuild()
    })

    it('should not be able to send a message to Solace with wrong VPN name', async () => {
        const resp = await postNegative(
            `${proxyUrl}${solacePath}`,
            {
                message: 'Hello Solace with wrong VPN name!'
            }
        )
        logResponse(resp)
        expect(resp.status, 'Status should be 500').to.equal(500)
    })

    it('should be able to delete solace-upstream plugin', async () => {
        const resp = await axios({
            method: 'delete',
            url: `${adminUrl}/plugins/${solacePluginId}`,
        })
        logResponse(resp)
        expect(resp.status, 'Status should be 204').to.equal(204)
    })

    after(async () => {
        console.log(`config was ${solaceConfig.host}`)
        clearAllKongResources()
        if (session) {
            session.disconnect()
        }

        //delete Solace queue
        await deleteSolaceQueues(solaceConfig.queueNames)
    })
})
