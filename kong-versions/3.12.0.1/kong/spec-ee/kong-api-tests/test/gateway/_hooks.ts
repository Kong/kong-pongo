import { 
  clearAllKongResources, 
  createRedisClient, 
  createRedisClusterClient, 
  gatewayAuthHeader, 
  isCI, 
  isKongOSS, 
  isLocalDatabase, 
  isGwDbless, 
  checkGatewayAdminStatus,
  createWorkspace,
  deleteWorkspace,
  getWorkspaces,
} from '@support';
import {
  safePostGatewayEeLicense,
  deleteGatewayEeLicense,
} from '@shared/gateway_workflows';
import axios from 'axios';

const workspaceName = "sdet-workspace-" + Math.random().toString(36).substring(2, 8);
globalThis.nonDefaultWorkspace = workspaceName;


export const mochaHooks: Mocha.RootHookObject = {
  beforeAll: async function (this: Mocha.Context) {
    try {
      // Set Auth header for Gateway Admin requests
      console.log('Setting up Admin API authentication...');
      const { authHeaderKey, authHeaderValue } = gatewayAuthHeader();
      axios.defaults.headers[authHeaderKey] = authHeaderValue;
      console.log('Initializing Redis clients...');
      createRedisClient();
      createRedisClusterClient();
      //avoid any write operations to gateway admin api in dbless mode
      if (isCI() && !isKongOSS() && !isGwDbless()) {
        // Gateway for API tests starts without EE_LICENSE in CI, hence, we post license at the beginning of all tests to allow us test the functionality of license endpoint
        console.log('Posting Gateway EE License...');
        await safePostGatewayEeLicense();
        console.log('Checking Admin API accessibility...');
        await checkGatewayAdminStatus();
        // Clear all Kong resources before starting tests to ensure a clean state
        console.log('Clearing all Kong resources before starting tests...');
        await clearAllKongResources(); 
      }

      // create a workspace for tests that need non-default workspace
      console.log(`Crerating non-default workspace: ${workspaceName}`);
      await createWorkspace(workspaceName);
      
    } catch (err) {
      console.error(`Something went wrong in beforeAll hook while rebuilding configuration: ${err}\n`)
      if (!isLocalDatabase()) {
        console.log("WARNING: To avoid flakiness, please make sure only run one test at a time when AWS RDS is used!")
      }
      // remove all possible remnant entities from failed waitForConfigRebuild above to start tests from clean state and avoid flakiness
      if (!isGwDbless()) {
        await clearAllKongResources();
      }
    }
  },

  afterAll: async function (this: Mocha.Context) {
    const workspaces = await getWorkspaces();
    const workspaceList = workspaces?.data || [];
    if(workspaceList.some((ws: any) => ws.name === workspaceName)) {
      console.log(`Deleting non-default workspace: ${workspaceName}`);
      await clearAllKongResources(workspaceName);
      await deleteWorkspace(workspaceName);
    }

    // Gateway for API tests starts without EE_LICENSE in CI, hence, we delete license at the end of all tests to allow test rerun from clean state
    // Skipping this step for OSS tests
    if (isCI() && !isKongOSS() && !isGwDbless()) {
      console.log('Clearing all Kong resources...');
      await clearAllKongResources();
      console.log('Deleting Gateway EE License...');
      await deleteGatewayEeLicense();
      if (!isLocalDatabase()) {
        console.log("WARNING: To avoid flakiness, please make sure only run one test at a time when AWS RDS is used!")
      }
    }
  },
};
