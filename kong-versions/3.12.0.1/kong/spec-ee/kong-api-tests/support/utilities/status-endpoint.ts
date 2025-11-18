import axios, { AxiosResponse } from 'axios';
import https from 'https';
import {
  logResponse,
  logDebug,
  getGatewayHost,
  expect,
  getBasePath,
  Environment,
  eventually,
} from '@support';

const defaultPort = 8100;

const agent = new https.Agent({
  rejectUnauthorized: false,
});

axios.defaults.httpsAgent = agent;

const adminUrl = `${getBasePath({
  app: 'gateway',
  environment: Environment.gateway.adminSec,
})}`;

/**
 * Get /status/ready endpoint response
 * @param {number} port - port to use
 */
export const getStatusReadyEndpointResponse = async (
  port = defaultPort
) : Promise<AxiosResponse> =>
    axios({
      url: `https://${getGatewayHost()}:${port}/status/ready`,
      validateStatus: null,
    })

/**
 * Get /status/sync endpoint response
 * @param {number} port - port to use
 */
export const getStatusSyncEndpointResponse = async (
  port = defaultPort
) : Promise<AxiosResponse> =>
    axios({
      url: `https://${getGatewayHost()}:${port}/status/sync`,
      validateStatus: null,
    })


/**
 * Expect /status/ready to return 200 OK
 * @param {number} port - port to use
 */
export const expectStatusReadyEndpointOk = async (port = defaultPort) => {
  const response = await getStatusReadyEndpointResponse(port);
  logResponse(response);
  expect(response.status).to.equal(200);
  expect(response.data.message).to.equal('ready');
};

/**
 * Expect /status/ready to return 503 with given message
 * @param {string} message - message to expect
 * @param {number} port - port to use
 */
export const expectStatusReadyEndpoint503 = async (
  message,
  port = defaultPort
) => {
  const response = await getStatusReadyEndpointResponse(port);
  logResponse(response);

  expect(response.status).to.equal(503);
  expect(response.data.message).to.equal(message);
  return response;
};

/**
 * Wait for /status/ready to return given status
 * @param returnStatus - status to wait for
 * @param timeout - timeout in ms
 * @param port - port to use
 */
export const waitForTargetStatus = async (
  returnStatus: number,
  timeout: number,
  port: number = defaultPort
) => {
  await eventually(async () => {
    let response;
    try {
      response = await getStatusReadyEndpointResponse(port);
      logResponse(response);
      expect(response.status).to.equal(returnStatus);
    } catch (err: any) {
      // Log network errors and their stack
      logDebug(`[Kong Status] Network error: ${err.message}`);
      if (err.response) {
        logResponse(err.response);
      }
      throw err;
    }
  }, timeout);
};

export const getClusteringDataPlanes = async () => {
  const resp = await axios({
    url:`${adminUrl}/clustering/data-planes`,
  })

  return resp.data
}

/**
 * Validates that at least one object in the sync status array contains the specified field
 * with value > 0, and also checks version, full_sync, and deltas fields.
 * 
 * @param {any[]} latestArr - The array to check (usually resp.incremental_sync.latest)
 * @param {string} field - The field to check (e.g., 'workspaces', 'services', 'routes', 'plugins')
 */
export function expectSyncStatusField(latestArr: any[], field: string) {
  expect(Array.isArray(latestArr), 'latest should be an array').to.be.true;
  const obj = latestArr.find(o => o[field] && o[field] > 0);
  expect(obj, `Should have an object with ${field} > 0`).to.exist;
  expect(obj[field], `${field} should be > 0`).to.be.a('number').and.to.be.greaterThan(0);
  expect(obj.version, `${field} should have version`).to.be.a('string').and.not.empty;
  expect(obj.full_sync, `${field} should have full_sync boolean`).to.be.a('boolean');
  expect(obj.deltas, `${field} should have deltas > 0`).to.be.a('number').and.to.be.greaterThan(0);
}