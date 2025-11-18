import axios from 'axios';
import {
    expect,
    createGatewayService,
    createRouteForService,
    createPlugin,
    getBasePath,
    Environment,
    logResponse,
    runDockerContainerCommand,
    deleteGatewayService,
    deleteGatewayRoute,
    deletePlugin,
    waitForConfigRebuild,
    clearAllKongResources,
    createConsumer,
    createKeyAuthCredentialsForConsumer,
    deleteConsumer,
    randomString,
    createKeyCredentialForConsumer,
    eventually,
    isGwHybrid,
    createWorkspace,
    deleteWorkspace
  } from '@support';

const isHybrid = isGwHybrid();

// skip tests if not running gateway in hybrid mode
(isHybrid ?  describe : describe.skip)('Start and Stop DP', function () {
  const workspaceName = 'sdet-workspace-start-stop-dp';
  const path = `/${randomString()}`;
  const serviceName = `${randomString()}`;
  const dataPlane1 = "kong-dp1";
  const pluginPayload = {
    name: "key-auth-enc",
    config: { "key_names": ["apikey"] }
  };

  let proxyUrl: string
  let serviceId: string;
  let routeId: string;
  let pluginId: string;
  let consumerId: string;
  let consumerKey: string;

  before(async function () {
    proxyUrl = `${getBasePath({
      app: 'gateway',
      environment: Environment.gateway.proxy,
    })}`;

    // create a non-default workspace
    await createWorkspace(workspaceName);
    // create service, route, plugin and consumer in the non-default workspace
    const service = await createGatewayService(serviceName, undefined, workspaceName);
      serviceId = service.id;
    const route = await createRouteForService(serviceId, [path], undefined, workspaceName);
    routeId = route.id;    
    const plugin = await createPlugin(pluginPayload, workspaceName);
    pluginId = plugin.id;
    const consumer = await createConsumer(undefined, undefined, workspaceName);
    consumerId = consumer.id;
    const consumerKeyReq = await createKeyAuthCredentialsForConsumer(consumerId, workspaceName);
    consumerKey = consumerKeyReq.key;    

    await waitForConfigRebuild()
  });

  it('plugin should work as expected - Requests with a valid apikey returns 200', async function () {
    const url = `${proxyUrl}${path}`;
    console.log(url);

    const resp = await axios({
      url: url,
      headers: { ['apikey']: consumerKey },
    });

    //Verify the responses
    logResponse(resp);
    expect(resp.status, 'Status should be 200').equal(200);
  });

  it('stop data plane container and delete created entities', async function () {
    // stop data plane container
    runDockerContainerCommand(dataPlane1, 'stop');
    runDockerContainerCommand(dataPlane1, 'container wait');

    // Delete entities created
    await deleteConsumer(consumerId);
    await deletePlugin(pluginId);
    await deleteGatewayRoute(routeId);
    await deleteGatewayService(serviceId);
  });


  it('recreate intities using the same ids and start data plance container', async function () {
    const pluginPayload = {
      name: "key-auth",
      config: { "key_names": ["apikey"] }
    };

    await createGatewayService(serviceName, undefined, workspaceName, serviceId);
    await createRouteForService(serviceId, [path], undefined, workspaceName, routeId);
    await createPlugin(pluginPayload, workspaceName, pluginId);
    await createConsumer(undefined, undefined, workspaceName, consumerId);
    const consumerKeyReq = await createKeyCredentialForConsumer(consumerId, 'key-auth', { 'key': 'top-secret-key' }, workspaceName);
    consumerKey = consumerKeyReq.key;

    // restart data plane container
    runDockerContainerCommand(dataPlane1, 'start');
    await eventually(async () => {
      const containerStatus = JSON.parse(await runDockerContainerCommand(dataPlane1, "inspect"))
      expect(typeof containerStatus).to.equal("object")
      expect(typeof containerStatus[0]).to.equal("object")
      expect(containerStatus[0]?.State?.Health?.Status).to.equal("healthy")
    });
  });

  it('plugin should still work as expected - Requests with a valid apikey returns 200', async function () {
    const resp = await axios({
      url: `${proxyUrl}${path}`,
      headers: { ['apikey']: consumerKey },
    });

    //Verify the responses
    logResponse(resp);
    expect(resp.status, 'Status should be 200').equal(200);
  });

  after(async function () {
    // clean up entities 
    await clearAllKongResources(workspaceName);
    // delete non-default workspace
    await deleteWorkspace(workspaceName);

    try {
      // Inspect the kong-dp1 container
      const containerStatus = JSON.parse(runDockerContainerCommand('kong-dp1', 'inspect'));
    
      // Check if the container is running and healthy
      const isHealthy = containerStatus[0]?.State?.Health?.Status === 'healthy';
    
      if (!isHealthy) {
        console.log('kong-dp1 container is not running or unhealthy. Restarting...');
        runDockerContainerCommand('kong-dp1', 'restart');
      } else {
        console.log('kong-dp1 container is running and healthy.');
      }
    } catch (error) {
      console.error('Error checking kong-dp1 container status:', error);
      console.log('Attempting to restart kong-dp1 container...');
      runDockerContainerCommand('kong-dp1', 'restart');
    }
  });
});
