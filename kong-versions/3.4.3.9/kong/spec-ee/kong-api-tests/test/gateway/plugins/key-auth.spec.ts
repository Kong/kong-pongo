import {
  createConsumer,
  createGatewayService,
  createRouteForService,
  deleteConsumer,
  deleteGatewayRoute,
  deleteGatewayService,
  Environment,
  expect,
  getBasePath,
  getNegative,
  isGwHybrid,
  logResponse,
  waitForConfigRebuild,
  retryRequest,
  eventually,
  isLocalDatabase
} from '@support';
import axios from 'axios';

describe('@smoke: Gateway Plugins: key-auth', function () {
  const path = '/key-auth';
  const serviceName = 'key-auth-service';
  const consumerName = 'bill';
  const key = 'apiKey';
  // add extra delay when database is remote and gateway in hybrid mode
  const keyTtl = isGwHybrid() && !isLocalDatabase() ? 30 : 10;
  const keyAuthPayload = { tags: ['tag2'], ttl: keyTtl };
  const plugin = 'key-auth';

  const url = `${getBasePath({
    environment: Environment.gateway.admin,
  })}`;
  const proxyUrl = `${getBasePath({
    environment: Environment.gateway.proxy,
  })}`;
  const inValidTokenHeaders = {
    apiKey: 'ZnBckx2rSLCccbnCKRp3BEqzYbyRYTAX',
  };

  let serviceId: string;
  let routeId: string;
  let keyId: string;
  let consumerId: string;
  let basePayload: any;
  let pluginId: string;

  before(async function () {
    const service = await createGatewayService(serviceName);
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [path]);
    routeId = route.id;
    const consumer = await createConsumer(consumerName);
    consumerId = consumer.id;
    await waitForConfigRebuild();

    basePayload = {
      name: plugin,
      service: {
        id: serviceId,
      },
      route: {
        id: routeId,
      },
    };
  });

  it('should proxy request without supplying apiKey', async function () {
    const resp = await getNegative(`${proxyUrl}${path}`);
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
  });

  it('should enable key-auth plugin with apiKey in header', async function () {
    const pluginPayload = {
      ...basePayload,
      config: { key_names: ['apiKey'] },
    };

    const resp = await axios({
      method: 'post',
      url: `${url}/plugins`,
      data: pluginPayload,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.config.key_in_header, 'Default value is True').to.be.true;
    expect(resp.data.config.key_in_body, 'Default value is False').to.be.false;
    expect(resp.data.config.key_in_query, 'Default value is True').to.be.true;
    expect(resp.data.enabled, 'Should be true').to.be.true;
    expect(resp.data.config.key_names[0], 'Header key is apiKey').to.contain(
      key
    );

    pluginId = resp.data.id;
    await waitForConfigRebuild();
  });

  it('should create key and add tag using consumer under-test', async function () {
    const resp = await axios({
      method: 'post',
      url: `${url}/consumers/${consumerName}/${plugin}`,
      data: keyAuthPayload,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.tags, 'Should contain tags').to.contain('tag2');
    expect(resp.data.ttl, 'Should contain ttl value').to.be.a('number');

    keyId = resp.data.key;
  });

  it('should not proxy request without supplying apiKey', async function () {
    const resp = await getNegative(`${proxyUrl}${path}`);
    logResponse(resp);

    expect(resp.status, 'Status should be 401').to.equal(401);
    expect(resp.data.message, 'Should indicate no api key found').to.equal(
      'No API key found in request'
    );
  });

  it('should not proxy request with invalid apiKey', async function () {
    const resp = await getNegative(`${proxyUrl}${path}`, inValidTokenHeaders);
    logResponse(resp);

    expect(resp.status, 'Status should be 401').to.equal(401);
    expect(resp.data.message, 'Should indicate invalid credentials').to.equal(
      'Invalid authentication credentials'
    );
  });

  it('should proxy request with apiKey in header', async function () {
    const validTokenHeaders = {
      apiKey: keyId,
    };

    const req = () => getNegative(`${proxyUrl}${path}`, validTokenHeaders);

    const assertions = (resp) => {
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
    };

    await retryRequest(req, assertions);
  
  });

  it('should proxy request with apiKey in query param', async function () {
    const queryUrl = `${proxyUrl}${path}?apiKey=${keyId}`;

    const req = () =>
      axios({
        method: 'get',
        url: `${queryUrl}`,
      });

    const assertions = (resp) => {
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
    };

    await retryRequest(req, assertions);
    await waitForConfigRebuild();
  });

  // This test case captures:
  // https://konghq.atlassian.net/browse/FTI-4512
  it('should not proxy request with apiKey in header after ttl expiration', async function () {
    const validTokenHeaders = {
      apiKey: keyId,
    };
    await eventually(async () => {
      const resp = await getNegative(`${proxyUrl}${path}`, validTokenHeaders);
      logResponse(resp);

      expect(resp.status, 'Status should be 401').to.equal(401);
      expect(resp.data.message, 'Should indicate invalid credentials').to.equal(
        'Invalid authentication credentials'
      );
    });
  });

  // This test case captures:
  // https://konghq.atlassian.net/browse/FTI-4512
  it('should not proxy request with apiKey in query param after ttl expiration', async function () {
    const queryUrl = `${proxyUrl}${path}?apiKey=${keyId}`;

    await eventually(async () => {
      const resp = await getNegative(`${queryUrl}`);
      logResponse(resp);

      expect(resp.status, 'Status should be 401').to.equal(401);
      expect(resp.data.message, 'Should indicate invalid credentials').to.equal(
        'Invalid authentication credentials'
      );
    });
  });

  it('should patch key-auth plugin to disable auth and allow requests', async function () {
    const resp = await axios({
      method: 'patch',
      url: `${url}/plugins/${pluginId}`,
      data: {
        enabled: false,
      },
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.enabled, 'Should be false').to.be.false;
    await waitForConfigRebuild();
  });

  it('should proxy request without supplying apiKey after disabling plugin', async function () {
    const resp = await getNegative(`${proxyUrl}${path}`);
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
  });

  it('should delete the key-auth plugin', async function () {
    const resp = await axios({
      method: 'delete',
      url: `${url}/plugins/${pluginId}`,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 204').to.equal(204);
  });

  after(async function () {
    await deleteGatewayRoute(routeId);
    await deleteGatewayService(serviceId);
    await deleteConsumer(consumerId);
  });
});
