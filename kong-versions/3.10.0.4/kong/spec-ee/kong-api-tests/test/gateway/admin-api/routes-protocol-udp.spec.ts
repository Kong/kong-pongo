import {
  expect,
  createGatewayService,
  createRouteForService,
  deleteGatewayService,
  deleteGatewayRoute,
  resetGatewayContainerEnvVariable,
  randomString,
  isGwHybrid,
  getKongContainerName,
  sendUdpRequest,
  eventually,
  patchRoute,
  getDockerNetworkGatewayIP,
  getDockerContainerIP,
  waitForConfigRebuild,
  getIncrementalSyncStatus
} from '@support';


interface TestOptions {
  host: string;
  port: number;
  message: string;
  optional?: {
    expectResponse?: boolean;
    sourcePort?: number;
    timeout?: number;
  };
  expected?: string;
}

async function testRoute(testOptions: TestOptions) {
  await eventually(async () => {
    const response = await sendUdpRequest(
      testOptions.host,
      testOptions.port,
      testOptions.message,
      testOptions.optional
    );

    console.log('UDP Response:', response);
    expect(response).equal(testOptions.expected);
  });
}

async function updateRouteAndTest(routeId: string, patchData: Record<string, any>, testOptions: TestOptions) {
  const resp = await patchRoute(routeId, patchData);
  expect(resp.status).to.equal(200);
  await testRoute(testOptions);
}

describe('Gateway Admin API: UDP Route Tests', function () {
  const udpURL = 'udp://udp-server:9365';
  let serviceId: string;
  let routeId: string;
  let gatewayIp: string;
  let containerIp: string;
  const streamListenPort = isGwHybrid() ? 7001 : 7000;
  const invalidIp = '172.16.0.1';
  const portForSources = 1234;
  const baseRequestOptions: TestOptions = {
    host: 'localhost',
    port: streamListenPort,
    message: 'hello kong'
  };
  const successTest = () => ({
    ...baseRequestOptions,
    expected: `[REPLY FROM UDP]: hello kong`
  });
  const failureTest = () => ({
    ...baseRequestOptions,
    optional: { expectResponse: false },
    expected: ''
  });

  before(async function () {
    // Skip the whole tests if incremental sync is enabled and hybrid mode is active because of KAG-7411
    const isInsync = await getIncrementalSyncStatus();
    if ( isInsync && isGwHybrid()) {
      this.skip(); 
    }

    // Set gateway environment variables
    await resetGatewayContainerEnvVariable(
      {
        KONG_STREAM_LISTEN: "0.0.0.0:7000 udp"
      },
      getKongContainerName()
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_STREAM_LISTEN: "0.0.0.0:7001 udp"
        },
        'kong-dp1'
      );
    }
    // Create a UDP service and route
    const service = await createGatewayService(randomString(), { url: udpURL });
    serviceId = service.id;
    const route = await createRouteForService(serviceId, null, { paths: null, protocols: ["udp"], destinations: [{ "port": streamListenPort }] });
    routeId = route.id;

    // Get the gateway IP and container IP
    gatewayIp = await getDockerNetworkGatewayIP();
    const containerNameForIPFetch = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
    containerIp = await getDockerContainerIP(containerNameForIPFetch);

    // Wait for the configuration to rebuild
    await waitForConfigRebuild();
  });

  it('should route UDP requests when only destination port is configured', async function () {
    await testRoute(successTest());
  });

  it('should reject UDP requests when destination IP does not match', async function () {
    const routePayload = { destinations: [{ "ip": invalidIp, "port": streamListenPort }] };
    await updateRouteAndTest(routeId, routePayload, failureTest());
  });

  it('should route UDP requests when destination IP matches', async function () {
    const routePayload = { destinations: [{ "ip": containerIp, "port": streamListenPort }] };
    await updateRouteAndTest(routeId, routePayload, successTest());
  });

  it('should reject UDP requests when source IP is not allowed', async function () {
    const routePayload = { sources: [{ ip: invalidIp }] };
    await updateRouteAndTest(routeId, routePayload, failureTest());
  });

  it('should route UDP requests when source IP is allowed', async function () {
    const routePayload = { sources: [{ ip: gatewayIp }] };
    await updateRouteAndTest(routeId, routePayload, successTest());
  });

  it('should reject UDP requests when source port does not match configured value', async function () {
    const routePayload = { sources: [{ "ip": gatewayIp, "port": portForSources }] };
    await updateRouteAndTest(routeId, routePayload, failureTest());
  });

  it('should route UDP requests when using matching source port', async function () {
    await testRoute({
      ...successTest(),
      host: containerIp,
      optional: { sourcePort: portForSources }
    });
  });

  after(async function () {
    // Reset gateway environment variables
    await resetGatewayContainerEnvVariable(
      {
        KONG_STREAM_LISTEN: "off"
      },
      getKongContainerName()
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_STREAM_LISTEN: "off"
        },
        'kong-dp1'
      );
    }

    // Clean up created service and route
    await deleteGatewayRoute(routeId);
    await deleteGatewayService(serviceId);
  })
})