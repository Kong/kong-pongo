import {
  sendTcpRequest,
  expect,
  createGatewayService,
  createRouteForService,
  deleteGatewayService,
  deleteGatewayRoute,
  resetGatewayContainerEnvVariable,
  randomString,
  isGwHybrid,
  getKongContainerName,
  getGatewayContainerLogs,
  findRegex
} from '@support';

// Cover KAG-7298 and KAG-7324, and it is skipped now because KAG-7324 has not been fixed
xdescribe('Gateway Admin API: TCP Route Tests', function () {
  const tcpURL = 'tcp://tcp-server:9355';
  let serviceId: string;
  let routeId: string;
  const streamListenHost = 'localhost';
  const streamListenPort = 7000; 

  before(async function () {
    // Set gateway environment variables
    await resetGatewayContainerEnvVariable(
      {
        KONG_STREAM_LISTEN: "0.0.0.0:7000"
      },
      getKongContainerName()
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_STREAM_LISTEN: "0.0.0.0:7000"
        },
        'kong-dp1'
      );
    }

    // Create a TCP service and route
    const service = await createGatewayService(randomString(), { url: tcpURL });
    serviceId = service.id;
    const route = await createRouteForService(serviceId, null, { paths: null, protocols: ["tcp"], sources: [{ "port": streamListenPort }] });
    routeId = route.id;
  });

  // Cover KAG-7298 and KAG-7324
  it('should send tcp request successfully and no error occurs', async function () {
    const message = 'hello kong';
    const response = await sendTcpRequest(streamListenHost, streamListenPort, message);
    expect(response, 'Status should be "[REPLY]: hello kong"').equal(`[REPLY]: ${message}`);

    
    const currentLogs = await getGatewayContainerLogs(getKongContainerName(), 50, "error");
    const isLogFound1 = findRegex('\\[error\\]', currentLogs);
    const isLogFound2 = findRegex('stack traceback', currentLogs);
    expect(
      isLogFound1 && isLogFound2,
      'Should not see lua panic logs after sending TCP request'
    ).to.be.false;
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
    await deleteGatewayRoute(routeId);
    await deleteGatewayService(serviceId);
  })
})