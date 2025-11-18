import {
  redisClusterClient,
  createGatewayService,
  createRouteForService,
  createGwRedisPartialEntity,
  waitForClusterHashField,
  resetRedisCluster,
  waitForRedisClusterDBSize,
  createPlugin,
  createKeyCredentialForConsumer,
  deleteWorkspace,
  Environment,
  expect,
  wait,
  createWorkspace,
  createConsumer,
  createConsumerGroup,
  getBasePath,
  isGwHybrid,
  logResponse,
  randomString,
  isGateway,
  waitForConfigRebuild,
  clearAllKongResources,
  verifyRateLimitingRate,
  verifyThrottlingHeaders,
  logDebug
} from '@support';
import axios from 'axios';


describe('Kong Plugins: RLA throttling Test', function () {
  this.timeout(360000);

  before(async function () {
    // connect to redis cluster client and test connection
    await redisClusterClient.connect();
    
  });

  context('when RLA enable throttling with regular RPS traffic limit ratio will be lower and latency will be higher', function () {
    let rlaThrottlingPluginConfig: any;
    let serviceId: string;
    let rlaPlugingId: string;
    let baseRLAPayload: any;
    let rateLimitMetricOff: any;
    let rateLimitMetricOn: any;
    let urlProxy: string;
    let pluginUrl: string;
    let proxyUrl: string;
    

    const path = '/rlaThrottling';
    const limitHeader = 'X-Limit-Hit';
    const limitHeaderValue = 'throttlingSync';
    const limitHeaderValueUpdate = 'throttlingSyncUpdate';
    const limitHeaderValueUpdate1 = 'throttlingSyncUpdate1';
    const limitHeaderValueUpdate2 = 'throttlingSyncUpdate2';

    before(async function () {

      pluginUrl = `${getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
      })}/plugins`;

      proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
      });

      urlProxy = `${proxyUrl}${path}`;

      const redisNamespaceThrottling = 'rlaThrottling';
      const service = await createGatewayService('RlaThrottlingService');
      serviceId = service.id;
      await createRouteForService(serviceId, [path]);

      baseRLAPayload = {
        name: 'rate-limiting-advanced',
        service: {
          id: serviceId,
        },
        config: {
          limit: [6],
          window_size: [20],
          identifier: 'header',
          header_name: limitHeader,
          strategy: 'local',
          sync_rate: -1,
          namespace: redisNamespaceThrottling,
          window_type: "sliding"
        }
      };

    });

    it('should create RLA with throttling disabled as default store counter in local', async function () {

      rlaThrottlingPluginConfig = JSON.parse(JSON.stringify(baseRLAPayload));

      const pluginConfig = await createPlugin(rlaThrottlingPluginConfig);
      rlaPlugingId = pluginConfig.id;
      await waitForConfigRebuild();

      expect(pluginConfig.config.throttling, 'throttling should be false as default').to.be.null;

    });

    it('should has normal limit when throttling disabled with recorded limit ratio and latency', async function () {
      const header = { [limitHeader]: limitHeaderValue }; //set header as the identifier to hit rate limit
      rateLimitMetricOff = await verifyRateLimitingRate({
        url: `${urlProxy}`,
        headers: header,
        returnDetailed: true
      });
    });

    it('should update RLA config to enable throttling with default interval queue limit and retry times', async function () {
      rlaThrottlingPluginConfig.config.throttling = {
        enabled: true,
        interval: 5,
        queue_limit: 5,
        retry_times: 3
      };

      const resp = await axios({ method: 'PATCH', url: `${pluginUrl}/${rlaPlugingId}`, data: rlaThrottlingPluginConfig, validateStatus: null });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
      expect(resp.data.config.throttling.enabled, 'throttling should be false as default').to.be.true;
      await waitForConfigRebuild();
    })

    it('should have lower limiting ratio and higher latency when throttling enabled', async function () {
      const header = { [limitHeader]: limitHeaderValueUpdate }; //update header as the identifier to hit rate limit
      rateLimitMetricOn = await verifyRateLimitingRate({
        url: `${urlProxy}`,
        headers: header,
        returnDetailed: true
      });
      expect(rateLimitMetricOn.rateLimitRate, 'rateLimitMetricOn should be less than rateLimitMetricOff').to.be.lessThan(rateLimitMetricOff.rateLimitRate);
      expect(rateLimitMetricOn.averageLatency, 'averageLatency should be higher when throttling is enabled').to.be.greaterThan(rateLimitMetricOff.averageLatency);
    })

    it('should have hide_client_headers set to false in RLA config', async function () {
      const pluginConfig = await axios({ method: 'get', url: `${pluginUrl}/${rlaPlugingId}`, validateStatus: null });
      logResponse(pluginConfig);
      expect(pluginConfig.data.config.hide_client_headers, 'hide_client_headers should be false as default').to.be.false;
    })

    it('should verify throttling headers exist when requests being throttled', async function () {
      const reqheader = { [limitHeader]: limitHeaderValueUpdate1 };//update header as the identifier to hit rate limit

      const result = await verifyThrottlingHeaders({
        url: `${urlProxy}`,
        reqheaders: reqheader,
        respheaderName: ['x-ratelimit-throttling-waiting-', 'x-ratelimit-throttling-limit'],
        matchType: 'include',
        burstSize: 12,  // Send more than the rate limit (6) to ensure throttling
        maxRetries: 3
      });

      logDebug(`Throttling triggered after ${result.requestCount} requests in ${result.burstAttempts} burst attempts`);

    })

    it('should patch RLA config field hide_client_headers to true', async function () {
      const rlaClientHeaderOff = {
        config: {
          hide_client_headers: true
        }
      }
      const pluginConfigUpdate = await axios({ method: 'patch', url: `${pluginUrl}/${rlaPlugingId}`, data: rlaClientHeaderOff, validateStatus: null });
      logResponse(pluginConfigUpdate);
      expect(pluginConfigUpdate.data.config.hide_client_headers, 'hide_client_headers should be true').to.be.true;
      await waitForConfigRebuild();
    })

    it('should verify throttleing headers not exist when requests being throttled', async function () {
      const reqheader = { [limitHeader]: limitHeaderValueUpdate2 }; //update header as the identifier to hit rate limit
      const result = await verifyThrottlingHeaders({
        url: `${urlProxy}`,
        reqheaders: reqheader,
        respheaderName: ['x-ratelimit-throttling-waiting-', 'x-ratelimit-throttling-limit'],
        matchType: 'notinclude',
        burstSize: 12,  // Send more than the rate limit (6) to ensure throttling
        maxRetries: 3
      });

      logDebug(`Throttling triggered after ${result.requestCount} requests in ${result.burstAttempts} burst attempts`);
    })

    after(async function () {
      await clearAllKongResources();
    });

  });

  context('when RLA enable throttling function with Redis Cluster throttling counter can be synced to Redis', function () {

    let isHybrid: boolean;
    let workspaceName: string;
    let partialClusterId: string;
    let redisRlaThrottlingPluginConfig: any;
    let redisServiceId: string;
    let redisBaseRLAPayload: any;
    let consumerNormalId: string;
    let consumerEnforceId: string;
    let consumerGroupId: string;

    let wsUrl: string;
    let wsEnforceUrl: string;
    let wsPluginUrl: string;
    let urlProxy: string;

    let normalMetrics: any;
    let enforceMetrics: any;

    const throttlingInterval = 57; 
    
    const routePath = '/routePathEnforceTest';
    
    const redisNamespaceThrottling = 'rlaThrottlingRedis';
    const redisLimitHeader = 'X-Limit-Hit';
    const redisLimitHeaderValue = 'throttlingSyncRedis';
    const redislimitHeaderValueUpdate = 'throttlingSyncRedisUpdate';
    //redis throttling hash key match string format <timestamp>:<interval>:<namespace>
    const redisThrollitingHashKey = `:${throttlingInterval}:${redisNamespaceThrottling}`;
    //redis throttling field match string format <ratelimitIdentifer>:throttling
    const redisThrollitingField = `${redislimitHeaderValueUpdate}:throttling`;
    const consumerNameNormal = 'rlaThrottlingNormal';
    const consumerNameEnforce = 'rlaThrottlingEnforce';
    const consumerGroupName = 'enforceGroup';
    const consumerNormalKey = 'normalKey';
    const consumerEnforceKey = 'enforceKey';

    before(async function () {

      isHybrid = isGwHybrid();

      //create none default workspace
      workspaceName = `sdet-workspace-rla-throttling-${randomString()}`;
      await createWorkspace(workspaceName);

      const proxyUrl = getBasePath({
        environment: isGateway() ? Environment.gateway.proxy : undefined,
      });

      urlProxy = `${proxyUrl}${routePath}`;

      wsUrl = `${getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
      })}/${workspaceName}`;

      wsPluginUrl = `${getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
      })}/${workspaceName}/plugins`;

      wsEnforceUrl = `${getBasePath({
        environment: isGateway() ? Environment.gateway.admin : undefined,
      })}/${workspaceName}/consumer_groups/${consumerGroupName}/overrides/plugins/rate-limiting-advanced`;

      //create redis cluster
      const respPartial = await createGwRedisPartialEntity('cluster', workspaceName);
      partialClusterId = respPartial.id;

      //create a service and 1 route
      const service = await createGatewayService('RlaThrottlingRedisService', undefined, workspaceName);
      redisServiceId = service.id;

      await createRouteForService(redisServiceId, [routePath], undefined, workspaceName);

      //create 2 consumers and a consumer group, add one consumer to the group
      const consumerNormal = await createConsumer(consumerNameNormal, undefined, workspaceName);
      consumerNormalId = consumerNormal.id;
      const consumerEnfore = await createConsumer(consumerNameEnforce, undefined, workspaceName);
      consumerEnforceId = consumerEnfore.id;
      const consumerGroup = await createConsumerGroup(consumerGroupName, undefined, workspaceName);
      consumerGroupId = consumerGroup.id
      //add consumerEnfore to consumer group cover regression issue KAG-7509
      const resp = await axios({
        method: 'post',
        url: `${wsUrl}/consumer_groups/${consumerGroupId}/consumers`,
        data: {
          consumer: consumerEnforceId,
        },
        validateStatus: null
      });
      logResponse(resp);

      await waitForConfigRebuild();

      //Create a key-auth plugin
      const pluginPayload = {
        name: "key-auth",
        config: { "key_names": ["apikey"] }
      };
      await createPlugin(pluginPayload, workspaceName);

      //Create credentials for 2 consumers
      await createKeyCredentialForConsumer(consumerNormalId, 'key-auth', { 'key': consumerNormalKey }, workspaceName);
      await createKeyCredentialForConsumer(consumerEnforceId, 'key-auth', { 'key': consumerEnforceKey }, workspaceName);

      //plugin level rate limit is 20 requests per 30 seconds
      redisBaseRLAPayload = {
        name: 'rate-limiting-advanced',
        service: {
          id: redisServiceId,
        },
        config: {
          limit: [20],
          enforce_consumer_groups: true,
          consumer_groups: [consumerGroupName],
          window_size: [30],
          identifier: 'header',
          header_name: redisLimitHeader,
          strategy: 'redis',
          sync_rate: 1,
          namespace: redisNamespaceThrottling,
          window_type: "fixed",
          throttling: {
            enabled: true,
            interval: throttlingInterval,
            queue_limit: 5,
            retry_times: 3
          }
        }
      };

    });

    it('should enable plugin-level rate limit with throttling and store counters in redis cluster', async function () {

      redisRlaThrottlingPluginConfig = JSON.parse(JSON.stringify(redisBaseRLAPayload));
      redisRlaThrottlingPluginConfig.partials = [{ id: partialClusterId }];

      const resp = await axios({ method: 'post', url: wsPluginUrl, data: redisRlaThrottlingPluginConfig, validateStatus: null });
      logResponse(resp);
      expect(resp.status, 'Status should be 201').to.equal(201);

      await waitForConfigRebuild();

    });

    it('should update consumer group level limit rate to override RLA plugin level rate limit', async function () {
      //plugin level rate limit is 1 requests per 20 seconds
      const enforce_config = {
        config: {
          window_size: [20],
          window_type: "fixed",
          retry_after_jitter_max: 0,
          limit: [1]
        }
      }
      const resp = await axios({ method: 'put', url: wsEnforceUrl, data: enforce_config, validateStatus: null });
      logResponse(resp);
      expect(resp.status, 'Status should be 201').to.equal(201);
      await waitForConfigRebuild();
    });

    it('should rate limit a consumer not belonging to the enforced consumer group', async function () {
      //cleanup redis cluster before testing
      await resetRedisCluster();
      await wait(isHybrid ? 8000 : 7000); // eslint-disable-line no-restricted-syntax
      await waitForRedisClusterDBSize(0, 3000, 1000, true);
      //set header as the identifier to hit rate limit send request as consumerNormal not belong to the consumer group
      const reqheader = { [redisLimitHeader]: redisLimitHeaderValue, apikey: consumerNormalKey }; 
      //record normal metrics for consumer not belong to the enforced consumer group has plugin level rate limit applied
      normalMetrics = await verifyRateLimitingRate({
        url: `${urlProxy}`,
        headers: reqheader,
        returnDetailed: true,
        useBurst: true,
        interval: 100,
        totalRequests: 30
      });
    });

    it('should rate limit and throttle for the enforced consumer group consumer', async function () {
      //update header as the identifier to hit rate limit send request as consumerEnforce belong to the enforced consumer group
      const reqheader = { [redisLimitHeader]: redislimitHeaderValueUpdate, apikey: consumerEnforceKey };
      //record metrics for consumer belong to the enforced consumer group has consumer group level rate limit applied
      enforceMetrics = await verifyRateLimitingRate({
        url: `${urlProxy}`,
        headers: reqheader,
        returnDetailed: true,
        useBurst: true,
        interval: 100,
        totalRequests: 30
      });
      expect(normalMetrics.rateLimitRate, 'normal rate limit should be less than enforced rate limit').to.be.lessThan(enforceMetrics.rateLimitRate);
    })

    it('should sync the throttling counter to redis cluster', async function () {
      await waitForClusterHashField(
        redisThrollitingHashKey,
        redisThrollitingField,
        30000, // 30 second timeout
        1000,  // 1 second interval
        true   // verbose logging
      );
    });

    after(async function () {
      //cleanup kong configuration before cleanup redis ensure no traffic going to redis
      await clearAllKongResources(workspaceName);
      await deleteWorkspace(workspaceName);
      //wait for redis sync to complete
      await wait(isHybrid ? 8000 : 7000); // eslint-disable-line no-restricted-syntax
      //cleanup redis cluster before testing
      await resetRedisCluster();
      await waitForRedisClusterDBSize(0, 3000, 1000, true);
    });

  });


  after(async function () {
    await redisClusterClient.quit();
    await clearAllKongResources();
  });
});