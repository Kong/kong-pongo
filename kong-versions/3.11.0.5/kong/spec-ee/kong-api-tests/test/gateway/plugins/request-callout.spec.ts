import axios from 'axios';
import fs from 'fs';
import { join } from "path";
import {
  expect,
  Environment,
  getBasePath,
  redisClient,
  resetRedisDB,
  waitForRedisDBSize,
  getDbSize,
  createGatewayService,
  createRouteForService,
  createConsumer,
  randomString,
  logResponse,
  eventually,
  waitForConfigRebuild,
  isGateway,
  getGatewayContainerLogs,
  findRegex,
  createEnvVaultEntity,
  deleteVaultEntity,
  createKeyCredentialForConsumer,
  deletePlugin,
  createPlugin,
  isGwHybrid,
  getKongContainerName,
  clearAllKongResources,
  checkOrStartServiceContainer,
  stopContainerByName
} from '@support';


const verifyRespObj = function (key: string, actualBody: any, expectedBody: any, fullKeyName: string) {
  ["actual", "expected"].forEach(type => {
    const body = type === "actual" ? actualBody : expectedBody;
    if (!body || typeof body !== "object" || !(key in body)) {
      throw new Error(`Invalid ${type} response body or missing key in response: ${fullKeyName}`);
    }
  });

  for (const expectedKey in expectedBody[key]) {

    const expectedValue = expectedBody[key][expectedKey];
    const actualValue = actualBody[key]?.[expectedKey];

    //Key:"null" is added for testing forward:"false"
    if (expectedValue === "null") {
      expect(actualBody[key], 'Should not have the key in actual response body: ${fullKeyName}.${expectedKey}').to.not.have.property(expectedKey)
      continue;
    }

    if (actualValue === undefined) {
      throw new Error(`Missing key(${expectedKey}) in actual response body: ${fullKeyName} `);
    }

    // If the expected key starts with "ShowRespBody" but is NOT "ShowRespBody-Type", process as JSON
    const isShowRespBodyInCallouts = expectedKey.startsWith("ShowRespBody") && !expectedKey.startsWith("ShowRespBody-Type");

    if (isShowRespBodyInCallouts) {
      let parsedValue = actualValue;
      if (typeof actualValue === "string") {
        try {
          parsedValue = JSON.parse(decodeURIComponent(actualValue));
        } catch (error) {
          throw new Error(`JSON parsing failed: ${expectedKey}, error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      ["headers", "args", "json"].forEach(subKey => {
        if (expectedValue[subKey]) {
          verifyRespObj(subKey, parsedValue, expectedValue, `${fullKeyName}.${expectedKey}.${subKey}`);
        }
      });


    } else {
      expect(actualValue, `Should have correct value in response body: ${fullKeyName}.${expectedKey}`).to.eq(expectedValue);
    }

  }
}

// ********* Note *********
// In order for this test to successfully run you need to have defined the following environment variables in all Kong nodes
// SQUID_FPROXY: true
// TEST_DATA_VAULT: true
// CADDY: true
// ********* End **********

describe('Gateway Plugins: request-callout', function () {
  const datafile = join(__dirname, "/../../../support/data/request-callout/request-callout-plugin.json");
  const testData = JSON.parse(fs.readFileSync(datafile, "utf8"));
  const path = `/${randomString()}`;
  const consumerName = 'luka';
  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
  let serviceId: string;
  let routeId: string;
  let pluginId: string;
  let keyAuth_pluginId: string;
  let consumerId: string;
  let basePayload: any;

  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/plugins`;
  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;

  before(async function () {
    await redisClient.connect();// connect to redis
    
    // Check if the Squid and Caddy containers are running, if not, start them
    await checkOrStartServiceContainer('squid');
    await checkOrStartServiceContainer('Caddy');

    const service = await createGatewayService(randomString());
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [path]);
    routeId = route.id;
    const consumer = await createConsumer(consumerName);
    consumerId = consumer.id;

    basePayload = {
      name: 'request-callout',
      service: {
        id: serviceId,
      },
      route: {
        id: routeId,
      },
      consumer: null
    };
  });

  for (const testCase of testData.testPluginCreateErrorSuite) {
    it(`should fail to create the plugin: ${testCase.scenarioName}`, async function () {
      const pluginPayload = {
        ...basePayload,
        config: testCase.pluginConfig
      };
      const resp = await axios({ method: 'post', url, data: pluginPayload, validateStatus: null });
      logResponse(resp);
      expect(resp.status, 'Status should be correct').to.equal(testCase.pluginConfig_res.statusCode);
      expect(resp.data.message, 'Response body message should be correct').to.deep.equal(testCase.pluginConfig_res.body.message);
    });
  }

  it('should create a request-callout plugin：configure a simple callout', async function () {
    const pluginPayload = {
      ...basePayload,
      config: testData.dependecies.pluginConfig
    };
    const resp = await axios({ method: 'post', url, data: pluginPayload });
    logResponse(resp);

    expect(resp.status, `Status should be correct`).to.equal(testData.dependecies.pluginConfig_res.statusCode);
    expect(resp.data.config.cache, 'Config for cache should be correct').to.deep.equal(testData.dependecies.pluginConfig_res.body.config.cache);
    expect(resp.data.config.callouts, 'Config for callouts should be correct').to.deep.equal(testData.dependecies.pluginConfig_res.body.config.callouts);
    expect(resp.data.config.upstream, 'Config for upstream should be correct').to.deep.equal(testData.dependecies.pluginConfig_res.body.config.upstream);
    expect(resp.data.protocols, 'Protocols should be correct').to.deep.equal(testData.dependecies.pluginConfig_res.body.protocols);
    expect(resp.data.enabled, '"Enabled" should be correct').to.deep.equal(testData.dependecies.pluginConfig_res.body.enabled);

    pluginId = resp.data.id;
    await waitForConfigRebuild()
  });

  it('should request url successfully：configure a simple callout', async function () {
    await eventually(async () => {
      const resp = await axios({
        method: 'get',
        url: `${proxyUrl}${path}`,
        validateStatus: null,
      });
      logResponse(resp);
       const currentLogs = getGatewayContainerLogs(kongContainerName, 20);
       const isLogFound1 = findRegex(`${testData.dependecies.logs.message1}`, currentLogs);
       expect(
         isLogFound1,
         'Should see logs include url of callouts'
       ).to.be.true;
       const isLogFound2 = findRegex(`${testData.dependecies.logs.message2}`, currentLogs);
       expect(
         isLogFound2,
         'Should see logs include status code and latency of callouts'
       ).to.be.true;
      expect(resp.status, `Status should be correct`).to.equal(testData.dependecies.res.statusCode);
      expect(resp.headers, 'Should include request id in header').to.have.property('x-kong-request-id');
    });
  });


  for (const testCase of testData.testPluginUpdateErrorSuite) {
    it(`should fail to update the plugin: ${testCase.scenarioName}`, async function () {
      const pluginPayload = {
        ...basePayload,
        config: testCase.pluginConfig
      };

      const resp = await axios({ method: 'patch', url: `${url}/${pluginId}`, data: pluginPayload, "validateStatus": null });
      logResponse(resp);

      expect(resp.status, 'Status should be correct').to.equal(testCase.pluginConfig_res.statusCode);
      expect(resp.data.message, 'Response body message should be correct').to.deep.equal(testCase.pluginConfig_res.body.message);

    });
  }

  //Test cases about cache 
  for (const testCase of testData.testCacheSuite) {
    it(`should request url successfully: ${testCase.scenarioName}`, async function () {
      if (testCase.pluginConfig.cache?.strategy === "redis") {
        await resetRedisDB();
        await waitForRedisDBSize(0, 10000, 2000, true);
      }

      let uuid = '';

      //Update the plugin
      const pluginPayload = {
        ...basePayload,
        config: testCase.pluginConfig
      };
      const resp = await axios({ method: 'patch', url: `${url}/${pluginId}`, data: pluginPayload });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
      await waitForConfigRebuild()
      const request = { ...testCase.request, url: `${proxyUrl}${path}` };

      //Send requests to verify the plugin works 
      await eventually(async () => {
        const resp = await axios(request);
        logResponse(resp);
        expect(resp.status, `Status should be ${testCase.res.statusCode}`).to.equal(testCase.res.statusCode);
        expect(resp.data.json, 'Should Callout1-Uuid in the body of upstream').to.have.property('Callout1-Uuid');
        testCase.res.body.json['Callout1-Uuid'] = resp.data.json['Callout1-Uuid'];
        uuid = resp.data.json['Callout1-Uuid']; // Used for next request to verify cache works
        verifyRespObj("json", resp.data, testCase.res.body, "json");
      })

      //Send requests to verify cache works
      const resp2 = await axios(request);
      logResponse(resp2);
      expect(resp2.status, `Status should be ${testCase.res.statusCode}`).to.equal(testCase.res.statusCode);
      expect(resp2.data.json['Callout-Status'],
        'Should have correct Callout-Status value'
      ).to.eq(testCase.res.body.json['Callout-Status']);

      const c1 = testCase.pluginConfig.callouts.find(callout => callout.name === "callout1");
      if (
        testCase.pluginConfig.cache === undefined ||  // Check if cache is undefined, then it is using default value: off
        testCase.pluginConfig.cache?.strategy === undefined ||  // Check if strategy is undefined, then it is using default value: off
        testCase.pluginConfig.cache?.strategy === "off" ||  // Check if strategy is "off"
        (c1 as any)?.cache?.bypass === true  // Check if cache.bypass is "true"
      ) {
        expect(
          resp2.data.json['Callout1-Uuid'],
          'Should not have the same uuid'
        ).to.not.equal(uuid).and.to.not.equal('');
      }
      else {
        expect(
          resp2.data.json['Callout1-Uuid'],
          'Should be equal to uuid in last request'
        ).to.equal(uuid);
      }

      if (testCase.pluginConfig.cache?.strategy === "redis" && (c1 as any)?.cache?.bypass !== true) {
        const dbSize = await getDbSize();
        expect(dbSize, 'Redis DB size should be 1').to.eql(1);
      }
    });
  }

  //Test cases about callouts, upstream
  for (const testCase of testData.testCoreSuite) {
    it(`should request url successfully: ${testCase.scenarioName}`, async function () {
      //Create a key-auth plugin for consumers if required
      if (
        testCase.scenarioName.includes("consumer")
      ) {
        basePayload.consumer = { "id": consumerId }
        await createKeyCredentialForConsumer(consumerId, 'key-auth', { 'key': 'top-secret-key' });
        const pluginPayload = {
          name: "key-auth",
          config: { "key_names": ["apikey"] }
        };
        const keyAuthPlugin = await createPlugin(pluginPayload);
        keyAuth_pluginId = keyAuthPlugin.id;
      }

      //Create a vault if required
      if (
        testCase.scenarioName.includes("vault")
      ) {
        await createEnvVaultEntity('my-env-vault', { prefix: 'TEST_' });
      }

      //Update the plugin
      const pluginPayload = {
        ...basePayload,
        config: testCase.pluginConfig
      };
      const resp = await axios({ method: 'put', url: `${url}/${pluginId}`, data: pluginPayload });
      logResponse(resp);
      expect(resp.status, `Status should be 200`).to.equal(200);

      //Send requests to verify the plugin works
      await eventually(async () => {
        const request = { ...testCase.request, url: `${proxyUrl}${path}` };
        const resp = await axios(request);
        if (testCase.logs !== undefined) {
          const currentLogs = getGatewayContainerLogs(kongContainerName, 20);
          const isLogFound = findRegex(`${testCase.logs.errorMessage}`, currentLogs);
          expect(
            isLogFound,
            'Should see logs for the test case'
          ).to.be.true;
        }
        logResponse(resp);
        expect(resp.status, `Status should be ${testCase.res.statusCode}`).to.equal(testCase.res.statusCode);
        expect(resp.headers, 'Should include request id in header').to.have.property('x-kong-request-id');
        ["headers", "args", "json"].forEach(key => {
          if (testCase.res.body !== undefined && testCase.res.body[key] !== undefined) {
            if(testCase.res.body[key] != null){
              verifyRespObj(key, resp.data, testCase.res.body, key);
            }
            else{
              expect(resp.data[key], `Body.${key} should be null`).to.equal(null);
            }
          }
        });
      })

      //Delete key-auth plugin if required
      if (
        testCase.scenarioName.includes("consumer")
      ) {
        await deletePlugin(keyAuth_pluginId);
      }
    })
  }

  it('should delete the request-callout plugin by id', async function () {
    await deletePlugin(pluginId);
  });

  after(async function () {
    await redisClient.quit();
    await stopContainerByName('squid');
    await stopContainerByName('Caddy');
    await clearAllKongResources()
    await deleteVaultEntity('my-env-vault')
  });
});
