import {
  createGatewayService,
  createRouteForService,
  Environment,
  expect,
  getBasePath,
  logResponse,
  postNegative,
  isGateway,
  randomString,
  getGatewayContainerLogs,
  getKongContainerName,
  findRegex,
  eventually,
  waitForConfigRebuild,
  createRoute,
  clearAllKongResources,
  isGwHybrid,
  client,
  getAllKeys,
  resetGatewayContainerEnvVariable,
  retryRequest,
  getNegative,
  isCI,
  isGwNative,
} from '@support';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

/**
 * IMPORTANT NOTE
 * For this test to work, you need to add '127.0.0.1 domain.test' to your /etc/hosts file
 */

describe('Gateway Plugins: ACME', function () {
  console.info(`Don't forget to add '127.0.0.1 domain.test' to your /etc/hosts file`);

  let serviceId: string;
  let activeKeyringIds: string[] = [];

  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/plugins`;
  const path = `/${randomString()}`;
  const kongContainerName = getKongContainerName();
  const domain = 'domain.test';
  const apiUri = 'https://localhost:8443/directory';

  let pluginId: string;
  const isPackageTest = isGwNative();
  const isHybrid = isGwHybrid();

  before(async function () {
    // set KONG_LUA_SSL_TRUSTED_CERTIFICATE value to pebble certificate path in kong container
    await resetGatewayContainerEnvVariable(
      {
        KONG_LUA_SSL_TRUSTED_CERTIFICATE: 'system,/etc/acme-certs/pebble.minica.pem',
      },
      kongContainerName,
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_LUA_SSL_TRUSTED_CERTIFICATE: 'system,/etc/acme-certs/pebble.minica.pem',
        },
        'kong-dp1',
      );
    }

    //For addressing the https://konghq.atlassian.net/browse/KAG-6647 issue
    //We need to recover the keyring keys after kong restart and activate all the keys
    if (isCI() && isPackageTest) {
      //Recover the keyring keys
      const formData = new FormData();
      formData.append('recovery_private_key', fs.createReadStream('./gateway-docker-compose-generator/rsa/key.pem'));
      const resp_recover = await axios({
        method: 'post',
        url: `${url.split('plugins')[0]}keyring/recover`,
        data: formData,
        headers: formData.getHeaders(),
      });
      logResponse(resp_recover);

      //Activate all the keys
      const resp_activate = await getNegative(`${url.split('plugins')[0]}keyring`);
      logResponse(resp_activate);
      activeKeyringIds = resp_activate.data.ids;
      for (const id of activeKeyringIds) {
        const resp = await postNegative(`${url.split('plugins')[0]}keyring/activate`, { key: id });
        logResponse(resp);
      }
    }

    // Create ACME test service and a route with the test domain host
    const service = await createGatewayService('acmeService');
    serviceId = service.id;
    await createRouteForService(serviceId, [path], { hosts: [domain] });

    /**
     * Create pebble service and route
     * NOTE:
     * we need this route to deal with an acme client limitation
     * if the server uri does not end with /directory, it will append that
     * as pebble defaults to /dir, it would end up as /dir/directory, leading to 404 in the directory request
     */
    const pebbleService = await createGatewayService('pebbleService', {
      host: 'pebble',
      port: 14000,
      path: '/dir',
      protocol: 'https',
    });
    const pebbleServiceId = pebbleService.id;
    await createRouteForService(pebbleServiceId, ['/directory'], {
      protocols: ['https'],
      strip_path: true,
      name: 'pebbleRoute',
    });

    // create a route for acme client (kong) to put a predetermined token in the well known path to validate the domain
    await createRoute(['/.well-known/acme-challenge'], { name: 'acme' });

    if (isGwHybrid()) {
      // connect to redis
      await client.connect();
    }
  });

  it('should not create acme plugin without account email', async function () {
    const resp = await postNegative(url, { name: 'acme', config: { storage: 'kong' } });
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain(
      'schema violation (config.account_email: required field missing)',
    );
  });

  if (isGwHybrid()) {
    it('should not create acme plugin with shm storage for hybrid mode', async function () {
      const resp = await postNegative(url, {
        name: 'acme',
        config: { storage: 'shm', account_email: 'test@konghq.com' },
      });
      logResponse(resp);

      expect(resp.status, 'Status should be 400').to.equal(400);
      expect(resp.data.message, 'Should have correct error message').to.contain(
        `schema violation ("shm" storage can't be used in Hybrid mode)`,
      );
    });
  }

  it('should create ACME plugin with correct config', async function () {
    const pluginPayload = {
      name: 'acme',
      config: {
        account_email: 'test@konghq.com',
        api_uri: apiUri,
        domains: [domain],
        storage: isGwHybrid() ? 'redis' : 'kong',
        fail_backoff_minutes: 1,
        storage_config: {
          redis: {
            host: 'redis',
            auth: 'redispass',
          },
        },
      },
    };

    const resp: any = await axios({
      method: 'post',
      url,
      data: pluginPayload,
    });
    logResponse(resp);

    pluginId = resp.data.id;

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.config.account_email, 'Should have correct plugin name').to.equal('test@konghq.com');
    expect(resp.data.config.domains, 'Should have correct domain').to.eql([domain]);

    await waitForConfigRebuild();
  });

  it('should send the initial request to generate certificate creation', async function () {
    const req = () => axios(`https://${domain}:8443${path}`);

    const assertions = resp => {
      expect(resp.status, 'Status should be 200').equal(200);
    };

    await retryRequest(req, assertions);
  });

  if (isGwHybrid()) {
    it('should see the new certificate generated by acme plugin in redis', async function () {
      await waitForConfigRebuild();
      await eventually(async () => {
        const allKeys: any = await getAllKeys();

        expect(allKeys.length, 'Should see the certificate').to.be.gte(3);
        expect(allKeys, 'Should see domain in redis').to.include.members([
          `kong_acme:cert_key:${domain}`,
          `kong_acme:account:${apiUri}:dGVzdEBrb25naHEuY29t`,
        ]);
      });
    });
  } else {
    it('should see the new certificate generated by acme plugin in /certificates', async function () {
      await eventually(async () => {
        const resp = await axios(`${url.split('plugins')[0]}certificates`);
        logResponse(resp);

        expect(resp.status, 'Status should be 200').to.equal(200);
        expect(resp.data.data.length, 'Should see the certificate').to.gte(1);
        for (const item of resp.data.data) {
          if (item.snis.length > 0) {
            expect(item.tags[0], 'Should see correct tag in certificate').to.equal('managed-by-acme');
            expect(item.snis[0], 'Should see the domain in sni list').to.equal('domain.test');
            expect(item.key, 'Should see correct certificate').to.not.be.null;
          }
        }
      });
    });
  }

  // below 2 tests are skipped due to https://konghq.atlassian.net/browse/KAG-4175 bug
  it.skip('should see the new certificate generated by acme plugin in /acme/certificates', async function () {
    await eventually(async () => {
      const resp = await axios(`${url.split('plugins')[0]}acme/certificates`);
      logResponse(resp);

      expect(resp.status, 'Status should be 200').to.equal(200);
      expect(resp.data.data.length, 'Should see the certificate').to.equal(1);
    });
  });

  it.skip('should get the new certificate generated by acme plugin by host', async function () {
    await eventually(async () => {
      const resp = await axios(`${url.split('plugins')[0]}acme/certificates/${domain}`);
      logResponse(resp);

      expect(resp.status, 'Status should be 200').to.equal(200);
      expect(resp.data.data.length, 'Should see the certificate').to.equal(1);
    });
  });

  it('should manually renew the certificate', async function () {
    const resp = await postNegative(`${url.split('plugins')[0]}acme`, { host: 'test' }, 'patch');

    expect(resp.status, 'Status should be 202').to.equal(202);
    expect(resp.data.message, 'Should see correct update message').to.equal('Renewal process started successfully');
  });

  it('should not see error in the logs after manual update of certificates', async function () {
    await eventually(async () => {
      const currentLogs = getGatewayContainerLogs(kongContainerName, 5);

      const isLogFound = findRegex('\\[error\\]', currentLogs);
      if (isCI() && isPackageTest && isHybrid) {
        for (const id of activeKeyringIds) {
          const isIdFound = findRegex(id, currentLogs);
          if (isIdFound) {
            expect(isLogFound, 'Should see error log related to keyring id').to.be.true;
          }
        }
      } else {
        expect(isLogFound, 'Should not see error log after manually updating the acme certificates').to.be.false;
      }

      let isTargetErrorMessageDetected = findRegex('failed to run timer unix_timestamp=', currentLogs);
      expect(isTargetErrorMessageDetected, 'Should not see timer-ng error after manually updating the acme certificate')
        .to.be.false;

      isTargetErrorMessageDetected = findRegex(
        "attempt to index local 'config' \\(a boolean value\\), context: ngx.timer",
        currentLogs,
      );
      expect(
        isTargetErrorMessageDetected,
        'Should not see attempt to index local config error after manually updating the acme certificate',
      ).to.be.false;
    });
  });

  // TODO - enable the below test after hybrid mode certificate creation issue is resolved
  // if(isGwHybrid()) {
  //   // before the below test, add test to PATCH the plugin storage_config to kong and remove the existing certificate
  //   it('should apply certificate in hybrid mode using api', async function () {
  //     const resp = await postNegative(`${url.split('plugins')[0]}acme`, { host: 'domain.test', test_http_challenge_flow: false });
  //     logResponse(resp);

  //     console.log(`${url.split('plugins')[0]}acme`, resp)

  //     // expect(resp.status, 'Status should be 400').to.equal(400);
  //     // expect(resp.data.message, 'Should have correct error message').to.contain(
  //     //   'schema violation ("shm" storage can nott be used in Hybrid mode)'
  //     // );
  //   });
  // }

  it('should delete the ACME plugin', async function () {
    const resp = await axios({
      method: 'delete',
      url: `${url}/${pluginId}`,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 204').to.equal(204);
  });

  after(async function () {
    // set KONG_LUA_SSL_TRUSTED_CERTIFICATE value back to its deafult 'system'
    await resetGatewayContainerEnvVariable(
      {
        KONG_LUA_SSL_TRUSTED_CERTIFICATE: 'system',
      },
      kongContainerName,
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_LUA_SSL_TRUSTED_CERTIFICATE: 'system',
        },
        'kong-dp1',
      );
    }
    if (isGwHybrid()) {
      client.quit();
    }
    await clearAllKongResources();
  });
});
