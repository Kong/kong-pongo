import axios, { AxiosPromise, AxiosResponse } from 'axios';
import { expect } from '../assert/chai-expect';
import { Environment, getBasePath, isGateway, isKoko } from '../config/environment';
import { logResponse, logScope } from './logging';
import { randomString } from './random';
import { getNegative } from './negative-axios';
import { isKongOSS, eventually } from '@support';


export const getUrl = (endpoint: string, workspaceNameOrId?: string) => {
  let basePath = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });
  if (workspaceNameOrId) {
    basePath = `${basePath}/${workspaceNameOrId}`;
  }
  if (endpoint && endpoint.startsWith('/')) {
    return `${basePath}${endpoint}`;
  }

  return `${basePath}/${endpoint}`;
};

const proxyUrl = `${getBasePath({
  app: 'gateway',
  environment: Environment.gateway.proxy,
})}`;

/**
 * Request to create GW Service
 * @param {string} name - service name
 * @param {object} payload - request payload
 * @param {string} workspace - name of the workspace
 * @param {string} serviceId - optional service id for upsert request
 * @returns {AxiosResponse}
 */
export const createGatewayService = async (
  name: string,
  payload?: object,
  workspace?: string,
  serviceId?: string
  
) => {
  payload ? (payload = { name, ...payload }) : null;
  const endpoint = `${workspace}/services`;

  let url = workspace ? `${getUrl(endpoint)}` : getUrl('services');

  if (serviceId) url = `${url}/${serviceId}`;
  

  const requestPayload = payload || {
    name,
    url: 'http://httpbin/anything',
  };
  const resp = await axios({
    method: serviceId ? 'put' : 'post',
    url,
    data: requestPayload,
  });
  logResponse(resp);
  expect(resp.status, `Status should be ${serviceId ? '200' : '201'}`).equal(serviceId ? 200 : 201);
  expect(resp.data.name, 'Should have correct service name').equal(name);
  return resp.data;
};

/**
 * Request to update GW Service
 * @param {string} serviceIdOrName
 * @param {object} payload - request payload
 * @param {string} workspace - name of the workspace
 * @returns {AxiosResponse}
 */
export const updateGatewayService = async (
  serviceIdOrName: string,
  payload?: object,
  workspace?: string
) => {
  payload ? (payload = { ...payload }) : null;
  const endpoint = `${workspace}/services/`;

  const url = workspace
    ? `${getUrl(endpoint)}`
    : getUrl(`services/${serviceIdOrName}`);

  const resp = await axios({
    method: 'patch',
    url,
    data: payload,
  });
  logResponse(resp);

  expect(resp.status, 'Status should be 200').equal(200);

  return resp.data;
};

/**
 * Reusable request to delete GW Service
 * @param {string} serviceIdOrName
 * @returns {AxiosResponse}
 */
