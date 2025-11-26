import axios from "axios";
import {
  randomString,
  createWorkspace,
  createGatewayService,
  createRouteForService,
  createConsumer,
  logResponse,
  isGateway,
  getBasePath,
  Environment,
  clearAllKongResources,
  createPlugin,
  patchPlugin,
  expect,
  createKeyCredentialForConsumer,
  getUrl,
  eventually,
  deletePlugin,
  deleteWorkspace,
} from '@support';


// Note: Up to now, only tests related to https://konghq.atlassian.net/browse/FTI-6974 are added here. 
describe('Gateway Plugins: ACL', function () {
  const basePath = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;

  const path = `/${randomString()}`;
  let serviceId: string;
  let routeId: string;
  let consumerId: string;
  let basePayload: any;
  let acl_pluginId: string;

  const workspaceName = `sdet-workspace-acl-${randomString()}`;
  const path2 = `/${randomString()}`;
  let consumerId2: string;
  let acl_pluginId2: string;

  const createACLGroup = async (
    consumerId?: string,
    payload?: object,
    workspace?: string,
  ) => {
    const endpoint = `${workspace}/consumers/${consumerId}/acls`;
    const url = `${getUrl(workspace ? endpoint : `/default/consumers/${consumerId}/acls`)}`;
    const resp = await axios({
      method: 'post',
      url: url,
      data: payload,
      validateStatus: null
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 201').to.equal(201);
    return resp.data;
  };

  before(async function () {
    const keyAuthPluginPayload = {
      name: "key-auth",
      config: { "key_names": ["apikey"] }
    };

    // create a service, route, and key-auth plugin; then add a consumer with a key-auth credential in the default workspace
    const service = await createGatewayService(randomString());
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [path]);
    routeId = route.id;
    await createPlugin(keyAuthPluginPayload);
    const consumer = await createConsumer();
    consumerId = consumer.id;
    await createKeyCredentialForConsumer(consumerId, 'key-auth', { 'key': 'top-secret-key' });

    // create a base payload for ACL plugin in the default workspace
    basePayload = {
      name: 'acl',
      service: {
        id: serviceId,
      },
      route: {
        id: routeId,
      },
    };

    // create a workspace
    await createWorkspace(workspaceName);

    // create a service, route, and key-auth plugin, then add a consumer with a key-auth credential in the created workspace
    const service2 = await createGatewayService(randomString(), undefined, workspaceName);
    await createRouteForService(service2.id, [path2], undefined, workspaceName);
    await createPlugin(keyAuthPluginPayload, workspaceName);
    const consumer2 = await createConsumer(undefined, undefined, workspaceName);
    consumerId2 = consumer2.id;
    await createKeyCredentialForConsumer(consumerId2, 'key-auth', { 'key': 'another-top-secret-key' }, workspaceName);
  })

  it('should not be able to create ACL plugin when both config.allow and config.deny are empty', async function () {
    const resp = await axios({
      method: 'post',
      url: `${basePath}/plugins`,
      data: basePayload,
      validateStatus: null
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should get the correct error message').to.contain(`at least one of these fields must be non-empty: 'config.allow', 'config.deny'`);
  })

  it('should not be able to create ACL plugin when both config.allow and config.deny are set', async function () {
    const payload = {
      ...basePayload,
      config: {
        allow: ['acl-group1'],
        deny: ['acl-group'],
      }
    };
    const resp = await axios({
      method: 'post',
      url: `${basePath}/plugins`,
      data: payload,
      validateStatus: null
    });
    logResponse(resp);
    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should get the correct error message').to.contain(`exactly one of these fields must be non-empty: 'config.allow', 'config.deny'`);
  })

  it('should be able to create ACL plugin when only config.deny is set and create an ACL group', async function () {
    // create an ACL plugin
    const payload = {
      ...basePayload,
      config: {
        deny: ['acl-group1'],
      }
    };
    const resp = await createPlugin(payload);
    acl_pluginId = resp.id;
    expect(resp.config.deny.length, 'config.deny.length should be 1').to.equal(1);
    expect(resp.config.deny[0], 'config.deny[0] should be acl-group1').to.equal('acl-group1');

    // create an ACL group
    await createACLGroup(consumerId, { group: 'acl-group1' });
  })

  it('should deny the consumer when ACL plugin configures config.deny', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        headers: { apiKey: 'top-secret-key' },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 403').to.equal(403);
      expect(resp.data.message, 'Message should be correct').to.equal('You cannot consume this service');
    })
  })

  it('should allow the consumer when ACL plugin configures config.allow', async function () {
    // update the ACL plugin with config.allow only
    const payload = {
      config: {
        allow: ['acl-group1'],
        deny: [], // reset the config.deny
      }
    }
    await patchPlugin(acl_pluginId, payload);

    // request should be allowed
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        headers: { apiKey: 'top-secret-key' },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
    })
  })

  // Tests for non-default workspace (cover FTI-6974)
  it('should successfully create ACL plugin and create an ACL group in a non-default workspace', async function () {
    // create an ACL plugin in the non-default workspace with config.allow only
    const payload = {
      name: 'acl',
      config: {
        allow: ['acl-group2']
      }
    };
    const resp = await createPlugin(payload, workspaceName);
    acl_pluginId2 = resp.id;

    // request should be denied as no ACL group exists
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path2}`,
        headers: { apiKey: 'another-top-secret-key' },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 403').to.equal(403);
      expect(resp.data.message, 'Message should be correct').to.equal('You cannot consume this service');
    })

    // create an ACL group in the non-default workspace
    await createACLGroup(consumerId2, { group: 'acl-group2' }, workspaceName);
  })

  it('should allow the consumer according to acl plugin in a non-default workspace', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path2}`,
        headers: { apiKey: 'another-top-secret-key' },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
    })
  })

  it('should deny the consumer according to ACL plugin in a non-default workspace', async function () {
    const payload = {
      config: {
        allow: [],
        deny: ['acl-group2'],
      }
    }
    await patchPlugin(acl_pluginId2, payload, workspaceName);

    // request should be denied
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path2}`,
        headers: { apiKey: 'another-top-secret-key' },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
    })
  })

  it('should be able to delete the ACL plugin', async function () {
    await deletePlugin(acl_pluginId);
    await deletePlugin(acl_pluginId2);
  })

  after(async function () {
    await clearAllKongResources(workspaceName);
    await deleteWorkspace(workspaceName);
    await clearAllKongResources();
  })

})