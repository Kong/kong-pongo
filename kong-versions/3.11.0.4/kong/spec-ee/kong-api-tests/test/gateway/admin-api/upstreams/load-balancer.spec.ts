import {
  createGatewayService,
  createRouteForService,
  Environment,
  expect,
  getBasePath,
  isGateway,
  waitForConfigRebuild,
  eventually,
  createUpstream,
  getNegative,
  logResponse,
  clearAllKongResources,
  addTargetToUpstream,
  wait,
  stopContainerByName,
  checkOrStartServiceContainer,
  UpstreamTarget,
  resetCounterForTarget,
  assertTargetRequestCount,
  assertTargetRequestGreaterThanCount,
  getTargetCount,
  TARGET_HOST
} from '@support';
import axios from 'axios';

describe('Gateway upstream target load balancer', function () {
  const target1: UpstreamTarget = {
    containerName: 'upstream-target-server-1',
    portTarget: 9301,
  };
  const target2: UpstreamTarget = {
    containerName: 'upstream-target-server-2',
    portTarget: 9302,
  };
  const failoverTarget: UpstreamTarget = {
    containerName: 'failover-target-server',
    portTarget: 9303,
  };
  const targets: UpstreamTarget[] = [target1, target2, failoverTarget];
  const failoverRoutePath = '/failover';
  const proxyUrl = `${getBasePath({
    environment: isGateway() ? Environment.gateway.proxy : undefined,
  })}${failoverRoutePath}`;

  const upstreamPayload = {
    name: 'httpbin',
    slots: 10000,
    algorithm: 'round-robin',
    hash_on: 'none',
    hash_fallback: 'none',
    healthchecks: {
      threshold: 0,
    },
    host_header: null,
    client_certificate: null,
    sticky_sessions_cookie: null,
    sticky_sessions_cookie_path: null,
    tags: [],
  };

  let serviceId: string;
  let upstreamId: string;

  before(async function () {
    // Start target containers if they are not running
    for (const target of targets) {
      await checkOrStartServiceContainer(target.containerName, async () => {
        const counter = await getTargetCount(target);
        expect(counter, `Target ${target.containerName} should have initial counter in zero`).to.equal(0);
      });
    }

    // Create service, route and upstream
    const service = await createGatewayService('upstreamLoadBalancer');
    serviceId = service.id;
    await createRouteForService(serviceId, [failoverRoutePath], { name: 'failover' });
    const upstream = await createUpstream('httpbin', upstreamPayload);
    upstreamId = upstream.id;

    await waitForConfigRebuild();
  });

  it('should fail proxying requests if upstream is configured but there are not targets yet', async function () {
    const resp = await getNegative(proxyUrl);
    logResponse(resp);
    expect(resp.status, 'Status should be 503').to.equal(503);
    expect(resp.data.message, 'Should fail to proxy request due missing upstream targets').to.equal(
      'failure to get a peer from the ring-balancer',
    );
  });

  it('should proxy request if there is at least one regular upstream targets', async function () {
    const target = await addTargetToUpstream(upstreamId, `${TARGET_HOST}:${target1.portTarget}`);
    expect(target.target, 'Target should match the added host:port').to.equal(`${TARGET_HOST}:${target1.portTarget}`);
    expect(target.failover, 'Target should not be marked as failover').to.equal(false);

    await eventually(async () => {
      const resp = await axios({
        method: 'get',
        url: proxyUrl,
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
    });
  });

  it('should proxy requests between all regular upstream targets if there is more than one', async function () {
    const target = await addTargetToUpstream(upstreamId, `${TARGET_HOST}:${target2.portTarget}`);
    expect(target.target, 'Target should match the added host:port').to.equal(`${TARGET_HOST}:${target2.portTarget}`);
    expect(target.failover, 'Target should not be marked as failover').to.equal(false);

    // reset target counters
    await resetCounterForTarget([target1, target2]);

    for (let i = 0; i < 10; i++) {
      const resp = await axios({
        method: 'get',
        url: proxyUrl,
      });

      expect(resp.status, 'Status should be 200').to.equal(200);
      //wait 0.85 seconds for counter sync
      // eslint-disable-next-line no-restricted-syntax
      await wait(850);
    }

    // Check that both targets received requests
    await assertTargetRequestGreaterThanCount(target1, 1);
    await assertTargetRequestGreaterThanCount(target2, 1);
  });

  it('Validate that a target can be added as failover', async function () {
    const target = await addTargetToUpstream(upstreamId, `${TARGET_HOST}:${failoverTarget.portTarget}`, true);
    expect(target.target, 'Target should match the added host:port').to.equal(
      `${TARGET_HOST}:${failoverTarget.portTarget}`,
    );
    expect(target.failover, 'Target should not be marked as failover').to.equal(true);
  });

  it('should proxy requests between regular upstream targets and not send any requests to failover target', async function () {
    // reset target counters
    await resetCounterForTarget([target1, target2, failoverTarget]);

    for (let i = 0; i < 10; i++) {
      const resp = await axios({
        method: 'get',
        url: proxyUrl,
      });

      expect(resp.status, 'Status should be 200').to.equal(200);
      //wait 0.85 seconds for counter sync
      // eslint-disable-next-line no-restricted-syntax
      await wait(850);
    }

    // Check that both targets received requests
    await assertTargetRequestGreaterThanCount(target1, 1);
    await assertTargetRequestGreaterThanCount(target2, 1);

    // failover target should not receive any request
    await assertTargetRequestCount(failoverTarget, 0);
  });

  it('should not proxy requests to failover target if there is at least one regular upstream target up and running', async function () {
    // stop target1
    await stopContainerByName(target1.containerName);

    // reset target counters
    await resetCounterForTarget([target2, failoverTarget]);

    for (let i = 0; i < 10; i++) {
      const resp = await axios({
        method: 'get',
        url: proxyUrl,
      });

      expect(resp.status, 'Status should be 200').to.equal(200);
      //wait 0.85 seconds for counter sync
      // eslint-disable-next-line no-restricted-syntax
      await wait(850);
    }

    // Check that target2 received all the requests
    await assertTargetRequestCount(target2, 10);

    // failover target should not receive any request
    await assertTargetRequestCount(failoverTarget, 0);
  });

  it('should proxy requests to failover target if both original targets are down', async function () {
    // stop target2
    await stopContainerByName(target2.containerName);

    // reset target counters
    await resetCounterForTarget([failoverTarget]);

    for (let i = 0; i < 10; i++) {
      const resp = await axios({
        method: 'get',
        url: proxyUrl,
      });
      expect(resp.status, 'Status should be 200').to.equal(200);
    }

    // failover target should receive all requests
    await assertTargetRequestCount(failoverTarget, 10);
  });

  it('Should proxy request to original target when it is restored and not send any request to failover target', async function () {
    // restart target1
    await checkOrStartServiceContainer(target1.containerName, async () => {
      const counter = await getTargetCount(target1);
      expect(counter, `Target ${target1.containerName} should have initial counter in zero`).to.equal(0);
    });

    // reset target counters
    await resetCounterForTarget([target1, failoverTarget]);

    for (let i = 0; i < 10; i++) {
      const resp = await axios({
        method: 'get',
        url: proxyUrl,
      });
      expect(resp.status, 'Status should be 200').to.equal(200);
    }

    // target1 should receive all requests
    await assertTargetRequestCount(target1, 10);

    // failover target should not receive any request
    await assertTargetRequestCount(failoverTarget, 0);
  });

  it('should fail proxying requests if all regular targets and failover targetare down', async function () {
    // stop all upstream targets and failover target
    for (const target of targets) {
      stopContainerByName(target.containerName);
    }

    const resp = await getNegative(proxyUrl);
    logResponse(resp);
    expect(resp.status, 'Status should be 503').to.equal(503);
    expect(resp.data.message, 'Should fail to proxy request due upstream targets are down').to.equal(
      'The upstream server is currently unavailable',
    );
  });

  after(async function () {
    // Stop target container
    for (const target of targets) {
      await stopContainerByName(target.containerName);
    }
    await clearAllKongResources();
  });

});
