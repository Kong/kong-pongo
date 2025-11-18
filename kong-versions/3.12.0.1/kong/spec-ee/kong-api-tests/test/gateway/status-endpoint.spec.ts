// This test requires `make generate STATUS_LISTEN=true HTTP2=true  GW_MODE=hybrid` to pass

import {
  expect,
  isGwHybrid,
  isLocalDatabase,
  expectStatusReadyEndpointOk,
  expectStatusReadyEndpoint503,
  getStatusSyncEndpointResponse,
  getIncrementalSyncStatus,
  expectSyncStatusField,
  waitForTargetStatus,
  runDockerContainerCommand,
  eventually,
  runDockerComposeCommand,
  logDebug,
  createWorkspace,
  createGatewayService,
  createRouteForService,
  createPlugin,
  waitForConfigRebuild,
  cleanAndDeleteWorkspaceIfExists,
  logResponse,
} from '@support';

// skip tests for package mode due to failures in the last test
// needs to be investigated why the kong-ee-database throws cert access denied error and doesn't start

function expectDatabaseHealthy(containerName: string) {
  return eventually(async () => {
    const containerStatus = JSON.parse(runDockerContainerCommand(containerName, "inspect"));
    expect(typeof containerStatus).to.equal("object");
    expect(typeof containerStatus[0]).to.equal("object");
    logDebug(`[Database Health] Status: ${containerStatus[0]?.State?.Health?.Status}`);
    expect(containerStatus[0]?.State?.Health?.Status).to.equal("healthy");
  });
}

describe('Status Endpoint tests', function () {
  let isHybrid: boolean;
  let isLocalDb: boolean;
  const databaseContainerName = 'kong-ee-database';
  const dpPortNumber = 8101;

  before(async function () {
    isLocalDb = isLocalDatabase();
    isHybrid = isGwHybrid();
  });

  context('@oss: Ready status Endpoit test', function () {
    before(async function () {
      if (!isLocalDb) {
        logDebug(`Skipping Ready test as database mode is ${isLocalDb}`);
        this.skip();
      }
    });

    it('should return 200 OK for CP status when Kong is loaded and ready', async function () {
      await expectStatusReadyEndpointOk();
    });

    it('should return 503 for CP status when connection to database is lost', async function () {
      // Stop the database using docker compose
      const stopCommand = `stop ${databaseContainerName}`;
      logDebug(`[Docker Compose] Running: ${stopCommand}`);
      runDockerComposeCommand(stopCommand);

      const waitResult = runDockerContainerCommand(databaseContainerName, 'container wait');
      logDebug(`Stop command output: ${waitResult}`);

      await waitForTargetStatus(503, 15000);
      await expectStatusReadyEndpoint503('failed to connect to database');
    });

    if (isHybrid) {
      it('should return 200 in DP status when connection to database is severed', async function () {
        await waitForTargetStatus(200, 15000, dpPortNumber);
      });
    }

    it('should return 200 OK for CP status when connection to database is restored', async function () {
      // Restore connection between Kong and database
      const dockerComposeCommand = `start ${databaseContainerName}`;
      runDockerComposeCommand(dockerComposeCommand);
      // Wait for database to be healthy
      await expectDatabaseHealthy(databaseContainerName);
      try {
        await waitForTargetStatus(200, 30000);
      } catch (err) {
        // Did not get 200, do recovery
        logDebug('Did not get 200 from /status/ready in 30s, attempting recovery...');
        runDockerComposeCommand('up -d');

        // Wait for database to be healthy again
        await expectDatabaseHealthy(databaseContainerName);
        logDebug(`container ${databaseContainerName} is healthy again, waiting for /status/ready to return 200`);
        // Wait for Kong to be ready
        await waitForTargetStatus(200, 60000);
      }
    });

  });

  context('sync status Endpoit test', function () {
    const workspaceName = 'sdet-workspace-statusEndpoint';
    const serviceName = 'statusEndpointService';
    const routePath = '/statusEndpointRoute';
    let serviceId: string;

    before (async function () {
      const isIncSyncMode = await getIncrementalSyncStatus();
      const pluginPayload = {
        name: 'basic-auth',
        config: {
          hide_credentials: true,
        },
      };
      if (!(isHybrid && isIncSyncMode)) {
        logDebug(`Skipping /status/sync test as hybrid mode is ${isHybrid} or incremental sync status is ${isIncSyncMode}`);
        this.skip();
      }
      await createWorkspace(workspaceName);
      const serviceResp = await createGatewayService(serviceName, undefined, workspaceName);
      serviceId = serviceResp.id;
      await createRouteForService(serviceId, [routePath], undefined, workspaceName);
      await createPlugin(pluginPayload, workspaceName);

      await waitForConfigRebuild();
    });

    it('should return sync status in /status/sync endpoint', async function () {
      const response = await getStatusSyncEndpointResponse(dpPortNumber);   
      expect(response.status).to.equal(200);
      logResponse(response);
      const latestArr = response.data?.incremental_sync?.latest;

      // Check each field
      expectSyncStatusField(latestArr, 'workspaces');
      expectSyncStatusField(latestArr, 'services');
      expectSyncStatusField(latestArr, 'routes');
      expectSyncStatusField(latestArr, 'plugins');        
    });
    

    after(async function () {
      await cleanAndDeleteWorkspaceIfExists(workspaceName);
    });

  });


});