export const deleteGatewayService = async (serviceIdOrName: string) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('services')}/${serviceIdOrName}`,
  });
  logResponse(resp);

  expect(resp.status, 'Status should be 204').to.equal(204);
  return resp;
};

/**
 * Adds Route to an existing Gateway Service
 * @param {string} serviceIdOrName
 * @param {string[]} paths - paths of the route
 * @param {object} payload - optional request body for the route
 * @param {string} workspace - name of the workspace
 * @param {string} routeId - optional route id for upsert request
 * @returns {AxiosResponse}
 */
export const createRouteForService = async (
  serviceIdOrName: string,
  paths?: string[] | null,
  payload?: object,
  workspace?: string,
  routeId?: string
) => {
  const endpoint = `${workspace}/services`;
  let url =`${getUrl(workspace ? endpoint : 'services')}/${serviceIdOrName}/routes`;
  if (routeId) url = `${url}/${routeId}`;

  payload ? (payload = { name: serviceIdOrName, paths, ...payload }) : null;

  const resp = await axios({
    method: routeId ? 'put' : 'post',
    url,
    data: payload || {
      name: randomString(),
      paths: paths ? paths : ['/apitest'],
    },
    validateStatus: null      
  });
  logResponse(resp);

  expect(resp.status, `Status should be ${routeId ? '200' : '201'}`).equal(routeId ? 200 : 201);
  return resp.data;
};

/**
 * Adds Expression Route to an existing Gateway Service
 * @param {string} serviceIdOrName
 * @param {string} expression - expression to use for route
 * @param {string} workspace - name of the workspace
 * @returns {AxiosResponse}
 */
export const createExpressionRouteForService = async (
  serviceIdOrName: string,
  expression?: string,
  payload?: object,
  workspace?: string
) => {
  const endpoint = `${workspace}/services`;
  const url =`${getUrl(workspace ? endpoint : 'services')}/${serviceIdOrName}/routes`;

  payload = payload ? 
  { expression: expression, ...payload } : 
  { expression: expression || '(http.path=="/apitest")' };

  const resp = await axios({
    method: 'post',
    url,
    data: payload,
    validateStatus: null    
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);
  return resp.data;
};

/**
 * Creates a route
 * @param {string[]} paths - paths of the route
 * @param {object} payload - optional request body for the route
 * @param {string} workspace - name of the workspace
 * @returns {AxiosResponse}
 */
export const createRoute = async (
  paths: string[],
  payload?: object,
  workspace?: string
) => {

  const endpoint = `${workspace}/routes`;
  const url = workspace ? `${getUrl(endpoint)}` : getUrl('routes');
  payload ? (payload = { paths, ...payload }) : null;

  const resp = await axios({
    method: 'post',
    url,
    data: payload || {
      name: randomString(),
      paths: paths ? paths : [`/${randomString()}`],
    },
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);
  return resp.data;
};

/**
 * Patch a route
 * @param {string} routeIdOrName
 * @param {object} payload - optional request body for the route
 * @param {string} workspace - name of the workspace
 * @returns {AxiosResponse}
 */
export const patchRoute = async (
  routeIdOrName: string,
  payload: object,
  workspace?: string
) => {

  const endpoint = `${workspace}/routes/${routeIdOrName}`;
  const url = workspace ? `${getUrl(endpoint)}` : getUrl(`routes/${routeIdOrName}`);
  payload ? (payload = { ...payload }) : null;

  const resp = await axios({
    method: 'patch',
    validateStatus: null,
    url,
    data: payload,
  });
  logResponse(resp);

  return resp;
};


/**
 * Delete the target route
 * @param {string} routeIdOrName route id or name
 * @param {object} headers optional headers
 * @returns {AxiosResponse}
 */
export const deleteGatewayRoute = async (
  routeIdOrName: string,
  workspaceNameOrId?: string
) => {
  const resp = await axios({
    method: 'delete',
    url: (workspaceNameOrId) ? `${getUrl('routes', workspaceNameOrId)}/${routeIdOrName}` : `${getUrl('routes')}/${routeIdOrName}`
  });
  logResponse(resp);

  expect(resp.status, 'Status should be 204').to.equal(204);

  return resp;
};

/**
 * Create a consumer
 * @param {string} username - optional username
 * @param {object} payload - optional payload
 * @param {string} workspace - name of the workspace
 * @param {string} consumerId - optional consumer id for upsert request
 * @returns {AxiosResponse}
 */
export const createConsumer = async (
  username?: string,
  payload?: object,
  workspace?: string,
  consumerId?: string
) => {
  const endpoint = `${workspace}/consumers`;
  let url =`${getUrl(workspace ? endpoint : 'consumers')}`;
  if (consumerId) url = `${url}/${consumerId}`;
  
  const resp = await axios({
    method: consumerId ? 'put' : 'post',
    url: url,
    data: payload || {
      username: username ? username : randomString(),
    },
  });
  logResponse(resp);

  expect(resp.status, `Status should be ${consumerId ? '200' : '201'}`).equal(consumerId ? 200 : 201);

  return resp.data;
};

/**
 * PATCH a consumer
 * @param {string} usernameOrId
 * @param {object} payload
 * @returns {AxiosResponse}
 */
export const patchConsumer = async (usernameOrId: string, payload: object) => {
  const resp = await axios({
    method: 'patch',
    url: `${getUrl('consumers')}/${usernameOrId}`,
    data: payload,
  });
  logResponse(resp);

  expect(resp.status, 'Status should be 200').to.equal(200);
  return resp.data;
};

/**
 * Delete a consumer
 * @param {string} usernameOrId
 * @returns {AxiosResponse}
 */
export const deleteConsumer = async (usernameOrId: string) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('consumers')}/${usernameOrId}`,
  });
  logResponse(resp);

  expect(resp.status, 'Status should be 204').to.equal(204);

  return resp;
};

