import axios from 'axios';
import {
  createConsumer,
  createGatewayService,
  createRouteForService,
  Environment,
  expect,
  getBasePath,
  logResponse,
  clearAllKongResources,
  eventually,
  createPlugin,
  patchPlugin,
  describeWithWorkspaces,
  getGatewayContainerLogs,
  isGwHybrid,
  getKongContainerName,
  resetGatewayContainerEnvVariable, 
  isGwNative,
} from '@support';

// Currently, only tests related to https://konghq.atlassian.net/browse/FTI-7021 are included.
// The issue affects cache key handling in incremental sync mode for multiple plugins in non-default workspaces, including the ldap-auth-advanced plugin.
// Additional test cases for other scenarios may be added in the future.
describeWithWorkspaces('@smoke: Gateway Plugins: ldap-auth-advanced', function () {
  const isKongNative = isGwNative();
  const kongContainerName = getKongContainerName();
  const serviceName = 'ldap-auth-advanced-service';
  const path = '/ldap-auth-advanced';
  const ldap = {
    host: 'ec2-54-172-82-117.compute-1.amazonaws.com',
    token: 'ZWluc3RlaW46cGFzc3dvcmQ=',
    password: 'password',
  };

  let proxyUrl: string;
  let serviceId: string;
  let routeId: string;
  let pluginId: string;
  let basePayload: any;


  before(async function () {
    // reset KONG_KEYRING_ENABLED to off before tests to avoid interference from other tests(keyring related)
    await resetGatewayContainerEnvVariable(
      {
        KONG_KEYRING_ENABLED: `off`,
      },
      kongContainerName
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_KEYRING_ENABLED: `off`,
        },
        "kong-dp1"
      );
    }

    proxyUrl = `${getBasePath({
      app: 'gateway',
      environment: Environment.gateway.proxy,
    })}`;

    // create a service and route
    const service = await createGatewayService(serviceName);
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [path]);
    routeId = route.id;

    // create the base payload for ldap-auth-advanced plugin
    basePayload = {
      name: 'ldap-auth-advanced',
      service: {
        id: serviceId,
      },
      route: {
        id: routeId,
      },
      config: {
        attribute: 'uid',
        ldap_host: ldap.host,
        base_dn: 'dc=ldap,dc=mashape,dc=com',
        bind_dn: 'uid=einstein,ou=scientists,dc=ldap,dc=mashape,dc=com',
        ldap_password: ldap.password,
      },
    };
  });

  it('should create a ldap-auth-advanced plugin', async function () {
    const resp = await createPlugin(basePayload);
    pluginId = resp.id;
  });

  it('should fail to authenticate request when an invalid header is provided', async function () {
    await eventually(async () => {
      const resp1 = await axios({
        url: `${proxyUrl}${path}`,
        headers: {
          'Proxy-Authorization': `ldap 123invalidtoken456`,
        },
        validateStatus: null,
      });
      logResponse(resp1);
      expect(resp1.status, 'Status should be 401').to.equal(401);
      expect(resp1.data.message, 'Response message should be "Unauthorized"').to.equal('Unauthorized');
    });
  });

  it('should authenticate request with a valid header', async function () {
    await eventually(async () => {
      const resp2 = await axios({
        url: `${proxyUrl}${path}`,
        headers: {
          'Proxy-Authorization': `ldap ${ldap.token}`,
        },
        validateStatus: null,
      });
      logResponse(resp2);
      expect(resp2.status, 'Status should be 200').to.equal(200);
      expect(resp2.data.headers['X-Credential-Identifier'], 'X-Credential-Identifier should be einstein').to.equal(
        'einstein',
      );
    });
  });

  // Covers the bug described in https://konghq.atlassian.net/browse/FTI-7021.
  // The issue affects cache key handling in incremental sync mode for multiple plugins in non-default workspaces, including the ldap-auth-advanced plugin.
  it('should authenticate a request with anonymous consumer', async function () {
    // update the plugin to enable anonymous consumer
    const payload = {
      ...basePayload,
      config: {
        ...basePayload.config,
        anonymous: 'anonymous-tester',
      },
    };
    await patchPlugin(pluginId, payload);

    // request should fail because no anonymous consumer created yet and no valid header is provided
    await eventually(async () => {
      const resp1 = await axios({
        url: `${proxyUrl}${path}`,
        validateStatus: null,
      });
      logResponse(resp1);
      expect(resp1.status, 'Status should be 500').to.equal(500);
    });

    // create the anonymous consumer
    await createConsumer('anonymous-tester');

    // request should pass now
    await eventually(async () => {
      const resp2 = await axios({
        url: `${proxyUrl}${path}`,
        headers: {
          'Proxy-Authorization': ldap.token,
        },
        validateStatus: null,
      });
      logResponse(resp2);
      expect(resp2.status, 'Status should be 200').to.equal(200);
      expect(resp2.data.headers['X-Anonymous-Consumer'], 'X-Anonymous-Consumer should be true').to.equal('true');
      expect(resp2.data.headers['X-Consumer-Username'], 'X-Consumer-Username should be anonymous-tester').to.equal(
        'anonymous-tester',
      );
    });
  });

  afterEach(function () {
    if (this.currentTest?.state === 'failed') {
      getGatewayContainerLogs(kongContainerName, 50);
    }
  });

  after(async function () {
    await resetGatewayContainerEnvVariable(
      {
        KONG_KEYRING_ENABLED: `${isKongNative ? 'on' : 'off'}`,
      },
      kongContainerName,
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_KEYRING_ENABLED: `${isKongNative ? 'on' : 'off'}`,
        },
        'kong-dp1',
      );
    }

    await clearAllKongResources();
  });
});
