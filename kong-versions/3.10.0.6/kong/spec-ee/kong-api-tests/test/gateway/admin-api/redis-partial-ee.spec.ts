import {
  redisClient,
  redisClusterClient,
  waitForRedisClusterDBSize,
  waitForRedisDBSize,
  checkRedisAuthErrLog,
  resetRedisCluster,
  resetRedisDB,
  createWorkspace,
  createGatewayService,
  createRouteForService,
  Environment,
  expect,
  getKongContainerName,
  getBasePath,
  isGwHybrid,
  logResponse,
  postNegative,
  patchNegative,
  deleteNegative,
  verifyRateLimitingEffect,
  wait,
  isGateway,
  clearAllKongResources,
  waitForConfigRebuild,
  deleteWorkspace,
  getIncrementalSyncStatus
} from '@support';
import axios from 'axios';
import _ from 'lodash';

describe('Gateway Redis-Partial-EE Tests', function () {
  const isHybrid = isGwHybrid();
  const redisNamespace = 'apiRedisPartialTest';
  const redisPassword = 'redispassword';
  const vaultPrefix = 'RLA_';
  const vaultRedisPrefix = 'redis';
  const worksapceName = 'RLAPartialWS'
  const limitHeader = 'X-Limit-Hit';
  const limitHeaderValue = 'redisSync';
  const limitHeaderValueUpdate = 'newHeaderUpdate';
  const limitHeaderValueUpdate2nd = 'newHeaderUpdate2nd';
  const limitHeaderValueUpdate3rd = 'newHeaderUpdate3rd';
  const kongContainerName = isHybrid ? 'kong-dp1' : getKongContainerName();

  let wsVaultUrl: string;
  let wsPartialUrl: string;
  let wsPluginUrl: string;
  let wsPluginSchemaValidateUrl: string;
  let serviceId: string;
  let defaultPartialClusterId: string;
  let wsPartialClusterId: string;
  let wsPartialStandaloneId: string;
  let wsPartialSentinelId: string;
  let baseRLAPayload: any;
  let pluginId: string;
  let headers: any;
  let isIncSyncMode: boolean;

  const defaultPartialUrl = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/partials`;

  const proxyUrl = `${getBasePath({ environment: isGateway() ? Environment.gateway.proxy : undefined })}/apitest`;

  const partialClusterPayload = {
    name: 'redis-partial-ee-cluster',
    type: 'redis-ee',
    config: {
      cluster_nodes: [
        {
          ip: "rc-node-1",
          port: 6379
        },
        {
          ip: "rc-node-2",
          port: 6379
        },
        {
          ip: "rc-node-3",
          port: 6379
        }
      ],
      cluster_max_redirections: 5,
      password: redisPassword,
      connection_is_proxied: false,
      keepalive_backlog: 0,
      keepalive_pool_size: 256,
      database: 0,
      ssl_verify: false,
      ssl: false,
      connect_timeout: 3000,
      send_timeout: 2000,
      read_timeout: 1000
    },
  };

  const partialStandalonePayload = {
    name: 'redis-partial-ee-standalone',
    type: 'redis-ee',
    config: {
      host: 'redis',
      port: 6379,
      username: `{vault://${vaultRedisPrefix}/REDISU}`,
      password: `{vault://${vaultRedisPrefix}/REDISP}`,
      connection_is_proxied: false,
      keepalive_backlog: 0,
      keepalive_pool_size: 256,
      ssl_verify: false,
      ssl: false,
      database: 0,
      connect_timeout: 3000,
      send_timeout: 2000,
      read_timeout: 1000
    },
  };

  const partialSentinelPayload = {
    name: "redis-partial-ee-sentinel",
    type: "redis-ee",
    tags: [
      "sentinel"
    ],
    config: {
      sentinel_master: "mymaster",
      sentinel_nodes: [
        {
          "host": "redis-sentinel-1",
          "port": 26379
        }
      ],
      sentinel_username: null,
      sentinel_password: `{vault://${vaultRedisPrefix}/REDISP}`,
      username: null,
      sentinel_role: "master",
      password: `{vault://${vaultRedisPrefix}/REDISP}`,
      ssl: false,
      ssl_verify: false,
      database: 0,
      connect_timeout: 3000,
      send_timeout: 2000,
      read_timeout: 1000,
      keepalive_pool_size: 256,
      keepalive_backlog: 0
    }
  }

  function validateRedisClusterConfig(actualConfig: any, expectedConfig: any) {
    // Validate cluster_nodes: at least one node should match structure & not be empty
    expect(actualConfig.cluster_nodes, 'cluster_nodes should be a non-empty array')
      .to.be.an('array')
      .that.is.not.empty;

    const hasValidNode = actualConfig.cluster_nodes.some((node: any) => {
      return (
        typeof node === 'object' &&
        typeof node.ip === 'string' &&
        node.ip.trim() !== '' &&
        typeof node.port === 'number'
      );
    });

    expect(
      hasValidNode,
      'At least one cluster_node should match expected structure with non-empty values'
    ).to.be.true;

    // Common fields to validate exact match
    const fieldsToCheck = [
      'cluster_max_redirections',
      'password',
      'connection_is_proxied',
      'keepalive_backlog',
      'keepalive_pool_size',
      'database',
      'ssl_verify',
      'ssl',
      'connect_timeout',
      'send_timeout',
      'read_timeout',
    ];

    for (const field of fieldsToCheck) {
      expect(
        actualConfig[field],
        `config.${field} should match`
      ).to.equal(expectedConfig[field]);
    }
  }

  function validateRedisStandaloneConfig(actualConfig: any, expectedConfig: any) {
    // Basic required properties
    expect(actualConfig, 'config should be an object').to.be.an('object');

    const requiredFields = [
      'host',
      'port',
      'username',
      'password',
      'connection_is_proxied',
      'keepalive_backlog',
      'keepalive_pool_size',
      'ssl_verify',
      'ssl',
      'database',
      'connect_timeout',
      'send_timeout',
      'read_timeout',
    ];

    for (const field of requiredFields) {
      expect(
        actualConfig[field],
        `config.${field} should match`
      ).to.equal(expectedConfig[field]);
    }

    // Optional: Additional structure checks
    expect(actualConfig.host, 'host should be a non-empty string')
      .to.be.a('string')
      .that.is.not.empty;

    expect(actualConfig.port, 'port should be a number').to.be.a('number');

    if (actualConfig.username !== undefined) {
      expect(actualConfig.username, 'username should be a string').to.be.a('string');
    }

    expect(actualConfig.password, 'password should be a string').to.be.a('string');
  }

  function validateRedisSentinelConfig(actualConfig: any, expectedConfig: any) {
    // Validate sentinel_nodes: at least one node should match structure & not be empty
    expect(actualConfig.sentinel_nodes, 'sentinel_nodes should be a non-empty array')
      .to.be.an('array')
      .that.is.not.empty;

    const hasValidSentinelNode = actualConfig.sentinel_nodes.some((node: any) => {
      return (
        typeof node === 'object' &&
        typeof node.host === 'string' &&
        node.host.trim() !== '' &&
        typeof node.port === 'number'
      );
    });

    expect(
      hasValidSentinelNode,
      'At least one sentinel_node should match expected structure with non-empty values'
    ).to.be.true;

    // Fields to check exact match (excluding sentinel_nodes)
    const fieldsToCheck = [
      'sentinel_master',
      'sentinel_username',
      'sentinel_password',
      'username',
      'sentinel_role',
      'password',
      'ssl',
      'ssl_verify',
      'database',
      'connect_timeout',
      'send_timeout',
      'read_timeout',
      'keepalive_pool_size',
      'keepalive_backlog',
    ];

    for (const field of fieldsToCheck) {
      expect(
        actualConfig[field],
        `config.${field} should match`
      ).to.equal(expectedConfig[field]);
    }
  }

  /**
   * Validates the response for linked plugins in Redis partial configurations.
   * API endpoint: `/workspaces/{workspace}/partials/{partialId}/links`
   * This function checks if the response contains the expected linked plugins, ensuring that:
   * - The response has the correct structure (e.g., `data` array and `count` property).
   * - The number of linked plugins matches the expected count.
   * - At least one linked plugins matches the expected ID and name.
   *
   * @param {any} responseData - The response data to validate.
   * @param {string} expectedId - The expected ID of a linked plugin.
   * @param {string} expectedName - The expected name of a linked plugin.
   * @param {number} expectedCount - The expected number of linked plugins (optional).
   */
  function validateLinkedEntitiesResponse(
    responseData: any,
    {
      expectedId,
      expectedName,
      expectedCount,
    }: {
      expectedId: string;
      expectedName: string;
      expectedCount?: number;
    }
  ) {
    // Check top-level structure
    expect(responseData).to.have.property('data').that.is.an('array');
    expect(responseData).to.have.property('count').that.is.a('number');

    // Default expectedCount to data.length if not provided
    const actualCount = responseData.count;
    const actualData = responseData.data;
    const expectedLen = expectedCount ?? actualData.length;

    // Verify count matches the array length and expected value
    expect(actualData, 'data should be an array').to.have.lengthOf(expectedLen);
    expect(actualCount, 'count should match length of data').to.equal(expectedLen);

    // Verify one of the items matches expected ID and name
    const found = actualData.some((item: any) => {
      return item.id === expectedId && item.name === expectedName;
    });

    expect(found, `Should find item with id=${expectedId} and name=${expectedName}`).to.be.true;
  }

  /**
   * Skip test if incremental sync mode is disabled
   * Related to unresolved bug: KAG-6838
   */
  function skipConditionaly(testContext: Mocha.Context) {
    // Test skiped when incremental sync is off due to bug KAG-6838
    // These skiped tests will failed when incremental sync is off or when in classic mode and incremental sync is enabled
    if (isIncSyncMode === false || (isIncSyncMode === true && isHybrid === false)) {
      testContext.skip();
    }
  }

  before(async function () {
    isIncSyncMode = await getIncrementalSyncStatus();
    await createWorkspace(worksapceName);
    const service = await createGatewayService('RedisRLAService', undefined, worksapceName);
    serviceId = service.id;
    await createRouteForService(serviceId, undefined, undefined, worksapceName);

    wsVaultUrl = `${getBasePath({
      environment: isGateway() ? Environment.gateway.admin : undefined,
    })}/${worksapceName}/vaults`;

    wsPartialUrl = `${getBasePath({
      environment: isGateway() ? Environment.gateway.admin : undefined,
    })}/${worksapceName}/partials`;

    wsPluginUrl = `${getBasePath({
      environment: isGateway() ? Environment.gateway.admin : undefined,
    })}/${worksapceName}/plugins`;

    wsPluginSchemaValidateUrl = `${getBasePath({
      environment: isGateway() ? Environment.gateway.admin : undefined,
    })}/${worksapceName}/schemas/plugins/validate`;

    const vaultResp = await axios({
      method: 'post',
      url: wsVaultUrl,
      data: {
        name: 'env',
        prefix: vaultRedisPrefix,
        description: 'vault for redis user name and password',
        config: {
          prefix: vaultPrefix
        }
      },
    });
    logResponse(vaultResp);
    expect(vaultResp.status, 'Status should be 201').to.equal(201);

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
        sync_rate: 0.5,
        namespace: redisNamespace,
        window_type: "fixed"
      }
    };

    // connect to redis standalone client
    await redisClient.connect();
    // connect to redis cluster client and test connection
    await redisClusterClient.connect();
  });

  it('should create redis partial for redis cluster in default workspace', async function () {
    const resp = await axios({
      method: 'post',
      url: defaultPartialUrl,
      data: partialClusterPayload,
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.name, 'Should have correct partial name').to.equal(
      partialClusterPayload.name
    );
    defaultPartialClusterId = resp.data.id;
  });

  it('should not allow change redis partial type and name after partial created', async function () {
    const modifiedPayload = _.cloneDeep(partialClusterPayload);
    modifiedPayload.type = 'redis-ce';
    modifiedPayload.name = 'redis-partial-ce';

    const resp = await patchNegative(
      `${defaultPartialUrl}/${defaultPartialClusterId}`,
      modifiedPayload,
    );
    logResponse(resp);
    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain(
      'immutable field cannot be updated'
    );
  });

  it('should not create redis partial with same name in same workspace', async function () {
    const resp = await postNegative(defaultPartialUrl, partialClusterPayload);
    logResponse(resp);
    expect(resp.status, 'Status should be 409').to.equal(409);
  });

  it('should allow create redis partial with same name in different workspaces', async function () {
    const resp = await axios({
      method: 'post',
      url: wsPartialUrl,
      data: partialClusterPayload,
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.name, 'Should have correct partial name').to.equal(
      partialClusterPayload.name
    );
    wsPartialClusterId = resp.data.id;
  });

  it('should query the redis cluster partial config by its partial id', async function () {
    const resp = await axios({
      method: 'get',
      url: `${wsPartialUrl}/${wsPartialClusterId}`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data).to.have.property('name', partialClusterPayload.name);
    expect(resp.data).to.have.property('type', partialClusterPayload.type);
    expect(resp.data).to.have.property('config').that.is.an('object');
    validateRedisClusterConfig(resp.data.config, partialClusterPayload.config);
  });

  it('should not allow RLA plugin link to partials in different custom workspaces', async function () {
    const payloadWithDefaultPartial = _.cloneDeep(baseRLAPayload);
    payloadWithDefaultPartial.partials = [{ id: defaultPartialClusterId }];

    const resp = await postNegative(wsPluginUrl, payloadWithDefaultPartial);
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain(
      'does not reference an existing \'partial\' entity.'
    );
  });

  it('should create RLA plugin scoped to service in custom workspace and link to redis cluster partial', async function () {
    skipConditionaly(this);
    const payloadWithWsPartial = _.cloneDeep(baseRLAPayload);
    payloadWithWsPartial.partials = [{ id: wsPartialClusterId }];

    const resp = await postNegative(wsPluginUrl, payloadWithWsPartial);
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    pluginId = resp.data.id;

    await waitForConfigRebuild();
  })

  it('should query the redis cluster partial links by partial id and find the RLA already linked to it', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPartialUrl}/${wsPartialClusterId}/links`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    validateLinkedEntitiesResponse(
      resp.data,
      {
        expectedId: pluginId,
        expectedName: baseRLAPayload.name,
        expectedCount: 1,
      }
    );
  })

  it('should query RLA plugin redis cluster partial configuration by expand_partials parameter', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPluginUrl}/${pluginId}?expand_partials=true`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data).to.have.property('name', baseRLAPayload.name);
    expect(resp.data).to.have.property('config').that.is.an('object');
    expect(resp.data.config).to.have.property('redis').that.is.an('object');
    validateRedisClusterConfig(resp.data.config.redis, partialClusterPayload.config);
  });

  it('should rate limit 2nd request with rate-limiting advanced plugin', async function () {
    skipConditionaly(this);
    //cleanup redis cluster before testing
    await resetRedisCluster();
    await wait(isHybrid ? 8000 : 7000); // eslint-disable-line no-restricted-syntax
    await waitForRedisClusterDBSize(0, 3000, 1000, true);
    headers = { [limitHeader]: limitHeaderValue };
    await verifyRateLimitingEffect({ rateLimit: 1, url: proxyUrl, headers: headers });

  });

  it('should sync RLA counter to redis cluster', async function () {
    skipConditionaly(this);
    await waitForRedisClusterDBSize(1, 5000, 1000, true);
    //cleanup redis cluster after testing
    await resetRedisCluster();
    await wait(isHybrid ? 8000 : 7000); // eslint-disable-line no-restricted-syntax
    await waitForRedisClusterDBSize(0, 3000, 1000, true);
  });
  //skip this test due to KAG-6854
  it.skip('should allow change redis partial config to wrong password after it linked by plugin', async function () {
    const modifiedPartialPasswordErr = _.cloneDeep(partialClusterPayload);
    modifiedPartialPasswordErr.config.password = 'errorPassword';

    const resp = await patchNegative(
      `${wsPartialUrl}/${wsPartialClusterId}`,
      modifiedPartialPasswordErr,
    );
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  });
  //skip this test due to KAG-6854
  it.skip('should send proxy request to trigger RLA plugin new namespace Redis auth error log', async function () {
    headers = { [limitHeader]: limitHeaderValueUpdate };
    await verifyRateLimitingEffect({ rateLimit: 1, url: proxyUrl, headers: headers });

    await checkRedisAuthErrLog(redisNamespace, kongContainerName, true, 20);
  });
  //skip this test due to KAG-6854
  it.skip('should allow change redis cluster partial config to use correct vault type password after it linked by plugin', async function () {
    const modifiedPartialPasswordVault = _.cloneDeep(partialClusterPayload);
    modifiedPartialPasswordVault.config.password = '{vault://redis/REDISP}';

    const resp = await patchNegative(
      `${wsPartialUrl}/${wsPartialClusterId}`,
      modifiedPartialPasswordVault,
    );
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  });
  //skip this test due to KAG-6854
  it.skip('should rate limit 2nd request with rate-limiting advanced plugin after change to correct vault type password', async function () {
    //cleanup redis cluster before testing
    await resetRedisCluster();
    await wait(isHybrid ? 8000 : 7000); // eslint-disable-line no-restricted-syntax
    await waitForRedisClusterDBSize(0, 3000, 1000, true);
    headers = { [limitHeader]: limitHeaderValueUpdate2nd };
    await verifyRateLimitingEffect({ rateLimit: 1, url: proxyUrl, headers: headers });
  });
  //skip this test due to KAG-6854
  it.skip('should sync counter to Redis cluster with password from vault', async function () {
    await wait(1000); // eslint-disable-line no-restricted-syntax
    await waitForRedisClusterDBSize(1, 3000, 1000, true);
  });

  it('should allow create redis partial with redis standalone type in custom workspaces', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'post',
      url: wsPartialUrl,
      data: partialStandalonePayload,
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.name, 'Should have correct partial name').to.equal(
      partialStandalonePayload.name
    );
    wsPartialStandaloneId = resp.data.id;

    await waitForConfigRebuild();
  });

  it('should query the redis standalone partial config by its partial id', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPartialUrl}/${wsPartialStandaloneId}`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data).to.have.property('name', partialStandalonePayload.name);
    expect(resp.data).to.have.property('type', partialStandalonePayload.type);
    expect(resp.data).to.have.property('config').that.is.an('object');
    validateRedisStandaloneConfig(resp.data.config, partialStandalonePayload.config);
  })
  //skip this test due to KAG-6842
  it.skip('should allow validate redis partial schema with redis standalone type with vault reference', async function () {
    const payloadWithStandalonePartial = _.cloneDeep(baseRLAPayload);
    payloadWithStandalonePartial.partials = [{ id: wsPartialStandaloneId }];

    const resp = await postNegative(
      wsPluginSchemaValidateUrl,
      payloadWithStandalonePartial,
    );
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
  });

  it('should allow update RLA plugin created in custom workspace to link to redis standalone partial', async function () {
    skipConditionaly(this);
    const payloadWithStandalonePartial = _.cloneDeep(baseRLAPayload);
    payloadWithStandalonePartial.partials = [{ id: wsPartialStandaloneId }];

    const resp = await patchNegative(`${wsPluginUrl}/${pluginId}`, payloadWithStandalonePartial);
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  })

  it('should query RLA plugin redis standalone partial configuration by expand_partials parameter', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPluginUrl}/${pluginId}?expand_partials=true`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data).to.have.property('name', baseRLAPayload.name);
    expect(resp.data).to.have.property('config').that.is.an('object');
    expect(resp.data.config).to.have.property('redis').that.is.an('object');
    validateRedisStandaloneConfig(resp.data.config.redis, partialStandalonePayload.config);
  })

  it('should query the redis cluster partial links by partial id and find NO plugin linked to it', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPartialUrl}/${wsPartialClusterId}/links`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data).to.have.property('data').that.is.an('array').that.is.empty;
    expect(resp.data).to.have.property('count').that.equals(0);
  })

  it('should query the redis standalone partial links by partial id and find the RLA plugin already linked to it', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPartialUrl}/${wsPartialStandaloneId}/links`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    validateLinkedEntitiesResponse(
      resp.data,
      {
        expectedId: pluginId,
        expectedName: baseRLAPayload.name,
        expectedCount: 1,
      }
    );
  })

  it('should not allow delete redis standalone partial after it is linked to a plugin', async function () {
    skipConditionaly(this);
    const resp = await deleteNegative(`${wsPartialUrl}/${wsPartialStandaloneId}`);
    logResponse(resp);
    expect(resp.status, 'Status should be 403').to.equal(403);
    expect(resp.data.message, 'Should have correct error message')
      .to.match(/cannot delete partial: .* because there are plugins linked to it/);
  });

  it('should allow delete redis cluster partial after it is no longer linked to a plugin', async function () {
    skipConditionaly(this);
    const resp = await deleteNegative(`${wsPartialUrl}/${wsPartialClusterId}`);
    logResponse(resp);
    expect(resp.status, 'Status should be 204').to.equal(204);

    await waitForConfigRebuild();
  });

  it('should rate limit second proxy request according to RLA config linked to standalone redis partial', async function () {
    skipConditionaly(this);
    await resetRedisDB();
    await wait(isHybrid ? 8000 : 7000); // eslint-disable-line no-restricted-syntax
    headers = { [limitHeader]: limitHeaderValueUpdate3rd };
    await verifyRateLimitingEffect({ rateLimit: 1, url: proxyUrl, headers });
  });

  it('should have counter sync to Redis standalone storage', async function () {
    skipConditionaly(this);
    //wait 1 seconds for counter sync
    await wait(1000);// eslint-disable-line no-restricted-syntax
    await waitForRedisDBSize(1, 3000, 1000, true);
  });

  it('should allow create redis partial with redis sentinel type in custom workspaces', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'post',
      url: wsPartialUrl,
      data: partialSentinelPayload,
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.name, 'Should have correct partial name').to.equal(
      partialSentinelPayload.name
    );
    wsPartialSentinelId = resp.data.id;

    await waitForConfigRebuild();
  });

  it('should query the redis standalone partial config by its partial id', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPartialUrl}/${wsPartialSentinelId}`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data).to.have.property('name', partialSentinelPayload.name);
    expect(resp.data).to.have.property('type', partialSentinelPayload.type);
    expect(resp.data).to.have.property('config').that.is.an('object');
    validateRedisSentinelConfig(resp.data.config, partialSentinelPayload.config);
  })

  it('should allow update RLA plugin created in custom workspace to link to redis sentinel partial', async function () {
    skipConditionaly(this);
    const payloadWithSentinelPartial = _.cloneDeep(baseRLAPayload);
    payloadWithSentinelPartial.partials = [{ id: wsPartialSentinelId }];

    const resp = await patchNegative(`${wsPluginUrl}/${pluginId}`, payloadWithSentinelPartial);
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);

    await waitForConfigRebuild();
  })

  it('should query RLA plugin redis sentinel partial configuration by expand_partials parameter', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPluginUrl}/${pluginId}?expand_partials=true`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data).to.have.property('name', baseRLAPayload.name);
    expect(resp.data).to.have.property('config').that.is.an('object');
    expect(resp.data.config).to.have.property('redis').that.is.an('object');
    validateRedisSentinelConfig(resp.data.config.redis, partialSentinelPayload.config);
  })

  it('should query the redis sentinel partial links by partial id and find the RLA plugin already linked to it', async function () {
    skipConditionaly(this);
    const resp = await axios({
      method: 'get',
      url: `${wsPartialUrl}/${wsPartialSentinelId}/links`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    validateLinkedEntitiesResponse(
      resp.data,
      {
        expectedId: pluginId,
        expectedName: baseRLAPayload.name,
        expectedCount: 1,
      }
    );
  })

  it('should query all existing redis partials by partials endpoint', async function () {
    const resp = await axios({
      method: 'get',
      url: `${wsPartialUrl}`
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    const body = resp.data;

    expect(body).to.be.an('object');
    expect(body.data, 'data should be a non-empty array').to.be.an('array').that.is.not.empty;

    for (const partial of body.data) {
      expect(partial, 'Each item in data should be an object').to.be.an('object');
      expect(partial).to.have.property('name').that.is.a('string');
      expect(partial).to.have.property('type').that.is.a('string');
      expect(partial).to.have.property('config').that.is.an('object');
    }
  })

  after(async function () {
    await clearAllKongResources(worksapceName);
    await deleteWorkspace(worksapceName);
    await clearAllKongResources();

    await redisClient.quit();

    await resetRedisCluster();
    await waitForRedisClusterDBSize(0);
    await redisClusterClient.quit();
  });
});
