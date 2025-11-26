import axios from 'axios';

import {
  expect,
  Environment,
  getBasePath,
  isGateway,
  createGatewayService,
  createRouteForService,
  postNegative,
  clearAllKongResources,
  waitForConfigRebuild,
  eventually,
  initSolace,
  setUpSolaceConsumer,
  checkSolaceMessage,
  createSolaceQueues,
  deleteSolaceQueues,
  deletePlugin,
  logResponse,
  isSolaceDockerReady,
  connectSession,
  patchPlugin,
  createPlugin,
  checkOrStartServiceContainer,
  stopContainerByName,
  getContainerIP
} from '@support';
import solace from 'solclientjs';

/**
 * define a function to send Solace messages via Kong
 * @param url
 * @param msg
 * @returns
 */
const sendSolaceMsgViaKong = async (url: string, msg: string, headers: any = {}, code: number) => {
  let resp;
  await eventually(async () => {
    resp = await axios({
      method: 'post',
      url: url,
      headers: headers,
      data: { message: msg },
      validateStatus: null,
    });
    logResponse(resp);
    expect(resp.status, `Status should be ${code}`).to.equal(code);
  });
  return resp;
};

describe('Gateway Plugins: Solace Upstream Plugin', () => {
  const solacePath = '/solace';
  const topicName = 'test/topic';

  let ip;
  let session: solace.Session;
  let initialConsumer: solace.MessageConsumer;
  let backupConsumer: solace.MessageConsumer;
  let receivedMessage: string;
  let backupMessage: string;
  let initialDestination: solace.Destination | null = null;
  let backupDestination: solace.Destination | null = null;
  let topicDestination: solace.Destination;
  let sessionMessageHandler: ((msg: solace.Message) => void) | undefined;
  let initialConsumerHandler: ((msg: solace.Message) => void) | undefined;
  let backupConsumerHandler: ((msg: solace.Message) => void) | undefined;

  let solacePluginId: string;
  let solaceRouteId: string;
  let solaceConfig: any;

  let receivedDirectMsg = '';
  const queueNameArray: any = [];

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  });

  before(async function () {
    await checkOrStartServiceContainer('solace');
    await isSolaceDockerReady(); // Wait for Solace to be ready
    console.log('Initializing Solace session.');
    ({ session, solaceConfig } = initSolace());
    await connectSession(session); // Ensure session is up before proceeding

    console.log('Solace configuration:', solaceConfig);

    queueNameArray.push(solaceConfig.queueNames[0]);
    queueNameArray.push(solaceConfig.queueNames[1]);

    console.log('Creating Solace consumers.');
    initialConsumer = setUpSolaceConsumer(session, solaceConfig.queueNames[0]);
    backupConsumer = setUpSolaceConsumer(session, solaceConfig.queueNames[1]);

    // Save initial consumer handler so as to remove it later
    initialConsumerHandler = (message: solace.Message) => {
      receivedMessage = (message.getBinaryAttachment() || '').toString();
      initialDestination = message.getDestination();
    };
    // event listeners for message consumers
    initialConsumer.on(solace.MessageConsumerEventName.MESSAGE, initialConsumerHandler);

    backupConsumerHandler = (message: solace.Message) => {
      backupMessage = (message.getBinaryAttachment() || '').toString();
      backupDestination = message.getDestination();
    };
    backupConsumer.on(solace.MessageConsumerEventName.MESSAGE, backupConsumerHandler);

    console.log('Creating Solace queues.');
    await createSolaceQueues(solaceConfig.queueNames, solaceConfig);

    // create topic destination and start subscription
    topicDestination = solace.SolclientFactory.createTopicDestination(topicName);

    sessionMessageHandler = msg => {
      const msgContent = msg.getBinaryAttachment()?.toString() || '';
      console.log(`Received message: ${msgContent}`);
      receivedDirectMsg = msgContent;
    };
    session.on(solace.SessionEventCode.MESSAGE, sessionMessageHandler);

    session.subscribe(topicDestination, true, 'subscribe-correlation', 5000);
    console.log(`Subscribed to topic: ${topicName}`);

    // Create a gateway service and route for Solace
    console.log('Creating Solace service and route.');
    await createGatewayService('solaceService');
    const solaceRoute = await createRouteForService('solaceService', [solacePath], {
      name: 'solaceRoute',
    });
    solaceRouteId = solaceRoute.id;

    await waitForConfigRebuild();
    ip = await getContainerIP("solace");
    if (!ip) throw new Error('Failed to get Solace container IP address');
    console.log('[TEST] Solace container IP:', ip);
    ip = `tcp://${ip}:55555`;
  });

  /**
   * Attempt to create plugin with destinations: null
   * Expect 400 Bad Request with missing field error
   */
  it('should not create solace-upstream plugin without destinations field', async () => {
    await eventually(async () => {
      const resp = await postNegative(`${adminUrl}/plugins`, {
        name: 'solace-upstream',
        config: {
          session: {
            host: ip,
            authentication: {
              scheme: 'BASIC',
              username: solaceConfig.username,
              password: solaceConfig.password,
            },
          },
          message: {
            destinations: null,
          },
        },
      });
      expect(resp.status, 'Status should be 400').to.equal(400);
      expect(resp.data.message, 'Error message should include "required field missing"').to.include(
        'destinations = "required field missing"',
      );
    });
  });

  /**
   * Send request with scheme: BASIC, but no username/password
   * Expect 400 Bad Request with username = "required field missing"
   */
  it('should not be able to create solace-upstream plugin with authentication scheme but no credentials', async () => {
    await eventually(async () => {
      const resp = await postNegative(`${adminUrl}/plugins`, {
        name: 'solace-upstream',
        route: { id: solaceRouteId },
        config: {
          session: {
            host: ip,
            authentication: {
              scheme: 'BASIC',
            },
          },
          message: {
            destinations: [{ name: 'kong' }],
            forward_body: true,
          },
        },
      });
      expect(resp.status, 'Status should be 400').to.equal(400);
      expect(resp.data.message, 'Error message should include "required field missing"').to.include(
        "must set one of 'username', 'basic_auth_header' when 'scheme' is 'BASIC'",
      );
    });
  });

  /**
   * Provide complete session and destination config
   * Expect 201 Created and store the plugin ID
   */
  it('should successfully create solace plugin with valid configuration', async () => {
    const payload = {
      name: 'solace-upstream',
      route: { id: solaceRouteId },
      config: {
        session: {
          vpn_name: solaceConfig.vpnName,
          host: ip,
          authentication: {
            scheme: 'BASIC',
            username: solaceConfig.username,
            password: solaceConfig.password,
          },
        },
        message: {
          destinations: [{ name: solaceConfig.queueNames[0] }],
          forward_body: true,
        },
      },
    };
    const respData = await createPlugin(payload);
    expect(respData.name, 'Name should be solace-upstream').to.equal('solace-upstream');
    solacePluginId = respData.id;

    await waitForConfigRebuild();
  });

  /**
   * Connect consumer to queue & Send message through Kong proxy
   * Expect 200 OK and verify Solace queue receives correct message
   */
  it('should send a message to Solace', async () => {
    initialConsumer.connect();
    const resp = await sendSolaceMsgViaKong(`${proxyUrl}${solacePath}`, 'Hello Solace!', {}, 200);
    const msg = resp.data?.message ?? JSON.stringify(resp.data);
    expect(msg).to.include('message sent as a non-guaranteed direct delivery');

    await eventually(async () => {
      checkSolaceMessage(receivedMessage, 'Hello Solace!', initialDestination, solaceConfig.queueNames[0]);
    });
  });

  /**
   * Update plugin to disable body forwarding and set default message
   * Expect updated config with forward_body: false
   */
  it('should be able to update Solace Upstream plugin configuration to not forward body and add default message', async () => {
    const payload = {
      config: {
        message: {
          forward_body: false,
          default_content: 'Default message content!',
        },
      },
    };
    const respData = await patchPlugin(solacePluginId, payload);
    expect(respData.config.message.forward_body, 'Forward body should be false').to.be.false;
    expect(respData.config.message.default_content, 'Default content should be set').to.equal(
      'Default message content!',
    );

    await waitForConfigRebuild();
  });

  /**
   * Send message with forward_body: false
   * Expect default content received, not body content
   */
  it('should successfully send a message to Solace queue without body forwarding with solace-upstream plugin', async () => {
    receivedMessage = ''; // Reset
    const resp = await sendSolaceMsgViaKong(
      `${proxyUrl}${solacePath}`,
      'Hello Solace without body forwarding!',
      {},
      200,
    );

    //3.11 is beta version, it returns string, but on 3.12 it returns json
    expect(resp.data?.message ?? resp.data, 'Response should include message sent confirmation').to.include(
      'message sent as a non-guaranteed direct delivery',
    );

    await eventually(async () => {
      expect(receivedMessage, 'Received message should not include body').to.not.include('body_args');
      checkSolaceMessage(receivedMessage, 'Default message content!', initialDestination, solaceConfig.queueNames[0]);
    });
  });

  /**
   * Enable forwarding of body, headers, method, and URI
   * Expect config to reflect all forwards as true
   */
  it('should update Solace Upstream plugin to forward all parameters', async () => {
    const payload = {
      config: {
        message: {
          forward_body: true,
          forward_headers: true,
          forward_method: true,
          forward_uri: true,
        },
      },
    };
    const respData = await patchPlugin(solacePluginId, payload);
    expect(respData.config.message.forward_body, 'Forward body should be true').to.be.true;
    expect(respData.config.message.forward_headers, 'Forward headers should be true').to.be.true;
    expect(respData.config.message.forward_method, 'Forward method should be true').to.be.true;
    expect(respData.config.message.forward_uri, 'Forward URI should be true').to.be.true;

    await waitForConfigRebuild();
  });

  /**
   * Send POST request with headers and body
   * Expect Solace message to include: Message body, Custom header X-Kong-Header, HTTP method, URI
   */
  it('should send a message to Solace with all parameters forwarded', async () => {
    receivedMessage = ''; // Reset
    const url = `${proxyUrl}${solacePath}`;
    const message = 'Hello Solace with all parameters!';
    const header = {
      'X-Kong-Header': 'TestHeader',
    };
    const resp = await sendSolaceMsgViaKong(url, message, header, 200);
    expect(resp.data?.message ?? resp.data, 'Response should include message sent confirmation').to.include(
      'message sent as a non-guaranteed direct delivery',
    );

    await eventually(async () => {
      checkSolaceMessage(
        receivedMessage,
        'Hello Solace with all parameters!',
        initialDestination,
        solaceConfig.queueNames[0],
      );
      expect(receivedMessage, 'Received message should include "X-Kong-Header: TestHeader"').to.include(
        '"x-kong-header":"TestHeader"',
      );
      expect(receivedMessage, 'Received message should include "POST" method').to.include('POST');
      expect(receivedMessage, 'Received message should include the URI').to.include(solacePath);
    });
  });

  /**
   * Patch plugin with dmq_eligible: true
   * Expect updated config
   */
  it('should be able to update solace-upstream plugin to use dead message queue', async () => {
    const payload = {
      config: {
        message: {
          dmq_eligible: true,
        },
      },
    };
    const respData = await patchPlugin(solacePluginId, payload);
    expect(respData.config.message.dmq_eligible, 'DMQ eligible should be true').to.be.true;

    await waitForConfigRebuild();
  });

  /**
   * Send POST request
   * Validate message is received and processed properly
   */
  it('should send a message to Solace with dead message queue enabled', async () => {
    const resp = await sendSolaceMsgViaKong(`${proxyUrl}${solacePath}`, 'Hello Solace with DMQ!', {}, 200);
    expect(resp.data?.message ?? resp.data, 'Response should include message sent confirmation').to.include(
      'message sent as a non-guaranteed direct delivery',
    );
    await eventually(async () => {
      checkSolaceMessage(receivedMessage, 'Hello Solace with DMQ!', initialDestination, solaceConfig.queueNames[0]);
    });
  });

  /**
   * Patch plugin with delivery_mode: PERSISTENT
   * Expect updated config with PERSISTENT mode
   */
  it('should be able to change message delivery mode of solace-upstream plugin to guaranteed', async () => {
    const payload = {
      config: {
        message: {
          delivery_mode: 'PERSISTENT',
        },
      },
    };
    const respData = await patchPlugin(solacePluginId, payload);
    expect(respData.config.message.delivery_mode, 'Delivery mode should be guaranteed').to.equal('PERSISTENT');

    await waitForConfigRebuild();
  });

  /**
   * Send POST request
   * Verify message is delivered and received correctly
   */
  it('should send a message to Solace with guaranteed delivery mode', async () => {
    const resp = await sendSolaceMsgViaKong(
      `${proxyUrl}${solacePath}`,
      'Hello Solace with guaranteed delivery!',
      {},
      200,
    );
    expect(resp.data?.message ?? resp.data, 'Response should include message sent confirmation').to.include(
      'message sent',
    );

    await eventually(async () => {
      checkSolaceMessage(
        receivedMessage,
        'Hello Solace with guaranteed delivery!',
        initialDestination,
        solaceConfig.queueNames[0],
      );
    });
  });

  /**
   * Set destinations to two queues
   * Expect config updated with 2 destinations
   */
  it('should be able to update solace-upstream to deliver message to multiple destinations', async () => {
    const payload = {
      config: {
        message: {
          destinations: [{ name: solaceConfig.queueNames[0] }, { name: solaceConfig.queueNames[1] }],
        },
      },
    };
    const respData = await patchPlugin(solacePluginId, payload);
    expect(respData.config.message.destinations.length, 'Destinations should be 2').to.equal(2);

    await waitForConfigRebuild();
  });

  /**
   * Connect second consumer
   * Send message
   * Validate message is received by both queues
   */
  it('should send a message to multiple destinations using solace-upstream plugin', async () => {
    backupConsumer.connect();

    const resp = await sendSolaceMsgViaKong(
      `${proxyUrl}${solacePath}`,
      'Hello Solace with multiple destinations!',
      {},
      200,
    );
    expect(resp.data?.message ?? resp.data, 'Response should include message sent confirmation').to.include(
      'message sent',
    );

    await eventually(async () => {
      checkSolaceMessage(
        backupMessage,
        'Hello Solace with multiple destinations!',
        backupDestination,
        solaceConfig.queueNames[1],
      );
    });
  });

  /**
   * Keep only the second queue in destinations
   * Expect config updated with 1 destination
   */
  it('should be able to remove one of the destinations from solace-upstream plugin', async () => {
    await eventually(async () => {
      const resp = await axios({
        method: 'patch',
        url: `${adminUrl}/plugins/${solacePluginId}`,
        data: {
          config: {
            message: {
              destinations: [{ name: solaceConfig.queueNames[1] }],
            },
          },
        },
        validateStatus: null,
      });
      expect(resp.status, 'Status should be 200').to.equal(200);
      expect(resp.data.config.message.destinations.length, 'Destinations should be 1').to.equal(1);
    });
    await waitForConfigRebuild();
  });

  /**
   * Send message
   * Validate only second queue receives message
   */
  it('should send a message to the remaining destination using solace-upstream plugin', async () => {
    backupMessage = '';
    const resp = await sendSolaceMsgViaKong(`${proxyUrl}${solacePath}`, 'Hello Solace with one destination!', {}, 200);
    expect(resp.data?.message ?? resp.data, 'Response should include message sent confirmation').to.include(
      'message sent',
    );

    backupConsumer.connect();
    await eventually(async () => {
      checkSolaceMessage(
        backupMessage,
        'Hello Solace with one destination!',
        backupDestination,
        solaceConfig.queueNames[1],
      );
    });
  });

  /**
   * Assert first consumer didn’t receive the message
   */
  it('should not receive message while consuming messages from removed destination', async () => {
    await eventually(async () => {
      expect(
        receivedMessage,
        'Received message should not include "Hello Solace with one destination!"',
      ).to.not.include('Hello Solace with one destination!');
    });
  });

  /**
   * Set vpn_name: not_a_vpn
   * Expect config updated successfully
   */
  it('should be able to change session vpn name to invalid one', async () => {
    const payload = {
      config: {
        session: {
          vpn_name: 'not_a_vpn',
        },
        message: {
          destinations: [{ name: solaceConfig.queueNames[0] }],
        },
      },
    };
    const respData = await patchPlugin(solacePluginId, payload);
    expect(respData.config.session.vpn_name, 'VPN name should be not_a_vpn').to.equal('not_a_vpn');
    await waitForConfigRebuild();
  });

  /**
   * Send message to Solace using invalid VPN
   * Expect 500 Internal Server Error
   */
  it('should not be able to send a message to Solace with wrong VPN name', async () => {
    await sendSolaceMsgViaKong(`${proxyUrl}${solacePath}`, 'Hello Solace with wrong VPN name!', {}, 500);
  });

  /**
   * Send direct message via Solace session to topic
   * Verify client subscribed to topic receives message
   */
  it('should deliver a direct message to topic successfully', async () => {
    receivedDirectMsg = ''; // Reset
    const payload = {
      config: {
        session: {
          vpn_name: solaceConfig.vpnName,
        },
        message: {
          destinations: [{ name: topicName, type: 'TOPIC' }],
          delivery_mode: 'DIRECT',
          forward_body: true,
        },
      },
    };

    await patchPlugin(solacePluginId, payload);
    await waitForConfigRebuild();

    await sendSolaceMsgViaKong(`${proxyUrl}${solacePath}`, 'Hello topic!', {}, 200);

    await eventually(async () => {
      expect(receivedDirectMsg).to.include('Hello topic!');
    });
  });

  /**
   * Delete the plugin using stored ID
   * Expect no errors
   */
  it('should be able to delete solace-upstream plugin', async () => {
    await deletePlugin(solacePluginId);
  });

  after(async () => {
    //remove listeners to release resources
    if (sessionMessageHandler) {
      session?.removeListener(String(solace.SessionEventCode.MESSAGE), sessionMessageHandler);
    }
    if (initialConsumerHandler) {
      initialConsumer?.removeListener(solace.MessageConsumerEventName.MESSAGE, initialConsumerHandler);
    }
    if (backupConsumerHandler) {
      backupConsumer?.removeListener(solace.MessageConsumerEventName.MESSAGE, backupConsumerHandler);
    }
    //disconnect consumers and session
    initialConsumer?.disconnect();
    backupConsumer?.disconnect();
    session?.disconnect();

    //delete Solace queue
    await deleteSolaceQueues(queueNameArray, solaceConfig);
    await stopContainerByName('solace');
    await clearAllKongResources();
  });
});
