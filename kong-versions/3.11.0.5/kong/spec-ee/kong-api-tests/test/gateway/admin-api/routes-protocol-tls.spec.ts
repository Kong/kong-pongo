import {
  sendTlsRequest,
  expect,
  createGatewayService,
  createRouteForService,
  deleteGatewayService,
  deleteGatewayRoute,
  resetGatewayContainerEnvVariable,
  randomString,
  isGwHybrid,
  getKongContainerName,
  eventually,
  patchRoute,
  getDockerNetworkGatewayIP,
  getDockerContainerIP,
  waitForConfigRebuild
} from '@support';

interface TestOptions {
  host: string;
  port: number;
  message: string;
  expected?: string;
  errorExpected?: string;
  servername?: string;
  sourcePort?: number,
}

async function testRoute(testOptions: TestOptions) {
  const { host, port, message, expected, errorExpected, servername, sourcePort } = testOptions;

  await eventually(async () => {
    try {
      const response = await sendTlsRequest(
        host,
        port,
        message,
        servername,
        {},
        sourcePort // Only passed if sourcePort exists
      );
      console.log('Received response:', response);

      if (expected) {
        expect(response).to.equal(expected);
      } else {
        expect.fail('Expected TLS request to fail but it succeeded');
      }
    } catch (err: any) {
      if (err instanceof Error) {
        console.error('Caught error:', err.message);
        if (errorExpected) {
          expect(err.message).to.equal(errorExpected);
        } else {
          expect.fail(`Unexpected TLS error: ${err.message}`);
        }
      } else {
        expect.fail(`Unexpected error type: ${String(err)}`);
      }
    }
  });
}

async function updateRouteAndTest(routeId: string, patchData: Record<string, any>, testOptions: TestOptions) {
  const resp = await patchRoute(routeId, patchData);
  expect(resp.status).to.equal(200);
  await testRoute(testOptions);
}

// Skip the tests in classic mode because sometimes the TLS route request will trigger an error: no Route found with those values while prereading client data
// And the related ticket is KAG-7414
(isGwHybrid() ?  describe : describe.skip)('Gateway Admin API: TLS Route Tests', function () {
  const tlsURL = 'tls://tls-server:9344';
  let serviceId: string;
  let routeId: string;
  let gatewayIp: string;
  let containerIp: string;
  const invalidIp = '172.16.0.1';
  const portForSources = 1234;
  const streamListenPort = isGwHybrid() ? 7001 : 7000;
  const baseRequestOptions: TestOptions = {
    host: 'localhost',
    port: streamListenPort,
    message: 'hello kong'
  };
  const successTest = () => ({
    ...baseRequestOptions,
    expected: `[REPLY FROM TLS]: hello kong`
  });
  const failureTest = () => ({
    ...baseRequestOptions,
    expected: '',
    errorExpected: 'Client network socket disconnected before secure TLS connection was established'
  });

  before(async function () {
    // Set gateway environment variables
    await resetGatewayContainerEnvVariable(
      {
        KONG_STREAM_LISTEN: "0.0.0.0:7000 ssl"
      },
      getKongContainerName()
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_STREAM_LISTEN: "0.0.0.0:7001 ssl"
        },
        'kong-dp1'
      );
    }

    // Create a TLS service and route
    const service = await createGatewayService(randomString(), { url: tlsURL });
    serviceId = service.id;
    const route = await createRouteForService(serviceId, null, { paths: null, protocols: ["tls"], destinations: [{ "port": streamListenPort }] });
    routeId = route.id;

    // Get the gateway IP and container IP
    gatewayIp = await getDockerNetworkGatewayIP();
    const containerNameForIPFetch = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
    containerIp = await getDockerContainerIP(containerNameForIPFetch);
    
    // Wait for the configuration to rebuild
    await waitForConfigRebuild();
  });

  it('should route TLS requests when only destination port is configured', async function () {
    await testRoute(successTest());
  });

  it('should reject TLS requests when destination IP does not match', async function () {
    const routePayload = { destinations: [{ "ip": invalidIp, "port": streamListenPort }] };
    await updateRouteAndTest(routeId, routePayload, failureTest());
  });

  it('should route TLS requests when destination IP matches', async function () {
    const routePayload = { destinations: [{ "ip": containerIp, "port": streamListenPort }] };
    await updateRouteAndTest(routeId, routePayload, successTest());
  });

  it('should reject TLS requests when source IP is not allowed', async function () {
    const routePayload = { sources: [{ ip: invalidIp }] };
    await updateRouteAndTest(routeId, routePayload, failureTest());
  });

  it('should route TLS requests when source IP is allowed', async function () {
    const routePayload = { sources: [{ ip: gatewayIp }] };
    await updateRouteAndTest(routeId, routePayload, successTest());
  });

  it('should reject TLS requests when source port does not match configured value', async function () {
    const routePayload = { sources: [{ "ip": gatewayIp, "port": portForSources }] };
    await updateRouteAndTest(routeId, routePayload, failureTest());
  });

  it('should route TLS requests when using matching source port', async function () {
    await testRoute({
      ...successTest(),
      host: containerIp,
      sourcePort: portForSources
    });
  });

  it('should route TLS requests when SNI does not match', async function () {
    const routePayload = { snis: ['localhost'] };
    const failureTestWithServerName = () => ({
      ...baseRequestOptions,
      host: containerIp,
      sourcePort: portForSources,
      errorExpected: 'read ECONNRESET',
      servername: 'host.docker.internal'
    });
    await updateRouteAndTest(routeId, routePayload, failureTestWithServerName());
  });

  it('should route TLS requests when SNI matches', async function () {
    const routePayload = { snis: ['host.docker.internal'] };
    const successTestWithServerName = () => ({
      ...baseRequestOptions,
      host: containerIp,
      sourcePort: portForSources,
      expected: `[REPLY FROM TLS]: hello kong`,
      servername: 'host.docker.internal'
    });
    await updateRouteAndTest(routeId, routePayload, successTestWithServerName());
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
