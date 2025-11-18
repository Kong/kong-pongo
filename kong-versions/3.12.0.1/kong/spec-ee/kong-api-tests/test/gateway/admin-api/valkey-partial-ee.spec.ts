import {
  waitForRedisDBSize,
  resetRedisDB,
  createGatewayService,
  createRouteForService,
  Environment,
  expect,
  getBasePath,
  isGwHybrid,
  logResponse,
  verifyRateLimitingEffect,
  wait,
  isGateway,
  clearAllKongResources,
  waitForConfigRebuild,
  runCommandInDockerContainer,
  valkeyClient,
  createValkeyClient,
  validateLinkedEntitiesResponse,
  validateRedisStandaloneConfig,
  createPlugin,
  checkOrStartServiceContainer,
  stopContainerByName,
} from '@support';
import axios from 'axios';
import _ from 'lodash';

describe('@weekly: Gateway Valkey-Partial Tests', function () {
  const valkeyContainerName = 'valkey';
  const valkeyUser = 'redisuser';
  const valkeyPassword = 'redispassword';
  const isHybrid = isGwHybrid();
  const valkeyNamespace = 'apiValkeyPartialTest';
  const limitHeader = 'X-Limit-Hit';
  const limitHeaderValueUpdate3rd = 'newHeaderUpdate3rd';

  let serviceId: string;
  let baseRLAPayload: any;
  let pluginId: string;
  let headers: any;
  let partialValkeyId: string;

  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}`;

  const proxyUrl = `${getBasePath({ environment: isGateway() ? Environment.gateway.proxy : undefined })}/apitest`;

  const partialValkeyPayload = {
    name: 'valkey',
    type: 'redis-ee',
    tags: [],
    config: {
      connect_timeout: 2000,
      connection_is_proxied: false,
      database: 0,
      host: 'host.docker.internal',
      keepalive_backlog: 0,
      keepalive_pool_size: 256,
      password: valkeyPassword,
      port: 6389,
      read_timeout: 2000,
      send_timeout: 2000,
      server_name: null,
      ssl_verify: false,
      ssl: false,
      username: valkeyUser,
      cluster_nodes: null,
      cluster_max_redirections: null,
      sentinel_master: null,
      sentinel_role: null,
      sentinel_nodes: null,
      sentinel_username: null,
      sentinel_password: null,
    },
  };

  before(async function () {
    // Check if the valkey container is running, if not, start it
    await checkOrStartServiceContainer(valkeyContainerName, async () => {
      const containerStatus = runCommandInDockerContainer(
        valkeyContainerName,
        `valkey-cli --user ${valkeyUser} --pass ${valkeyPassword} PING`,
      );
      expect(containerStatus, 'Should valkey be live and healthy').to.contain('PONG');
    });

    const service = await createGatewayService('ValkeyRLAService', undefined, undefined);
    serviceId = service.id;
    await createRouteForService(serviceId, undefined, undefined, undefined);

    await waitForConfigRebuild();

    baseRLAPayload = {
      name: 'rate-limiting-advanced',
      service: {
        id: serviceId,
      },
      config: {
        limit: [1],
        window_size: [20],
        identifier: 'header',
        header_name: limitHeader,
        strategy: 'redis',
        sync_rate: 1,
        namespace: valkeyNamespace,
        window_type: 'fixed',
      },
    };

    createValkeyClient();
    await valkeyClient.connect();
  });

  it('should allow create redis partial with valkey standalone type', async function () {
    const resp = await axios({
      method: 'post',
      url: `${url}/partials`,
      data: partialValkeyPayload,
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.name, 'Should have correct partial name').to.equal(partialValkeyPayload.name);
    partialValkeyId = resp.data.id;

    await waitForConfigRebuild();
  });

  it('should query the redis standalone partial config by its partial id', async function () {
    const resp = await axios({
      method: 'get',
      url: `${url}/partials/${partialValkeyId}`,
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data).to.have.property('name', partialValkeyPayload.name);
    expect(resp.data).to.have.property('type', partialValkeyPayload.type);
    expect(resp.data).to.have.property('config').that.is.an('object');
    validateRedisStandaloneConfig(resp.data.config, partialValkeyPayload.config);
  });

  it('should create RLA plugin and link to valkey standalone partial', async function () {
    const payloadWithWsPartial = _.cloneDeep(baseRLAPayload);
    payloadWithWsPartial.partials = [{ id: partialValkeyId }];

    const plugin = await createPlugin(payloadWithWsPartial);
    pluginId = plugin.id;

    await waitForConfigRebuild();
  });

  it('should query the redis cluster partial links by partial id and find the RLA already linked to it', async function () {
    const resp = await axios({
      method: 'get',
      url: `${url}/partials/${partialValkeyId}/links`,
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    validateLinkedEntitiesResponse(resp.data, {
      expectedId: pluginId,
      expectedName: baseRLAPayload.name,
      expectedCount: 1,
    });
  });

  it('should rate limit second proxy request according to RLA config linked to standalone redis partial', async function () {
    await resetRedisDB(true);
    await wait(isHybrid ? 8000 : 7000); // eslint-disable-line no-restricted-syntax
    headers = { [limitHeader]: limitHeaderValueUpdate3rd };
    await verifyRateLimitingEffect({ rateLimit: 1, url: proxyUrl, headers });
  });

  it('should have counter sync to Redis standalone storage', async function () {
    await waitForRedisDBSize(1, 10000, 1000, false, true);
  });

  after(async function () {
    await valkeyClient.quit();
    // Stop valkey container
    await stopContainerByName(valkeyContainerName);
    await clearAllKongResources();
  });
});
