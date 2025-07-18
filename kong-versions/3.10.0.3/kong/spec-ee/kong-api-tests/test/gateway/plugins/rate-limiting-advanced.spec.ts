import {
  redisClient,
  createGatewayService,
  createRouteForService,
  Environment,
  expect,
  getAllKeys,
  getBasePath,
  getDbSize,
  getNegative,
  getTargetKeyData,
  isGwHybrid,
  logResponse,
  postNegative,
  resetRedisDB,
  wait,
  isGateway,
  expectRedisFieldsInPlugins,
  clearAllKongResources
} from '@support';
import axios from 'axios';

describe('@gke: Gateway RLA Plugin Tests', function () {
  this.timeout(30000);
  const isHybrid = isGwHybrid();
  const redisNamespace = 'apiRedisTest';
  const redisUsername = 'redisuser';
  const redisPassword = 'redispassword';
  let serviceId: string;

  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/plugins`;
  const proxyUrl = getBasePath({ environment: isGateway() ? Environment.gateway.proxy : undefined });

  let basePayload: any;
  let pluginId: string;

  before(async function () {
    const service = await createGatewayService('RlaService');
    serviceId = service.id;
    await createRouteForService(serviceId);

    basePayload = {
      name: 'rate-limiting-advanced',
      service: {
        id: serviceId,
      },
    };

    // connect to redis
    await redisClient.connect();
  });

  it('should not create RLA plugin with missing limit and window size', async function () {
    const resp = await postNegative(url, basePayload);
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain(
      '2 schema violations'
    );
  });

  if (isHybrid) {
    it('should not create RLA plugin with strategy cluster in hybrid mode', async function () {
      const pluginPayload = {
        ...basePayload,
        config: {
          strategy: 'cluster',
          limit: [52],
          window_size: [52],
          sync_rate: 0,
        },
      };

      const resp = await postNegative(url, pluginPayload);
      logResponse(resp);

      expect(resp.status, 'Status should be 400').to.equal(400);
      expect(resp.data.message, 'Should have correct error message').to.contain(
        "strategy 'cluster' is not supported with Hybrid deployments"
      );
    });
  }

  it('should not create RLA plugin without sync_rate', async function () {
    const pluginPayload = {
      ...basePayload,
      config: {
        limit: [52],
        window_size: [52],
        strategy: 'redis',
        redis: {
          host: 'redis',
          port: 6379,
          username: redisUsername,
          password: redisPassword,
        },
      },
    };

    const resp = await postNegative(url, pluginPayload);
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain(
      'sync_rate is required'
    );
  });

  it('should not create RLA plugin with unequal limit and window size arrays', async function () {
    const pluginPayload = {
      ...basePayload,
      config: {
        limit: [52, 40],
        window_size: [52],
        sync_rate: 0,
      },
    };

    const resp = await postNegative(url, pluginPayload);
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain(
      'same number of windows and limits'
    );
  });

  it('should create RLA plugin with correct config', async function () {
    const pluginPayload = {
      ...basePayload,
      config: {
        limit: [1],
        window_size: [3600],
        window_type: 'fixed',
        sync_rate: 0,
        strategy: 'redis',
        namespace: redisNamespace,
        redis: {
          host: 'redis',
          username: redisUsername,
          password: redisPassword,
        },
      },
    };

    const resp: any = await axios({
      method: 'post',
      url,
      data: pluginPayload,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.name, 'Should have correct plugin name').to.equal(
      basePayload.name
    );
    pluginId = resp.data.id;
    expect(pluginId, 'Plugin Id should be a string').to.be.string;
    expect(resp.data.created_at, 'created_at should be a number').to.be.a(
      'number'
    );
    expect(resp.data.enabled, 'Should have enabled=true').to.be.true;
    expect(resp.data.config.sync_rate, 'sync_rate should be 0').to.eq(0);
    expect(resp.data.config.strategy, 'Should have strategy cluster').to.eq(
      'redis'
    );
    expect(
      resp.data.config.window_size,
      'window_size should be 3600'
    ).to.be.equalTo([3600]);
    expect(resp.data.config.limit, 'Should have correct limit').to.be.equalTo([
      1,
    ]);
    if (resp.data.config.enforce_consumer_groups) {
      console.log('Checking also consumer groups');
      expect(
        resp.data.config.enforce_consumer_groups,
        'Should have consumer groups disabled'
      ).to.be.false;
    }
  });

  it('should see correct redis configuration fields in the RLA plugin response', async function () {
    const resp: any = await axios(url);
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expectRedisFieldsInPlugins(resp.data.data[0])
  });

  it('should allow redis timeout fields with different read and send value in the RLA plugin', async function () {
    const pluginPayload = {
      config: {
        redis: {
          connect_timeout: 1000,
          read_timeout: 2000,
          send_timeout: 3000,
          timeout: 1000
        },
      },
    };

    const resp: any = await axios({
      method: 'patch',
      url: `${url}/${pluginId}`,
      data: pluginPayload,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.config.redis.connect_timeout, 'Should have correct connect_timeout').to.equal(
      pluginPayload.config.redis.connect_timeout
    );
    expect(resp.data.config.redis.timeout, 'Should have correct timeout').to.equal(
      pluginPayload.config.redis.timeout
    );
    expect(resp.data.config.redis.read_timeout, 'Should have correct read_timeout').to.equal(
      pluginPayload.config.redis.read_timeout
    );
    expect(resp.data.config.redis.send_timeout, 'Should have correct send_timeout').to.equal(
      pluginPayload.config.redis.send_timeout
    );
  });

  it('should rate limit on 2nd request', async function () {
    await resetRedisDB();
    await wait(isHybrid ? 8000 : 7000); // eslint-disable-line no-restricted-syntax

    for (let i = 0; i < 2; i++) {
      const resp: any = await getNegative(`${proxyUrl}/apitest`);
      logResponse(resp);

      if (i === 1) {
        expect(resp.status, 'Status should be 429').to.equal(429);
      } else {
        expect(resp.status, 'Status should be 200').to.equal(200);
      }
    }
  });

  it('should have correct redis dbsize and key data', async function () {
    const dbSize = await getDbSize({ expectedSize: 1 });
    expect(dbSize, 'Redis DB size should be 1').equal(1);

    const allKeys: any = await getAllKeys();
    expect(
      allKeys[0],
      'Should store keys in redis with given namespace'
    ).to.contain(redisNamespace);

    const { entryCount, host } = await getTargetKeyData(allKeys[0]);
    expect(
      entryCount,
      'Should see 2 entries in redis key for 2 requests'
    ).equal('2');
    expect(host, 'should have host in key metadata').not.to.be.string;
  });

  it('should have correct redis key data after data update', async function () {
    await wait(2000); // eslint-disable-line no-restricted-syntax
    await resetRedisDB();

    for (let i = 0; i < 6; i++) {
      await getNegative(`${proxyUrl}/apitest`);
    }

    const dbSize = await getDbSize({ expectedSize: 1 });
    expect(dbSize, 'Redis DB size should be 1').equal(1);

    const allKeys: any = await getAllKeys();
    const { entryCount, host } = await getTargetKeyData(allKeys[0]);

    expect(
      entryCount,
      'Should see 6 entries in redis key for 6 requests'
    ).equal('6');
    expect(host, 'should have host in key metadata').not.to.be.string;
  });

  it('should delete the RLA plugin', async function () {
    const resp = await axios({
      method: 'delete',
      url: `${url}/${pluginId}`,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 204').to.equal(204);
  });

  after(async function () {
    await clearAllKongResources()
    await redisClient.quit();
  });
});
