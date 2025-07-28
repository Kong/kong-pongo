import {
  redisClient,
  createGatewayService,
  createRouteForService,
  createConsumer,
  Environment,
  expect,
  getBasePath,
  getDbSize,
  isGwHybrid,
  logResponse,
  postNegative,
  resetRedisDB,
  expectRedisFieldsInPlugins,
  randomString,
  waitForRedisDBSize,
  isGateway,
  verifyRateLimitingRate,
  waitForConfigRebuild,
  clearAllKongResources,
  verifyRateLimitingEffect
} from '@support';
import axios from 'axios';

describe('Gateway Plugins: Service Protection', function () {
  const isHybrid = isGwHybrid();
  const redisUsername = 'redisuser';
  const redisPassword = 'redispassword';
  const baseUrl = `${getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
      })}`;
  const pluginUrl = `${baseUrl}/plugins`;
  const proxyUrl = getBasePath({ environment: isGateway() ? Environment.gateway.proxy : undefined });


  before(async function () {
    // connect to redis
    await redisClient.connect();
  });

  context('CRUD Operations', function () {
    let serviceId: string;
    let configPluginId: string;
    let configBasePayload: any;
    const namespaceConfig = 'namespaceSPConfig';

    before(async function () {
      const service = await createGatewayService('service-protection-service');
      serviceId = service.id;

      configBasePayload = {
        name: 'service-protection',
        service: {
          id: serviceId,
        },
      };
    });

    it('should not create service-protection plugin with configuration without limit and window size', async function () {
      const resp = await postNegative(pluginUrl, configBasePayload);
      logResponse(resp);

      expect(resp.status, 'Status should be 400').to.equal(400);
      expect(resp.data.message, 'Should have correct error message').to.contain(
        '2 schema violations'
      );
    });

    if (isHybrid) {
      it('should not create service-protection plugin with cluster strategy in hybrid mode', async function () {
        const pluginPayload = {
          ...configBasePayload,
          config: {
            strategy: 'cluster',
            limit: [52],
            window_size: [52],
            sync_rate: 0,
          },
        };

        const resp = await postNegative(pluginUrl, pluginPayload);
        logResponse(resp);

        expect(resp.status, 'Status should be 400').to.equal(400);
        expect(resp.data.message, 'Should have correct error message').to.contain(
          "strategy 'cluster' is not supported with Hybrid deployments"
        );
      });
    }

    it('should not create service-protection plugin without sync_rate', async function () {
      const pluginPayload = {
        ...configBasePayload,
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

      const resp = await postNegative(pluginUrl, pluginPayload);
      logResponse(resp);

      expect(resp.status, 'Status should be 400').to.equal(400);
      expect(resp.data.message, 'Should have correct error message').to.contain(
        'sync_rate is required'
      );
    });

    it('should not create service-protection plugin with local strategy and sync_rate at the same time', async function () {
      const pluginPayload = {
        ...configBasePayload,
        config: {
          limit: [52],
          window_size: [52],
          strategy: 'local',
          sync_rate: 0
        },
      };

      const resp = await postNegative(pluginUrl, pluginPayload);
      logResponse(resp);

      expect(resp.status, 'Status should be 400').to.equal(400);
      expect(resp.data.message, 'Should have correct error message').to.contain(
        'sync_rate cannot be configured when using a local strategy'
      );
    });

    it('should not create service-protection plugin with unequal limit and window size arrays', async function () {
      const pluginPayload = {
        ...configBasePayload,
        config: {
          limit: [52, 40],
          window_size: [52],
          sync_rate: 0,
        },
      };

      const resp = await postNegative(pluginUrl, pluginPayload);
      logResponse(resp);

      expect(resp.status, 'Status should be 400').to.equal(400);
      expect(resp.data.message, 'Should have correct error message').to.contain(
        'same number of windows and limits'
      );
    });

    it('should create service-protection plugin with auto-generated namespace', async function () {
      const pluginPayload = {
        ...configBasePayload,
        config: {
          limit: [1],
          window_size: [3600],
          window_type: 'fixed',
          sync_rate: -1,
          strategy: 'local'
        },
      };

      const resp: any = await axios({
        method: 'post',
        url: `${pluginUrl}`,
        data: pluginPayload,
      });
      logResponse(resp);

      expect(resp.status, 'Status should be 201').to.equal(201);
      expect(resp.data.name, 'Should have correct plugin name').to.equal(
        configBasePayload.name
      );
      configPluginId = resp.data.id;
      expect(configPluginId, 'Plugin Id should be a string').to.be.string;
      expect(resp.data.created_at, 'created_at should be a number').to.be.a(
        'number'
      );
      expect(resp.data.enabled, 'Should have enabled=true').to.be.true;
      expect(resp.data.config.sync_rate, 'sync_rate should be -1').to.eq(-1);
      expect(resp.data.config.strategy, 'Should have strategy as local').to.eq(
        'local'
      );
      expect(resp.data.config.namespace, 'Should have auto generated namespace').to.be.string;
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

    it('should patch update service-protection plugin with customized namespace', async function () {
      const pluginPayload = {
        ...configBasePayload,
        config: {
          namespace: namespaceConfig
        },
      };

      const resp: any = await axios({
        method: 'patch',
        url:`${pluginUrl}/${configPluginId}`,
        data: pluginPayload,
      });
      logResponse(resp);

      expect(resp.status, 'Status should be 201').to.equal(200);
      expect(resp.data.config.namespace, 'Should have updated namespace value').to.equal(
        namespaceConfig
      );
    });

    it('should see correct redis configuration fields in the service protection plugin response', async function () {
      const resp: any = await axios(`${pluginUrl}/${configPluginId}`);
      logResponse(resp);
  
      expect(resp.status, 'Status should be 200').to.equal(200);
      expectRedisFieldsInPlugins(resp.data, { includeRedisProxyType: false })
    });

    it('should delete the service protection plugin', async function () {
      const resp = await axios({
        method: 'delete',
        url: `${pluginUrl}/${configPluginId}`,
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 204').to.equal(204);
    });

    after(async function () {
      await clearAllKongResources();
    });

  });

  context('Functional tests with strategy: local, scope: service', function () {
    let serviceId: string;
    const path = `/${randomString()}`;
    const urlProxy = `${proxyUrl}${path}`;
    const rateLimit = 1;
    const namespaceLocal = 'namespaceSPlocal';

    before(async function (){
      const service = await createGatewayService('service-protection-service');
      serviceId = service.id;
      await createRouteForService(serviceId, [path]);
    });

    it('should create service-protection plugin with local strategy', async function () {
      const pluginPayload = {
        name: 'service-protection',
        service: {
          id: serviceId,
        },
        config: {
          limit: [rateLimit],
          window_size: [3600],
          window_type: 'fixed',
          sync_rate: -1,
          strategy: 'local',
          namespace: namespaceLocal
        },
      };

      const resp: any = await axios({
        method: 'post',
        url: `${pluginUrl}`,
        data: pluginPayload,
      });
      logResponse(resp);

      expect(resp.status, 'Status should be 201').to.equal(201);
      await waitForConfigRebuild();
    });

    it('should rate limit on 2nd request according to service protection configuration', async function () {
      await verifyRateLimitingEffect({ rateLimit, url: urlProxy });
    });

    after(async function () {
      await clearAllKongResources();
    });

  });
  
  context('Service Protection with RLA', function () {
    let keyId: string;
    let rateLimitRatioRLAOnly: number;
    let rateLimitRatioRLASP: number;
    let serviceId: string;
    const path = `/${randomString()}`;
    const urlProxy = `${proxyUrl}${path}`;
    const consumerName = 'spRLAConsumer';
    const rateLimitSP = 1;
    const rateLimitRLA = 5;
    const redisSyncRate = 0.3
    const namespaceSP = 'namespaceSPRedis'; 
    const namespaceRLA = 'namespaceRLA'; 
    const windowLength = 20;
    const key = 'api_key';
    const plugin = 'key-auth';
    
    before(async function (){
      const service = await createGatewayService('service-protection-service');
      serviceId = service.id;
      await createRouteForService(serviceId, [path]);
      await createConsumer(consumerName);
    });

    it('should enable key-auth plugin with apiKey in header', async function () {
      const keyAuthPluginPayload = {
          name: plugin,
          service: {
            id: serviceId,
          },
          config: { key_names: [key] },
      };
  
      const resp = await axios({
        method: 'post',
        url: `${pluginUrl}`,
        data: keyAuthPluginPayload,
      });
      logResponse(resp);
  
      expect(resp.status, 'Status should be 201').to.equal(201);
      await waitForConfigRebuild();
    });
  
    it('should create key for the consumer', async function () {
      const resp = await axios({
        method: 'post',
        url: `${baseUrl}/consumers/${consumerName}/${plugin}`      
      });
  
      expect(resp.status, 'Status should be 201').to.equal(201);  
      keyId = resp.data.key;
      await waitForConfigRebuild();
    });

    it('should create RLA plugin with Redis strategy to limit consumers to 5 requests every 20 seconds', async function () {
      const rlaPayload = {
        name: 'rate-limiting-advanced',
        service: {
          id: serviceId,
        },
        config: {
          limit: [rateLimitRLA],
          window_size: [windowLength],
          window_type: 'fixed',
          identifier: 'consumer',
          sync_rate: redisSyncRate,
          strategy: 'redis',
          namespace: namespaceRLA,
          redis: {
            host: 'redis',
            port: 6379,
            username: redisUsername,
            password: redisPassword,
          },
        }
      };

      const resp: any = await axios({
        method: 'post',
        url:`${pluginUrl}`,
        data: rlaPayload,
      });
      logResponse(resp);

      expect(resp.status, 'Status should be 201').to.equal(201);
      await waitForConfigRebuild();
    });

    it('should limit proxy request according to RLA rate limit', async function () {
      const header = { [key]: keyId };
      rateLimitRatioRLAOnly = await verifyRateLimitingRate({url: `${urlProxy}`, headers: header});
    });

    it('should create a service-protection plugin with Redis strategy to limit the service to 1 request every 20 seconds', async function () {
      const spPluginPayload = {
        name: 'service-protection',
        service: {
          id: serviceId,
        },
        config: {
          limit: [rateLimitSP],
          window_size: [windowLength],
          window_type: 'fixed',
          sync_rate: redisSyncRate,
          strategy: 'redis',
          namespace: namespaceSP,
          redis: {
            host: 'redis',
            port: 6379,
            username: redisUsername,
            password: redisPassword,
          },
        },
      };

      const resp: any = await axios({
        method: 'post',
        url:`${pluginUrl}`,
        data: spPluginPayload,
      });
      logResponse(resp);

      expect(resp.status, 'Status should be 201').to.equal(201);
      await waitForConfigRebuild();
    });

    it('should apply rate limit based on the service protection plugins lower limit', async function () {
      await resetRedisDB();
      await waitForRedisDBSize(0, 10000, 2000, true);

      const header = { [key]: keyId };
      rateLimitRatioRLASP = await verifyRateLimitingRate({url: `${urlProxy}`, headers: header});

      const dbSize = await getDbSize();
      expect(dbSize, 'Redis DB size should larger than 1').to.be.greaterThan(1);

      expect(rateLimitRatioRLASP).to.be.greaterThan(rateLimitRatioRLAOnly);
    });

    after(async function () {
      await clearAllKongResources();
    });
    
  })


  after(async function () {
    await redisClient.quit();
  });
});