/**
 * Create a consumer group
 * @param {string} consumerGroupName - optional consumer group name
 * @param {object} payload - optional payload
 * @returns {AxiosResponse}
 */
export const createConsumerGroup = async (
  consumerGroupName?: string,
  payload?: object
) => {
  const resp = await axios({
    method: 'post',
    url: getUrl('consumer_groups'),
    data: payload || {
      name: consumerGroupName ? consumerGroupName : randomString(),
    },
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);

  return resp.data;
};

/**
 * Delete a consumer group
 * @param {string} consumerGroupName - consumer group name
 * @returns {AxiosResponse}
 */
export const deleteConsumerGroup = async (consumerGroupNameOrId: string) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('consumer_groups')}/${consumerGroupNameOrId}`,
  });
  logResponse(resp);

  expect(resp.status, 'Status should be 204').to.equal(204);

  return resp;
};

/**
 * Create a consumer group scoped plugin
 * @param {string} consumerGroupNameOrId - consumer group name or id
 * @param {object} payload - payload
 * @returns {AxiosResponse}
 */
export const createConsumerGroupScopedPlugin = async (
  consumerGroupNameOrId: string,
  payload: object
) => {
  const resp = await axios({
    method: 'post',
    url: `${getUrl('consumer_groups')}/${consumerGroupNameOrId}/plugins`,
    data: payload,
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);

  return resp.data;
};

/**
 * Add the given consumer to the given consumer group
 * @param {object} consumerNameOrId - consumer name or id
 * @param {string} consumerGroupNameOrId - consumer group name or id
 * @returns {AxiosResponse}
 */
export const addConsumerToConsumerGroup = async (
  consumerNameOrId: object,
  consumerGroupNameOrId: string
) => {
  const resp = await axios({
    method: 'post',
    url: `${getUrl('consumer_groups')}/${consumerGroupNameOrId}/consumers`,
    data: {
      consumer: consumerNameOrId,
    },
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);

  return resp;
};

/**
 * Remove the given consumer from the given consumer group
 * @param {object} consumerNameOrId - consumer name or id
 * @param {string} consumerGroupNameOrId - consumer group name or id
 * @returns {AxiosResponse}
 */
export const removeConsumerFromConsumerGroup = async (
  consumerNameOrId: object,
  consumerGroupNameOrId: string
) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl(
      'consumer_groups'
    )}/${consumerGroupNameOrId}/consumers/${consumerNameOrId}`,
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 204').to.equal(204);

  return resp.data;
};

/**
 * Create a consumer group setting
 * @param {string} consumerGroupNameOrId - consumer group name or id
 * @param {string} pluginName - plugin name
 * @param {string} pluginId - id
 * @param {object} settings - settings
 * @returns {AxiosResponse}
 */
