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
  findRegex,
  patchRoute,
  eventually,
  waitForConfigRebuild,
  getIncrementalSyncStatus,
} from '@support';

import net from 'net';

// Cover KAG-7298 and KAG-7324, and it is skipped now because KAG-7324 has not been fixed
describe('Gateway Admin API: TCP Route Tests', function () {
  const tcpURL = 'tcp://tcp-server:9355';
  let serviceId: string;
  let routeId: string;
  const streamListenHost = 'localhost';
  const streamListenPort = isGwHybrid() ? 7001 : 7000;
  const streamListenPort2 = isGwHybrid() ? 6001 : 6000;
  const message = 'hello kong';
  const message2 = 'hi kong';
  const invalidIp = '172.16.0.1';

  before(async function () {
    // Skip the whole tests if incremental sync is enabled and hybrid mode is active because of KAG-7411
    const isInsync = await getIncrementalSyncStatus();
    if (isInsync && isGwHybrid()) {
      this.skip();
    }
    // Set gateway environment variables
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_STREAM_LISTEN: `0.0.0.0:${streamListenPort},0.0.0.0:${streamListenPort2}`,
        },
        'kong-dp1',
      );
    }
    await resetGatewayContainerEnvVariable(
      {
        KONG_STREAM_LISTEN: `0.0.0.0:${streamListenPort},0.0.0.0:${streamListenPort2}`,
      },
      getKongContainerName(),
    );

    console.log('Waiting for gateway to rebuild configuration...');
    // Create a TCP service and route
    const service = await createGatewayService(randomString(), { url: tcpURL });
    serviceId = service.id;
    const route = await createRouteForService(serviceId, null, {
      paths: null,
      protocols: ['tcp'],
      destinations: [{ port: streamListenPort }],
    });
    routeId = route.id;
    await waitForConfigRebuild();
  });

  it('should allow when source IP and dest IP are unrestricted', async function () {
    await eventually(async () => {
      const response = await sendTcpRequest(streamListenHost, streamListenPort, message);
      expect(response, 'Status should be "[REPLY]: hello kong"').equal(`[REPLY]: ${message}`);
    });
  });

  it('should return error while connection is broken', async function () {
    await eventually(async () => {
      const promise = new Promise<void>((_, reject) => {
        const client = net.createConnection({ host: '127.0.0.1', port: streamListenPort });

        client.once('connect', () => {
          console.log('Connected, simulating RST-like abort...');
          client.destroy(new Error('Simulate RST-like abort'));
        });

        client.once('error', reject);
      });

      await expect(promise).to.be.rejectedWith('Simulate RST-like abort');
    });
  });

  it('should allow when source IP is unrestricted and multi dest ports are set', async function () {
    await patchRoute(routeId, {
      destinations: [{ port: streamListenPort }, { port: streamListenPort2 }],
    });

    await waitForConfigRebuild();
    await eventually(async () => {
      const response = await sendTcpRequest(streamListenHost, streamListenPort, message);
      expect(response).to.equal(`[REPLY]: ${message}`);
    });
    await eventually(async () => {
      const response2 = await sendTcpRequest(streamListenHost, streamListenPort2, message2);
      expect(response2).to.equal(`[REPLY]: ${message2}`);
    });
  });

  it('should block when source IP is unrestricted and dest IP mismatches the TCP server', async function () {
    await patchRoute(routeId, {
      destinations: [{ ip: invalidIp, port: streamListenPort }],
    });
    await waitForConfigRebuild();

    await eventually(async () => {
      const response = await sendTcpRequest(streamListenHost, streamListenPort, message);
      expect(response).to.equal('');
    });
  });

  // Cover KAG-7298 and KAG-7324
  it.skip('should send tcp request successfully and no error occurs', async function () {
    await patchRoute(routeId, {
      destinations: [{ port: streamListenPort }],
    });

    await eventually(async () => {
      const response = await sendTcpRequest(streamListenHost, streamListenPort, message);
      expect(response, 'Status should be "[REPLY]: hello kong"').equal(`[REPLY]: ${message}`);
    });

    const currentLogs = await getGatewayContainerLogs(getKongContainerName(), 50, 'error');
    const isLogFound1 = findRegex('\\[error\\]', currentLogs);
    const isLogFound2 = findRegex('stack traceback', currentLogs);
    expect(isLogFound1 && isLogFound2, 'Should not see lua panic logs after sending TCP request').to.be.false;
  });

  after(async function () {
    // Reset gateway environment variables
    await resetGatewayContainerEnvVariable(
      {
        KONG_STREAM_LISTEN: 'off',
      },
      getKongContainerName(),
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_STREAM_LISTEN: 'off',
        },
        'kong-dp1',
      );
    }
    await deleteGatewayRoute(routeId);
    await deleteGatewayService(serviceId);
  });
});
