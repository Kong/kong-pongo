import axios, { AxiosResponse } from 'axios';
import {
  constants,
  expect,
  postNegative,
  getBasePath,
  Environment,
  logResponse,
  isGateway,
  clearAllKongResources,
  createGatewayService,
  createRouteForService,
  createPlugin,
  createConsumer,
  createKeyCredentialForConsumer,
  waitForConfigRebuild,
  getNegative,
  updateKeyCredentialForConsumer,
  eventually,
  randomString,
  patchPlugin,
  isGwHybrid,
  isLocalDatabase,
  createConjurAccount,
  deleteConjurAccount,
  loadConjurPolicy,
  setConjurSecret,
  updateConjurPolicy,
  runCommandInDockerContainer,
  checkOrStartServiceContainer,
  stopContainerByName,
} from '@support';

describe('Vaults: Conjur', function () {
  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/vaults`;
  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;
  const vaultPrefix = 'my-conjur';
  const vaultName = 'conjur';
  const conjurFirstSecretName = 'firstVar';
  const conjurSecondSecretName = 'secondVar';
  const serviceName = 'conjur';
  const conjurContainerName = 'conjur';
  const testPath = `/${randomString()}`;
  const authPath = `/${randomString()}`;
  const consumerName = randomString();
  const defaultTimeToLive = isGwHybrid() && !isLocalDatabase() ? 60 : 10;

  let adminApiKey: string;
  let conjurApiKey: string;
  let baseVaultPayload: any;
  let conjurSecretValue: string;
  let serviceId: string;
  let routeTestId: string;
  let routeAuthId: string;
  let calloutPluginId: string;
  let consumerId: string;
  let consumerKeyId: string;

  const rotatedSecretValue = async (
    conjurApiKey: string,
    secretName: string,
    consumerId: string,
    consumerKeyId: string,
    forceSecretValue?: string,
    isBase64 = false,
  ): Promise<string> => {
    const newSecretValue = forceSecretValue ? forceSecretValue : `mysecret_${Date.now()}`;
    await setConjurSecret(conjurApiKey, secretName, isBase64 ? btoa(newSecretValue) : newSecretValue);
    await updateKeyCredentialForConsumer(
      consumerId,
      'key-auth-enc',
      {
        consumer: {
          id: consumerId,
        },
        key: newSecretValue,
        id: consumerKeyId,
      },
      consumerKeyId,
    );
    return newSecretValue;
  };

  const assertBasicDetails = (
    resp: AxiosResponse,
    vaultName: string,
    vaultPrefix: string,
    conjurUrl: string,
    conjurAccount: string,
    conjurLogin: string,
    conjurApiKey: string,
  ) => {
    expect(resp.data.name, 'Should have correct vault name').equal(vaultName);
    expect(resp.data.prefix, 'Should have correct vault prefix').equal(vaultPrefix);
    expect(resp.data.created_at, 'Should see created_at number').to.be.a('number');
    expect(resp.data.updated_at, 'Should see updated_at number').to.be.a('number');
    expect(resp.data.config.endpoint_url, 'Should have correct vault account').equal(conjurUrl);
    expect(resp.data.config.account, 'Should have correct vault prefix').equal(conjurAccount);
    expect(resp.data.config.login, 'Should have correct vault prefix').equal(conjurLogin);
    expect(resp.data.config.api_key, 'Should have correct vault prefix').equal(conjurApiKey);
  };

  before(async function () {
    // Check if the conjur container is running, if not, start it
    await checkOrStartServiceContainer(conjurContainerName, async () => {
      // Wait for conjur container to be healthy
      const containerStatus = runCommandInDockerContainer(conjurContainerName, 'conjurctl wait');
      expect(containerStatus, 'Should conjur server be healthy').to.include('Conjur is ready!');
    });

    // set conjur account
    adminApiKey = await createConjurAccount();
    /**
     * load conjur policy, this step will create users and api tokens, create the secrets
     * and set permissions for them
     */
    conjurApiKey = await loadConjurPolicy();
    conjurSecretValue = `mysecret_${Date.now()}`;
    // set a value for the conjur secret
    await setConjurSecret(conjurApiKey, conjurFirstSecretName, conjurSecretValue);

    // conjur vault base config
    baseVaultPayload = {
      name: vaultName,
      prefix: vaultPrefix,
      config: {
        endpoint_url: constants.conjur.CONJUR_URL,
        auth_method: 'api_key',
        base64_decode: false,
        account: constants.conjur.CONJUR_ACCOUNT,
        login: constants.conjur.CONJUR_LOGIN,
        api_key: conjurApiKey,
        neg_ttl: defaultTimeToLive,
        resurrect_ttl: null,
        ttl: defaultTimeToLive,
      },
      description: 'conjur vault',
      tags: ['conjurtag'],
    };

    const service = await createGatewayService(serviceName);
    serviceId = service.id;
    const test = await createRouteForService(serviceId, [testPath], { name: 'test' });
    routeTestId = test.id;
    const auth = await createRouteForService(serviceId, [authPath], { name: 'auth' });
    routeAuthId = auth.id;

    await createPlugin({
      name: 'key-auth-enc',
      enabled: true,
      protocols: ['http', 'https'],
      route: {
        id: routeAuthId,
      },
      config: {
        key_in_header: true,
        key_in_query: true,
        key_names: ['apikey'],
      },
    });

    const calloutPlugin = await createPlugin({
      name: 'request-callout',
      route: {
        id: routeTestId,
      },
      config: {
        upstream: {
          by_lua:
            'kong.service.request.set_header("callout-query", kong.ctx.shared.callouts.callout1.response.body.args.q1)\nkong.service.request.set_header("kong-consumer", kong.ctx.shared.callouts.callout1.response.body.headers["X-Consumer-Username"])',
          headers: {
            custom: {
              'callout-status': '$(callouts.callout1.response.status)',
              'callout-body': '$(type(callouts.callout1.response.body))',
            },
          },
        },
        callouts: [
          {
            request: {
              query: {
                custom: {
                  q1: '{vault://my-conjur/BotApp%2FfirstVar}',
                },
              },
              error: {
                http_statuses: [401],
              },
              headers: {
                custom: {
                  apikey: '{vault://my-conjur/BotApp%2FfirstVar}',
                },
              },
              url: `${proxyUrl}${authPath}`,
              method: 'GET',
            },
            name: 'callout1',
            response: {
              headers: {
                store: true,
              },
              body: {
                decode: true,
                store: true,
              },
            },
          },
        ],
        cache: {
          memory: {
            dictionary_name: 'kong_db_cache',
          },
          redis: {
            sentinel_addresses: null,
            sentinel_master: null,
            cluster_max_redirections: 5,
            connect_timeout: 2000,
            send_timeout: 2000,
            ssl: false,
            username: null,
            keepalive_backlog: null,
            cluster_addresses: null,
            keepalive_pool_size: 256,
            password: null,
            sentinel_password: null,
            read_timeout: 2000,
            ssl_verify: false,
            connection_is_proxied: false,
            sentinel_role: null,
            sentinel_username: null,
            sentinel_nodes: null,
            host: '127.0.0.1',
            cluster_nodes: null,
            timeout: 2000,
            database: 0,
            server_name: null,
            port: 6379,
          },
          strategy: 'off',
          cache_ttl: 1,
        },
      },
    });
    calloutPluginId = calloutPlugin.id;

    const consumer = await createConsumer(consumerName);
    consumerId = consumer.id;
    const consumerKey = await createKeyCredentialForConsumer(consumerId, 'key-auth-enc', { key: conjurSecretValue });
    consumerKeyId = consumerKey.id;
    await waitForConfigRebuild();
  });

  it('should not create conjur vault without configuration', async function () {
    const resp = await postNegative(
      url,
      {
        name: vaultName,
        prefix: vaultPrefix,
      },
      'post',
    );
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.include(`config.account: required field missing`);
  });

  it('should not create conjur vault if conjur endpoint_url config is missing', async function () {
    const vaultPayload = {
      ...baseVaultPayload,
      config: {
        auth_method: 'api_key',
        base64_decode: false,
        account: constants.conjur.CONJUR_ACCOUNT,
        login: constants.conjur.CONJUR_LOGIN,
        api_key: conjurApiKey,
      },
    };

    const resp = await postNegative(url, vaultPayload, 'post');
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.include(
      `config.endpoint_url: required field missing`,
    );
  });

  it('should not create conjur vault if conjur account config is missing', async function () {
    const vaultPayload = {
      ...baseVaultPayload,
      config: {
        endpoint_url: constants.conjur.CONJUR_URL,
        auth_method: 'api_key',
        base64_decode: false,
        login: constants.conjur.CONJUR_LOGIN,
        api_key: conjurApiKey,
      },
    };

    const resp = await postNegative(url, vaultPayload, 'post');
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.include(`config.account: required field missing`);
  });

  it('should not create conjur vault if conjur login config is missing', async function () {
    const vaultPayload = {
      ...baseVaultPayload,
      config: {
        endpoint_url: constants.conjur.CONJUR_URL,
        auth_method: 'api_key',
        base64_decode: false,
        account: constants.conjur.CONJUR_ACCOUNT,
        api_key: conjurApiKey,
      },
    };

    const resp = await postNegative(url, vaultPayload, 'post');
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.include(`config.login: required field missing`);
  });

  it('should not create conjur vault if conjur api_key config is missing', async function () {
    const vaultPayload = {
      ...baseVaultPayload,
      config: {
        endpoint_url: constants.conjur.CONJUR_URL,
        auth_method: 'api_key',
        base64_decode: false,
        account: constants.conjur.CONJUR_ACCOUNT,
        login: constants.conjur.CONJUR_LOGIN,
      },
    };

    const resp = await postNegative(url, vaultPayload, 'post');
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.include(`config.api_key: required field missing`);
  });

  it('should create conjur vault with a valid config', async function () {
    const resp = await axios({
      method: 'post',
      url,
      data: baseVaultPayload,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    assertBasicDetails(
      resp,
      vaultName,
      vaultPrefix,
      constants.conjur.CONJUR_URL,
      constants.conjur.CONJUR_ACCOUNT,
      constants.conjur.CONJUR_LOGIN,
      conjurApiKey,
    );
    expect(resp.data.config.ttl, 'Should have correct ttl value').to.eq(defaultTimeToLive);
    expect(resp.data.config.neg_ttl, 'Should have correct ttl value').to.eq(defaultTimeToLive);
    expect(resp.data.tags[0], 'Should have correct tags').to.eq('conjurtag');
    expect(resp.data.description, 'Should have correct description').equal('conjur vault');

    await waitForConfigRebuild();
  });

  it('should not create conjur vault with same prefix', async function () {
    const resp = await postNegative(url, baseVaultPayload, 'post');
    logResponse(resp);

    expect(resp.status, 'Status should be 409').to.equal(409);
    expect(resp.data.message, 'Should have correct error message').to.include(
      `UNIQUE violation detected on '{prefix="${vaultPrefix}"}'`,
    );
  });

  it('should patch the conjur vault', async function () {
    const vaultPayload = {
      ...baseVaultPayload,
      description: 'my vault updated description',
      tags: ['conjur', 'tag', 'more', 'tags'],
    };

    const resp = await axios({
      method: 'patch',
      url: `${url}/${vaultPrefix}`,
      data: vaultPayload,
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    assertBasicDetails(
      resp,
      vaultName,
      vaultPrefix,
      constants.conjur.CONJUR_URL,
      constants.conjur.CONJUR_ACCOUNT,
      constants.conjur.CONJUR_LOGIN,
      conjurApiKey,
    );
    expect(resp.data.tags, 'Should see 4 tags').to.have.lengthOf(4);
    expect(resp.data.description, 'Should have correct description').equal('my vault updated description');
  });

  it('should fetch secret from vault', async function () {
    const url = `${proxyUrl}${testPath}`;
    const resp = await axios({
      url: url,
    });
    // verify the responses
    logResponse(resp);

    // conjur secret will be returned in the 'Callout-Query' header
    expect(resp.status, 'Status should be 200').equal(200);
    expect(resp.data.headers['Callout-Query'], 'Should match conjur vault secret').equal(conjurSecretValue);
  });

  it('should cache conjur secret for the given TTL period', async function () {
    // rotate conjur secret value and set new secret for the consumer auth key
    await rotatedSecretValue(conjurApiKey, conjurFirstSecretName, consumerId, consumerKeyId);
    await rotatedSecretValue(conjurApiKey, conjurFirstSecretName, consumerId, consumerKeyId);
    const rotateKey = await rotatedSecretValue(conjurApiKey, conjurFirstSecretName, consumerId, consumerKeyId);
    conjurSecretValue = rotateKey;

    /**
     * send a request to the proxy, the callout plugin will fail to resolve the request to the
     * /auth route due the cached old secret value do not match the new
     * secret value (and consumer auth-key value). This request returns with a 401 to the callout
     * plugin and this one returns a 400 error to the proxy request
     */

    await eventually(async () => {
      const url = `${proxyUrl}${testPath}`;
      const resp = await getNegative(url);
      //Verify the responses
      logResponse(resp);

      expect(resp.status, 'Status should be 400').equal(400);
      expect(resp.data, 'Should reject the request due auth key is invalid').to.include('service callout error');
    });
  });

  it('should refresh secret when TTL expires', async function () {
    /**
     * Request to the proxy would be sent until conjur vaults fetches the new secret value and callout plugin
     * gets a 200 response in the /auth request and allows the request to be forwarded to
     * the upstream for the /test route path.
     */

    await eventually(async () => {
      const url = `${proxyUrl}${testPath}`;
      const resp = await axios({
        url: url,
      });
      //Verify the responses
      logResponse(resp);

      // conjur secret will be returned in the 'Callout-Query' header
      expect(resp.status, 'Status should be 200').equal(200);
      expect(resp.data.headers['Callout-Query'], 'Should match updated conjur vault secret').equal(conjurSecretValue);
    });
  });

  it('should decode secrets as base64 when setting is enabled', async function () {
    const vaultPayload = {
      ...baseVaultPayload,
      description: 'my vault base64 decoding turn on',
    };
    vaultPayload.config.base64_decode = true;

    const resp = await axios({
      method: 'patch',
      url: `${url}/${vaultPrefix}`,
      data: vaultPayload,
    });

    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    assertBasicDetails(
      resp,
      vaultName,
      vaultPrefix,
      constants.conjur.CONJUR_URL,
      constants.conjur.CONJUR_ACCOUNT,
      constants.conjur.CONJUR_LOGIN,
      conjurApiKey,
    );
    expect(resp.data.description, 'Should have correct description').equal('my vault base64 decoding turn on');
    expect(resp.data.config.base64_decode, 'Should have base64 decode enable').to.be.true;

    // Rotate secret for a base64 secret
    const decodedBase64Secret = 'encoded_secret';
    const isBase64 = true;
    await rotatedSecretValue(
      conjurApiKey,
      conjurFirstSecretName,
      consumerId,
      consumerKeyId,
      decodedBase64Secret,
      isBase64,
    );
    await waitForConfigRebuild();

    /**
     * Request to the proxy would be sent until conjur vaults fetches the new base64 secret value and
     * decodes it to pass it later to the callout plugin in the /auth request if auth do not fail is
     * because the decoded value from the conjur vault is the expected one
     */

    await eventually(async () => {
      const url = `${proxyUrl}${testPath}`;
      const resp = await axios({
        url: url,
      });

      // verify the responses
      logResponse(resp);

      // conjur secret will be returned in the 'Callout-Query' header
      expect(resp.status, 'Status should be 200').equal(200);
      expect(resp.data.headers['Callout-Query'], 'Should match conjur vault secret').equal(decodedBase64Secret);
    });
  });

  it('should refresh secret when negative TTL expires', async function () {
    // Rotate secret for a base64 secret
    const encodedBase64Secret = 'c2Vjb25kX3Zhcl9lbmNvZGVk';
    const decodedBase64Secret = 'second_var_encoded';

    await updateKeyCredentialForConsumer(
      consumerId,
      'key-auth-enc',
      {
        consumer: {
          id: consumerId,
        },
        key: decodedBase64Secret,
        id: consumerKeyId,
      },
      consumerKeyId,
    );

    await patchPlugin(calloutPluginId, {
      name: 'request-callout',
      route: {
        id: routeTestId,
      },
      config: {
        upstream: {
          by_lua:
            'kong.service.request.set_header("callout-query", kong.ctx.shared.callouts.callout1.response.body.args.q1)\nkong.service.request.set_header("kong-consumer", kong.ctx.shared.callouts.callout1.response.body.headers["X-Consumer-Username"])',
          headers: {
            custom: {
              'callout-status': '$(callouts.callout1.response.status)',
              'callout-body': '$(type(callouts.callout1.response.body))',
            },
          },
        },
        callouts: [
          {
            request: {
              query: {
                custom: {
                  q1: '{vault://my-conjur/BotApp%2FsecondVar}',
                },
              },
              error: {
                http_statuses: [401],
              },
              headers: {
                custom: {
                  apikey: '{vault://my-conjur/BotApp%2FsecondVar}',
                },
              },
              url: `${proxyUrl}${authPath}`,
              method: 'GET',
            },
            name: 'callout1',
            response: {
              headers: {
                store: true,
              },
              body: {
                decode: true,
                store: true,
              },
            },
          },
        ],
        cache: {
          memory: {
            dictionary_name: 'kong_db_cache',
          },
          redis: {
            sentinel_addresses: null,
            sentinel_master: null,
            cluster_max_redirections: 5,
            connect_timeout: 2000,
            send_timeout: 2000,
            ssl: false,
            username: null,
            keepalive_backlog: null,
            cluster_addresses: null,
            keepalive_pool_size: 256,
            password: null,
            sentinel_password: null,
            read_timeout: 2000,
            ssl_verify: false,
            connection_is_proxied: false,
            sentinel_role: null,
            sentinel_username: null,
            sentinel_nodes: null,
            host: '127.0.0.1',
            cluster_nodes: null,
            timeout: 2000,
            database: 0,
            server_name: null,
            port: 6379,
          },
          strategy: 'off',
          cache_ttl: 1,
        },
      },
    });

    await waitForConfigRebuild();

    /**
     * Request to proxy will fail since there is not a 'secondVar' secrent in conjur yet. Callout request to the /auth
     * route will fail with 401 and the callout plugin will respond with a 400 error
     */
    await eventually(async () => {
      const url = `${proxyUrl}${testPath}`;
      const resp = await getNegative(url);
      //Verify the responses
      logResponse(resp);

      expect(resp.status, 'Status should be 400').equal(400);
      expect(resp.data, 'Should reject the request due auth key is invalid').to.include('service callout error');
    });

    /**
     * Apply changes to Conjur policy in order to create the 'secondVar' secret and set a value for it
     */
    await updateConjurPolicy();
    await setConjurSecret(conjurApiKey, conjurSecondSecretName, encodedBase64Secret);
    conjurSecretValue = decodedBase64Secret;

    /**
     * Requests to proxy will fail until negative TTL expires and conjur fetches the new value for the
     * 'seondVar' secret.
     */
    await eventually(async () => {
      const url = `${proxyUrl}${testPath}`;
      const resp = await axios({
        url: url,
      });

      // verify the responses
      logResponse(resp);

      // conjur secret will be returned in the 'Callout-Query' header
      expect(resp.status, 'Status should be 200').equal(200);
      expect(resp.data.headers['Callout-Query'], 'Should match conjur vault secret').equal(conjurSecretValue);
    });
  });

  it('should retrieve the conjur vault', async function () {
    const resp = await axios(`${url}/${vaultPrefix}`);
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.config.endpoint_url, 'Should see config host').to.equal(constants.conjur.CONJUR_URL);
    assertBasicDetails(
      resp,
      vaultName,
      vaultPrefix,
      constants.conjur.CONJUR_URL,
      constants.conjur.CONJUR_ACCOUNT,
      constants.conjur.CONJUR_LOGIN,
      conjurApiKey,
    );
  });

  it('should list all conjur vaults', async function () {
    const resp = await axios(url);
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(resp.data.data, 'Should 1 item in the list').to.have.lengthOf(1);
    expect(
      resp.data.data.map(vault => vault.prefix),
      'Should see all vault prefixes',
    ).to.have.members([vaultPrefix]);
  });

  it('should delete conjur vault', async function () {
    const resp = await axios({
      method: 'delete',
      url: `${url}/${vaultPrefix}`,
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 204').to.equal(204);
  });

  after(async function () {
    if (adminApiKey) await deleteConjurAccount();
    // Stop conjur container
    await stopContainerByName('conjur_database');
    await stopContainerByName('conjur');
    // clean up entities
    await clearAllKongResources();
  });
});