export const createConsumerGroupSettings = async (
  consumerGroupNameOrId: string,
  pluginName: string,
  pluginId: string,
  settings: object
) => {
  const resp = await axios({
    method: 'put',
    url: `${getUrl(
      'consumer_groups'
    )}/${consumerGroupNameOrId}/plugins/${pluginId}`,
    data: {
      name: pluginName,
      config: settings,
    },
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 200').to.equal(200);

  return resp.data;
};

/**
 * Create key-auth credentials for a consumer
 * @param {string} consumerNameOrId- consumer name or id
 * @param {string} workspace - name of the workspace
 * @returns {AxiosResponse}
 */
export const createKeyAuthCredentialsForConsumer = async (
  consumerNameOrId: string,
  workspace?: string
) => {
  const endpoint = `${workspace}/consumers`;
  const url =`${getUrl(workspace ? endpoint : 'consumers')}/${consumerNameOrId}/key-auth-enc`;

  const resp = await axios({
    method: 'post',
    url: url,
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);

  return resp.data;
};

/**
 * Create basic-auth plugin credentials for a given consumer
 * @param consumerNameOrId name or id of the target consumer
 * @param username optional basic-auth username
 * @param password optional basic-auth password
 * @returns {AxiosResponse}
 */
export const createBasicAuthCredentialForConsumer = async (
  consumerNameOrId: string,
  username?: string,
  password?: string
) => {
  const resp = await axios({
    method: 'post',
    url: `${getUrl('consumers')}/${consumerNameOrId}/basic-auth`,
    data: {
      username: username ? username : randomString(),
      password: password ? password : randomString(),
    },
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 201').to.equal(201);
  return resp;
};

/**
 * Upload a root CA Certificate
 * @param {string} cert - the root certificate
 * @returns {AxiosResponse}
 */
export const uploadCaCertificate = async (
  cert: string
) => {
  const resp = await axios({
    method: 'post',
    url: `${getUrl('ca_certificates')}`,
    data: {
      cert
    },
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);
  return resp.data;
};

/**
 * Delete CA Certificate
 * @param {string} certNameOrId
 * @returns {AxiosResponse}
 */
export const deleteCaCertificate = async (
  certNameOrId: string
) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('ca_certificates')}/${certNameOrId}`,
  });

  logResponse(resp);
  expect(resp.status, 'Status should be 204').to.equal(204);

  return resp
};

/**
 * Create a key for a consumer
 * @param {string} consumerNameorId
 * @param {string} pluginName - either key-auth or key-auth-enc
 * @param {string} keyCredentialPayload - key credential payload
 * @param {string} workspace - name of the workspace
 * @returns {AxiosResponse}
 */
export const createKeyCredentialForConsumer = async (
  consumerNameorId: string,
  pluginName = 'key-auth',
  keyCredentialPayload: object,
  workspace?: string
) => {
  const endpoint = `${workspace}/consumers`;
  const url =`${getUrl(workspace ? endpoint : 'consumers')}/${consumerNameorId}/${pluginName}`;

  const resp = await axios({
    method: 'post',
    url: url,
    data: keyCredentialPayload
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 201').to.equal(201);
  return resp.data;
};

/**
 * update a key for a consumer
 * @param {string} consumerNameorId
 * @param {string} pluginName - either key-auth or key-auth-enc
 * @param {string} keyCredentialPayload - key credential payload
 * @param {string} keyId - key id
 * @param {string} workspace - name of the workspace
 * @returns {AxiosResponse}
 */
export const updateKeyCredentialForConsumer = async (
  consumerNameorId: string,
  pluginName = 'key-auth',
  keyCredentialPayload: object,
  keyId: string,
  workspace?: string
) => {
  const endpoint = `${workspace}/consumers`;
  const url =`${getUrl(workspace ? endpoint : 'consumers')}/${consumerNameorId}/${pluginName}/${keyId}`;

  const resp = await axios({
    method: 'put',
    url: url,
    data: keyCredentialPayload
  });

  logResponse(resp);

  expect(resp.status, 'Status should be 200').to.equal(200);
  return resp.data;
};


/**
 * Get all existing workspaces
 * @returns {AxiosResponse}
 */
export const getWorkspaces = async () => {
  const resp = await axios(`${getUrl('workspaces')}`);
  logResponse(resp);
  expect(resp.status, 'Status should be 200').to.equal(200);

  return resp.data;
};

/**
 * Create a workspace
 * @param {string} workspaceName
 * @returns {AxiosResponse}
 */
export const createWorkspace = async (workspaceName: string) => {
  const resp = await axios({
    method: 'post',
    url: `${getUrl('workspaces')}`,
    data: {
      name: workspaceName,
    },
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 201').to.equal(201);

  return resp.data;
};

/**
 * Delete a workspace
 * @param {string} workspaceNameOrId
 * @returns {AxiosResponse}
 */
export const deleteWorkspace = async (workspaceNameOrId: string) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('workspaces')}/${workspaceNameOrId}`
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 204').to.equal(204);

  return resp;
};

/**
 * Create a Plugin
 * @param {object} pluginPayload - request body for plugin creation
 * @param {string} workspace - optional name of the workspace to create plugin
 * @param {string} pluginId - optional plugin id for upsert request
 * @returns {AxiosResponse}
 */
export const createPlugin = async (
  pluginPayload: object,
  workspace?: string,
  pluginId?: string
) => {

  if(isKoko() || isKongOSS()) {
    workspace = ''
  } else if (isGateway()){
    workspace = workspace ? workspace : 'default'
  }

  const endpoint = `${workspace}/plugins`;
  const url = pluginId ? `${getUrl(endpoint)}/${pluginId}` : getUrl(endpoint);

  const resp = await axios({
    method: pluginId ? 'put' : 'post',
    url: url,
    data: pluginPayload,
  });

  logResponse(resp);
  expect(resp.status, `Status should be ${pluginId ? '200' : '201'}`).equal(pluginId ? 200 : 201);

  return resp.data;
};

/**
 * Patch a plugin
 * @param {string} pluginId
 * @param {object} pluginPayload
 * @returns {AxiosResponse}
 */
export const patchPlugin = async (pluginId: string, pluginPayload: object) => {
  const resp = await axios({
    method: 'patch',
    url: `${getUrl('plugins')}/${pluginId}`,
    data: pluginPayload,
  });
  logResponse(resp);

  expect(resp.status, 'Status should be 200').to.equal(200);
  return resp.data;
};


/**
 * Delete a plugin
 * @param {string} pluginId
 * @returns {AxiosResponse}
 */
export const deletePlugin = async (pluginId: string) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('plugins')}/${pluginId}`,
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 204').to.equal(204);
};

/**
 * Create upstream
 * @param {string} upstreamName - name of the upstream
 * @param {object} payload- request payload
 */
export const createUpstream = async (upstreamName = randomString(), payload?: object) => {
  payload ? (payload = { ...payload, name: upstreamName,  }) : null;

  const resp = await axios({
    method: 'post',
    url: `${getUrl('upstreams')}`,
    data: payload || {
      name: upstreamName,
      healthchecks: {
        active: {
          healthy: {
            interval: 2,
            successes: 2,
            http_statuses: [200, 302]
          },
          unhealthy: {
            interval: 2,
            http_failures: 1,
            http_statuses: [429, 404, 500, 501, 502, 503, 504, 505]
          }
        },
      },
    },
  });
  logResponse(resp);

  return resp.data
}

/**
 * Delete an upstream
 * @param {string} upstreamId
 * @returns {AxiosResponse}
 */
export const deleteUpstream = async (upstreamId: string) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('upstreams')}/${upstreamId}`,
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 204').to.equal(204);
};

/**
 * Create a target for an existing upstream
 * @param {string} upstreamId - upstream id to create target for
 * @param {string} target - target url
 * @returns {AxiosResponse}
 */
export const addTargetToUpstream = async (upstreamId: string, target: string) => {
  const resp = await axios({
    url: `${getUrl('upstreams')}/${upstreamId}/targets`,
    method: 'post',
    data: {
      target,
      weight: 1000
    },
  });
  logResponse(resp);

  expect(resp.status, 'should return 201 status').to.equal(201);
  return resp.data
}


/**
 * Create a filter chain on a service
 * @param {object} filterChainPayload - request body for filter chain creation
 * @param {string} serviceNameOrId - service name or id to attach the filter chain
 * @param {string} workspace - optional name of the workspace to create filter chain
 * @returns {AxiosResponse}
 */
export const createFilterChainForService = async (
  filterChainPayload: object,
  serviceNameOrId: string,
  workspace?: string
) => {
  workspace = workspace ? workspace : 'default';
  const endpoint = `${workspace}/services/${serviceNameOrId}/filter-chains`;

  const resp = await axios({
    method: 'post',
    url: `${getUrl(endpoint)}`,
    data: filterChainPayload,
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 201').to.equal(201);

  return resp.data;
};

/**
 * Create a filter chain on a route
 * @param {object} filterChainPayload - request body for filter chain creation
 * @param {string} routeNameOrId - route name or id to attach the filter chain
 * @param {string} workspace - optional name of the workspace to create filter chain
 * @returns {AxiosResponse}
 */
export const createFilterChainForRoute = async (
  filterChainPayload: object,
  routeNameOrId: string,
  workspace?: string
) => {
  workspace = workspace ? workspace : 'default';
  const endpoint = `${workspace}/routes/${routeNameOrId}/filter-chains`;

  const resp = await axios({
    method: 'post',
    url: `${getUrl(endpoint)}`,
    data: filterChainPayload,
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 201').to.equal(201);

  return resp.data;
};

/**
 * Delete a filter chain
 * @param {string} filterChainNameOrId
 * @returns {AxiosResponse}
 */
export const deleteFilterChain = async (filterChainNameOrId: string) => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('filter-chains')}/${filterChainNameOrId}`,
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 204').to.equal(204);
};



/**
 * Delete kong cache
 */
export const deleteCache = async () => {
  const resp = await axios({
    method: 'delete',
    url: `${getUrl('cache')}`,
  });
  logResponse(resp);
  expect(resp.status, 'Status should be 204').to.equal(204);
};

/**
 *
 */
export const getRouterFlavor = async () => {
  return (await axios(getUrl(''))).data.configuration.router_flavor
};


export const checkGatewayAdminStatus = async () => {
  await eventually(async () => {
    const admin_url = getUrl("/")
    const resp = await axios({
      url: admin_url,
      method: 'get',
      validateStatus: null
    });
    expect(resp.status, 'Kong Gateway Admin API timed out').to.equal(200)
  });
}

/**
 * Create a service and a route, send request to route until it is 200
 * after getting 200, delete the service/route, send request again to the route until it is 404
 * This triggers router rebuild making sure all configuration updates have been propagated in kong
 * @param {object} options
 * @property {number} timeout - retry timeout
 * @property {number} delay - retry delay
 * @property {object} proxyReqHeader - custom proxy request header e.g. key-auth key
 */
export const waitForConfigRebuild = async (options: any = {}) => {
  // ensure admin API is ready before creating entities
  logScope('waitForConfigRebuild', 'start');

  await checkGatewayAdminStatus();

  // create a service
  const service = await createGatewayService(`routerRebuild-${randomString()}`);
  const serviceId = service.id;

  // create a route for a service
  const routePath = `/routerRebuild-${randomString()}`;
  const router_flavor = isGateway() ? await getRouterFlavor() : 'traditional_compatible'
  const route = router_flavor == 'expressions' ? await createExpressionRouteForService(serviceId, `http.path == "${routePath}"`) : await createRouteForService(serviceId, [routePath]);
  const routeId = route.id;

  // create a key-auth plugin for the route
  const plugin = await createPlugin({
    name: 'key-auth',
    service: {
      id: serviceId,
    },
    route: {
      id: routeId,
    },
    config: {},
  });
  const pluginId = plugin.id;

  // send request to route until response is 401
  await eventually(async () => {
    const resp = await getNegative(`${proxyUrl}${routePath}`, options?.proxyReqHeader);
    expect(resp.status, 'waitForConfigRebuild - expecting new entities to be active').to.equal(401);
  }, options?.timeout, options?.delay, options?.verbose);

  // removing the entities
  await deletePlugin(pluginId);
  await deleteGatewayRoute(routeId);
  await deleteGatewayService(serviceId);

  // send request to route until response is 404
  await eventually(async () => {
    const resp = await getNegative(`${proxyUrl}${routePath}`, options?.proxyReqHeader);
    expect(resp.status, 'waitForConfigRebuild - expecting 404 after deleting entities').to.equal(404);
  }, options?.timeout, options?.delay, options?.verbose);

  logScope('waitForConfigRebuild', 'end');

  return true
};

interface ItemProps {
  id?: string;
  username?: string;
  name?: string;
}

interface ResponseProps {
  data: Array<ItemProps>;
}

export const clearAllKongResources = async (workspaceNameorId?: string) => {
  await clearKongResource('consumers', workspaceNameorId);
  await clearKongResource('consumer_groups', workspaceNameorId);
  await clearKongResource('plugins', workspaceNameorId);
  await clearKongResource('certificates', workspaceNameorId);
  await clearKongResource('ca_certificates', workspaceNameorId);
  await clearKongResource('snis', workspaceNameorId);
  await clearKongResource('vaults', workspaceNameorId);
  await clearKongResource('routes', workspaceNameorId);
  await clearKongResource('services', workspaceNameorId);
  await clearKongResource('upstreams', workspaceNameorId);
  await clearKongResource('partials', workspaceNameorId);
  await clearKongResource('key-sets', workspaceNameorId);
};

export const clearKongResource = async (endpoint: string, workspaceNameorId?: string) => {
  const tasks: (() => AxiosPromise)[] = [];
  const url = getUrl(endpoint, workspaceNameorId)
  try {
    const items: ItemProps[] = [];
    let next = url;

    for (;;) {
      const res: AxiosResponse<ResponseProps> = await axios({
        method: 'get',
        url: next,
      });

      if (Array.isArray(res.data.data)) {
        items.push(...res.data.data);
      }

      if ((res.data as any)?.next) {
        next = getUrl((res.data as any)?.next, workspaceNameorId)
      } else {
        break;
      }
    }

    if (items.length === 0) {
      return;
    }

    items.forEach((resource: ItemProps) => {
      const clearAllOptions = {
        method: 'DELETE',
        url: `${getUrl(endpoint, workspaceNameorId)}/${resource.id || resource.name}`
      };

      tasks.push(async () => axios(clearAllOptions));
    });
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return;
  }

  try {
    await Promise.all(
      Array.from({ length: 10 }).map(async () => {
        let task: (() => AxiosPromise) | undefined;

        while ((task = tasks.shift())) {
          try {
            await task();
          } catch (e) {
            if (axios.isAxiosError(e) && e.response?.status === 404) {
              continue;
            }

            throw e;
          }
        }
      })
    );
  } catch (err) {
    console.log(err);
  }
};

/**
 * Wait for /cache/${cacheKey} to return a 404
 * @param cacheKey - cache key to wait for
 * @param timeout - timeout in ms
 */
export const waitForCacheInvalidation = async (cacheKey: string, timeout?: number) => {
  await eventually(async () => {
      const res = await getNegative(`${getUrl('cache')}/${cacheKey}`);
      expect(res.status, `cache API endpoint for ${cacheKey} should return 404 when item is invalidated`).to.equal(404);
    },
    timeout
  );
};
