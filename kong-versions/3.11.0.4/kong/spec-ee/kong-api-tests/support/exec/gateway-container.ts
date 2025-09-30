import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getKongContainerName, isGwNative, isFipsMode } from 'support/config/gateway-vars';
import axios from 'axios';
import { expect } from 'chai';
import {
  eventually,
  getGatewayBasePath,
  runSpawnCommand,
  createGatewayService,
  createRouteForService,
  randomString,
  deleteGatewayRoute,
  deleteGatewayService,
  getBasePath,
  Environment,
  wait,
  isGwHybrid
} from 'support';

/**
 * Gets the current nginx worker process PIDs as a string array.
 * @returns {Promise<string[]>} Array of worker process PIDs.
 */
async function getWorkerPids(containerName: string): Promise<string[]> {
  const isMacOS = process.platform === 'darwin';
  const pgrepCommand = `pgrep -f 'nginx: worker process'`;
  let raw: string;
  
  if (isMacOS) {
    raw = await runSpawnCommand(`docker exec ${containerName} ${pgrepCommand}`, {print: false});
    console.log(`[KongReload] Running on macOS, using docker exec for worker PIDs`);
  } else {
    raw = await runSpawnCommand(pgrepCommand, {print: false});
  }
  return raw.split('\n').filter(Boolean);
}

/**
 * Compares nginx worker PIDs before and after reload.
 *
 * @param before - Array of PIDs before reload.
 * @param after - Array of PIDs after reload.
 * @returns An object containing:
 *   - common: PIDs present in both before and after arrays.
 *   - removed: Number of PIDs removed after reload.
 *   - added: Number of new PIDs added after reload.
 *   - totalCurrent: Total number of current PIDs after reload.
 */
function compareWorkerPids(before: string[], after: string[]) {
  const common = before.filter(pid => after.includes(pid));
  const removed = before.length - common.length;
  const added = after.length - common.length;
  const totalCurrent = after.length;
  return { common, removed, added, totalCurrent };
}

/**
 * Checks and verifies worker process count is within safe range for Kong Gateway.
 * This function handles both pre-reload and post-reload verification scenarios.
 * 
 * @param {Object} params - Configuration parameters
 * @param {string} params.containerName - Docker container name running Kong Gateway
 * @param {number} params.cpuCoreCount - Number of CPU cores available to the system
 * @param {number} params.maxExpectedWorkerCount - Maximum allowed worker process count
 * @param {number} params.delay - Delay in milliseconds to wait between checks or if max count reached
 * @param {boolean} [params.isAfterReload=false] - Whether checking after reload (true) or before (false)
 * @param {string[]} [params.workerPidsBeforeReload=[]] - Worker PIDs captured before reload (needed for after-reload checks)
 * @returns {Promise<string[]>} - Array of worker process PIDs after verification
 */
async function verifyWorkerProcessCount({
  containerName,
  cpuCoreCount, 
  maxExpectedWorkerCount,
  delay,
  isAfterReload = false,
  workerPidsBeforeReload = [],
}: {
  containerName: string,
  cpuCoreCount: number,
  maxExpectedWorkerCount: number,
  delay: number,
  isAfterReload?: boolean,
  workerPidsBeforeReload?: string[],
}): Promise<string[]> {
  console.log(`[KongReload] Verifying worker process count ${isAfterReload ? 'after' : 'before'} reload...`);
  
  let workerPids: string[] = [];
  
  await eventually(
    async () => {
       workerPids = await getWorkerPids(containerName);

      if (isAfterReload) {
        // Validate that new workers were added
        const { removed, added, totalCurrent } = compareWorkerPids(workerPidsBeforeReload, workerPids);
        console.log(`[KongReload] Worker PIDs - Removed: ${removed}, Added: ${added}, Total Current: ${totalCurrent}`);
        expect(
          added,
          `[KongReload] Expected at least ${cpuCoreCount} new worker(s), but got ${added}`
        ).to.be.at.least(cpuCoreCount);
      }
      
      // Common validation for both cases
      const currentCount =  workerPids.length;
      expect(
        currentCount,
        `[KongReload] Too many workers ${isAfterReload ? 'after' : 'before'} reload: ${currentCount} (max: ${maxExpectedWorkerCount})`
      ).to.be.at.most(maxExpectedWorkerCount);
      
      // Wait if at maximum
      if (currentCount === maxExpectedWorkerCount) {
        console.log(`[KongReload] Max worker count reached, waiting ${delay}ms`);
        await wait(delay); // eslint-disable-line no-restricted-syntax
      }
    },
    180000,
    isAfterReload ? delay : undefined
  );
  
  return workerPids;
}
/**
 * Waits for Kong Gateway to be ready by polling the /status/ready endpoint.
 * Throws if Kong is not ready within the eventually timeout.
 * @param {string} containerName - The name of the Kong container to check.
 */
async function waitForKongReady(containerName: string) {
  await eventually(async () => {
    const base_url = containerName === 'kong-dp1' ? getGatewayBasePath('statusDP') : getGatewayBasePath('status')
    const resp = await axios.get(`${base_url}/status/ready`)
    expect(resp.status, 'Kong Gateway timed out, restarting').to.equal(200);
    expect(resp.data.message, 'Message should be ready').to.equal('ready');
  });
  console.log(`[KongReload] Kong is ready.`);
}

/**
 * Prepares the Kong Gateway environment for reload testing.
 *
 * This function will:
 * - Create a test service and route for later verification.
 * - Wait for the worker process count to be in a safe range.
 * - Capture the worker PIDs before reload for later comparison.
 *
 * @param delay - Delay in milliseconds to wait between checks.
 * @returns An object containing service/route IDs, worker info, and PIDs before reload.
 */
async function prepareGatewayReloadEnv(containerName: string, delay: number, dynamicPlaneCount?: boolean) {
  // Create a test service and route for later verification
  const service = await createGatewayService(`routerRebuild-${randomString()}`);
  const serviceId = service.id;
  const routePath = `/routerRebuild-${randomString()}`;
  const route = await createRouteForService(serviceId, [routePath]);
  const routeId = route.id;
  let cpuCoreCount: number;

  // Get the number of CPU cores and the expected number of worker processes
  const isMacOS = process.platform === 'darwin';
  let maxExpectedWorkerCount = 0;
  if (isMacOS) {
    cpuCoreCount = Number(await runSpawnCommand(`docker exec ${containerName} nproc`));
    const WORKER_MULTIPLIER = 2 ;
    maxExpectedWorkerCount = cpuCoreCount * WORKER_MULTIPLIER + 1;
    console.log(`[KongReload] Running on macOS, max expected workers: ${maxExpectedWorkerCount}`);
  } else {
    cpuCoreCount = Number(await runSpawnCommand('nproc'));
    if(dynamicPlaneCount){
    const WORKER_MULTIPLIER = 2 ;
    const cpNumber = Number(await runSpawnCommand(`docker ps --filter "name=${getKongContainerName()}" --format '{{.Names}}' | wc -l`));
    const dpNumber = Number(await runSpawnCommand(`docker ps --filter "name=kong-dp" --format '{{.Names}}' | wc -l`));
    maxExpectedWorkerCount = cpuCoreCount * WORKER_MULTIPLIER * (cpNumber + dpNumber) + 1;
    }
    else{
      const HYBRID_WORKER_MULTIPLIER = 4 ; // Assuming 1 DP and 1 CP 
      const CLASSIC_WORKER_MULTIPLIER = 2 ; // Only 1 CP 
      maxExpectedWorkerCount = isGwHybrid() ? cpuCoreCount * HYBRID_WORKER_MULTIPLIER + 1 : cpuCoreCount * CLASSIC_WORKER_MULTIPLIER +1; 
    }
    console.log(`[KongReload] Max expected workers: ${maxExpectedWorkerCount}`);
  }

  // Wait for worker process count to be in a safe range and capture PIDs before reload
  const workerPidsBeforeReload = await verifyWorkerProcessCount({
  containerName,
  cpuCoreCount,
  maxExpectedWorkerCount,
  delay
  });

  return { serviceId, routeId, routePath, cpuCoreCount, maxExpectedWorkerCount, workerPidsBeforeReload };
}


/**
 * Waits for Kong Gateway reload to complete and verifies the reload was successful.
 * 
 * This function performs a series of verification steps after a Kong Gateway reload:
 * 1. Verifies worker processes have been properly replaced (new workers spawned)
 * 2. Checks that worker count is within expected limits
 * 3. Waits for Kong Gateway to report ready status
 * 4. Verifies test routes remain active after reload
 * 5. Cleans up test resources (routes and services)
 * 
 * @param {Object} params - Function parameters
 * @param {string} [params.serviceId] - ID of the test service created before reload
 * @param {string} [params.routeId] - ID of the test route created before reload
 * @param {string} [params.routePath] - Path of the test route for verification
 * @param {number} params.cpuCoreCount - Number of CPU cores in the system
 * @param {number} params.maxExpectedWorkerCount - Maximum expected worker processes
 * @param {string} params.containerName - Name of the Kong Gateway container
 * @param {string[]} params.workerPidsBeforeReload - PIDs of worker processes before reload
 * @param {number} params.delay - Delay in milliseconds to use between verification attempts
 * 
 * @throws Will throw an error if verification steps fail
 */
async function waitForKongReloadComplete({
  serviceId,
  routeId,
  routePath,
  cpuCoreCount,
  maxExpectedWorkerCount,
  containerName,
  workerPidsBeforeReload,
  delay,
}: {
  serviceId?: string,
  routeId?: string,
  routePath?: string,
  cpuCoreCount: number,
  maxExpectedWorkerCount: number,
  containerName: string,
  workerPidsBeforeReload: string[],
  delay: number,
}) {
  console.log(`[KongReload] Waiting worker process count to be in a safe range after reload...`);
  //Wait for worker process count to be in a safe range
  await verifyWorkerProcessCount({
    containerName,
    cpuCoreCount,
    maxExpectedWorkerCount,
    delay,
    isAfterReload: true,
    workerPidsBeforeReload,
  });

  await wait(2000);// eslint-disable-line no-restricted-syntax

  console.log(`[KongReload] Waiting for Kong to be ready after reload...`);
  await waitForKongReady(containerName);

  // Check if the route is still active
  if (routePath) {
    const proxyUrl = `${getBasePath({ app: 'gateway', environment: Environment.gateway.proxy })}`;
    await eventually(async () => {
      const resp = await axios({
        method: 'get',
        url: `${proxyUrl}${routePath}`,
        validateStatus: null,
        headers: { Connection: 'close' }
      });
      expect(resp.status, `[KongReload] Route should be active, got status ${resp.status}`).to.equal(200);
    });
  }

  // Clean up
  try {
    if (routeId) await deleteGatewayRoute(routeId);
    if (serviceId) await deleteGatewayService(serviceId);
  } catch (e) {
    console.warn('[KongReload] Cleanup failed:', e);
  }

  console.log(`[KongReload] Kong has successfully reloaded.`);
}

/**
 * Create a list of variables from an object to pass to docker command
 */
export const createEnvVarList = (envVars: object) => {
  const newVars: string[] = [];
  for (const variable in envVars) {
    const modifiedVar = `-e ${variable}='${envVars[variable]}'`;
    newVars.push(modifiedVar);
  }
  return `"${newVars.join(' ')}"`;
}

/**
 * Sets Kong Gateway target container variables and restarts kong
 * @param {object} targetEnvironmentVariables - {KONG_PORTAL: 'on', KONG_VITALS: 'off'}
 * @param {string} containerName - target docker kong container name, default is 'kong-cp'
 */
export const resetGatewayContainerEnvVariable = async (
  targetEnvironmentVariables: object,
  containerName: string,
  dynamicPlaneCount = false, // if false, will use only 1 DP (kong-dp1) and 1 CP (kong-cp); if true, will use all kong-dp and kong-cp containers
) => {
  const isKongNative = isGwNative();
  const delay = isFipsMode() ? 2000 : 1000;
  let restartCommand: string;
  let serviceId: string | undefined,
    routeId: string | undefined,
    routePath: string | undefined,
    workerPidsBeforeReload: string[] = [],
    maxExpectedWorkerCount: any,
    cpuCoreCount: any;

  // Update env and reload/restart Kong
  const finalVars = createEnvVarList(targetEnvironmentVariables);

  // in FIPS mode, kong restart wipes credentials 
  if (isKongNative && !isFipsMode()) {
    restartCommand =
      containerName === 'kong-dp1'
        ? `kong restart -c kong-dp.conf`
        : `kong restart -c kong.conf`;
  } else {
    restartCommand = 'kong reload';
  }
  
  //If we are reloading Kong, we need to set up the environment first to verify the reload finishes correctly later
  if (restartCommand === 'kong reload') {
    ({
      serviceId,
      routeId,
      routePath,
      cpuCoreCount,
      maxExpectedWorkerCount,
      workerPidsBeforeReload
    } = await prepareGatewayReloadEnv(containerName, delay, dynamicPlaneCount));
  }

  try {
    const shellCommand = `kongVars=${finalVars} command="${restartCommand}" make gwContainerName=${containerName} update_kong_container_env_var`;
    await runSpawnCommand(shellCommand);
  } catch (err) {
    const msg = err instanceof Error
     ? `Failed to update container ${containerName} environment variables: ${err.message}`
     : `Unexpected error type when updating container ${containerName} environment variables`;
    throw new Error(msg);
  }

  // wait before test to prevent the case where we are checking before any worker exits
  await wait(2000); // eslint-disable-line no-restricted-syntax

  // Wait for Kong to finish reloading and verify
  if (restartCommand === 'kong reload') {
    await waitForKongReloadComplete({
      serviceId,
      routeId,
      routePath,
      cpuCoreCount,
      maxExpectedWorkerCount,
      containerName,
      workerPidsBeforeReload,
      delay,
    });
  } else {
    // For restart, just wait for Kong to be ready
    await waitForKongReady(containerName);
  }
};

/**
 * Reload gateway
 * @param {string} containerName - target docker kong container name, default is 'kong-cp'
 */
export const reloadGateway = (
  containerName: string = getKongContainerName()
) => {
  const command = 'kong reload'

  try {
    return execSync(
      `docker exec $(docker ps -aqf name=${containerName}) ${command}`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.log(
      `Something went wrong during reloading the gateway: ${error}`
    );
  }
};

/**
 * Filters multi-line log blocks by log level.
 *
 * @param logs - Full log content as a string, with '\n' as line separators.
 * @param logLevelFilter - Log level to filter by (e.g., 'error', 'warn', 'info'), without brackets.
 * @returns Filtered log blocks joined by double newlines.
 */
function filterLogsByLevel(logs: string, logLevelFilter: string): string {
  const lines = logs.split('\n');

  const isLogStart = (line: string) =>
    /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \[\w+\]/.test(line);

  const levelRegex = new RegExp(`\\[${logLevelFilter}\\]`, 'i');

  const resultBlocks: string[][] = [];

  let currentBlock: string[] = [];
  let isRelevant = false;

  for (const line of lines) {
    if (isLogStart(line)) {
      // Previous block ended, check if it is relevant
      if (currentBlock.length > 0 && isRelevant) {
        resultBlocks.push(currentBlock);
      }
      // Start a new block
      currentBlock = [line];
      isRelevant = levelRegex.test(line);
    } else {
      currentBlock.push(line);
      if (!isRelevant && levelRegex.test(line)) {
        isRelevant = true;
      }
    }
  }

  // Process the last block
  if (currentBlock.length > 0 && isRelevant) {
    resultBlocks.push(currentBlock);
  }

  return resultBlocks.map(block => block.join('\n')).join('\n\n');
}

/**
 * Reads given kong container logs
 * @param {string} containerName - target docker kong container name
 * @param {number} numberOfLinesToRead - the number of lines to read from logs
 * @param {string} [logLevelFilter] - (Optional) Log level to filter by, e.g. 'error', 'info', etc. (do NOT include brackets)
 */
export const getGatewayContainerLogs = (
  containerName,
  numberOfLinesToRead = 4,
  logLevelFilter?: string 
) => {
  const isKongNative = isGwNative();
  const logFile = path.resolve(process.cwd(), 'error.log');
  // using | cat as simple redirection like &> or >& doesn't work in CI Ubuntu
  const command = isKongNative
    ? `docker cp "${containerName}":/var/error.log ${logFile}`
    : `docker logs $(docker ps -aqf name="${containerName}") --tail ${numberOfLinesToRead} 2>&1 | cat > error.log`;

  try {
    execSync(command);
    let logs = execSync(`tail -n ${numberOfLinesToRead} ${logFile}`).toString();

    // If logLevelFilter is provided, filter the logs
    if (logLevelFilter) {
      logs = filterLogsByLevel(logs, logLevelFilter);
      if (logs.trim().length === 0) {
        console.log(`No logs found for log level [${logLevelFilter}].`);
      } else {
        console.log(`Printing current log slice of kong container (filtered by [${logLevelFilter}]):\n${logs}`);
      }
    } else {
      console.log(`Printing current log slice of kong container:\n${logs}`);
    }

    // remove logs file
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
      console.log(`\nSuccessfully removed target file: 'error.log'`);
    }

    return logs;
  } catch (error) {
    console.log('Something went wrong while reading the container logs');
  }
};

/**
 * Get the kong version from running docker container
 * @param {string} containerName
 * @returns {string}
 */
export const getKongVersionFromContainer = (containerName = 'kong-cp') => {
  const containers = execSync(`docker ps --format '{{.Names}}'`).toString();
  if (!containers.includes(containerName)) {
    throw new Error(
      `The docker container with name ${containerName} was not found`
    );
  }

  try {
    const version = execSync(
      `docker exec ${containerName} /bin/bash -c "kong version"`,
      { stdio: ['inherit', 'pipe', 'pipe'] }
    );

    return version.toString().trim();
  } catch (error) {
    throw new Error(
      `Something went wrong while getting kong container version: ${error}`
    );
  }
};

/**
 * Run start or stop command on a target container
 * @param {string} containerName - name of the container to start
 * @param {string} command - command to run, can be either stop or start
 */
export const runDockerContainerCommand = (containerName: string, command: string) => {
  const result = execSync(`docker ${command} ${containerName}`);
  return result.toString('utf-8');
};

/**
 * Run command within docker container
 * @param {string} containerName - name of the container to start
 * @param {string} command - command passing to docker exec to be run within the target container
 */
export const runCommandInDockerContainer = (containerName: string, command: string) => {
  const result = execSync(`docker exec ${containerName} ${command}`);
  return result.toString();
};

/**
 * Copy a file from target container
 * @param {string} containerName - name of the container to start
 * @param {string} fileName - the name of the target file
 */
export const copyFileFromDockerContainer = async (containerName: string, fileName: string) => {
  const cwd = path.resolve(process.cwd());
  try {
    await runSpawnCommand(`docker cp ${containerName}:/${fileName} ${cwd}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy file ${fileName} from container ${containerName}: ${errorMsg}`);
  }
};

/**
 * Check a file exist or not from target container
 * @param {string} containerName - name of the container to check file from
 * @param {string} fileName - the name of the target file
 * @param {boolean} exist - check this file exist or not, default value is true means default check this file exist
 */
export const checkFileExistsInDockerContainer = async(containerName: string, fileName: string, exist = true) => {
  await eventually(async () => {
    const checkResult = execSync(
      `docker exec -i $(docker ps -aqf name="${containerName}") sh -c "test -e ${fileName} && echo 'File exists' || echo 'File not found'"`
    );
    const resultString = checkResult.toString().trim();
    console.info(`Check target file ${fileName} in docker container: ${resultString}`);

    if (exist) {
      expect(resultString, 'The target file should exist in docker container').to.contain('File exists');
    } else {
      expect(resultString, 'Wait for log file not generating').to.contain('File not found');
    }
  });
};

/**
 * Delete a file from target container
 * @param {string} containerName - name of the container to to delete file from
 * @param {string} fileName - the name of the target file
 */
export const deleteFileFromDockerContainer = async(containerName: string, fileName: string) => {
  const fileNotFoundMessage = 'File not found'; // Constants for messages

  try {
    // Delete the file
    execSync(`docker exec -i $(docker ps -aqf name="${containerName}") sh -c "rm -f ${fileName}"`);

    // Check if the file still exists
    const checkResult = execSync(
      `docker exec -i $(docker ps -aqf name="${containerName}") sh -c "test -e ${fileName} && echo 'File exists' || echo '${fileNotFoundMessage}'"`
    ).toString().trim();

    if (checkResult.includes('File exists')) {
      console.info(`File delete failed: ${fileName}`);
    } else if (checkResult.includes(fileNotFoundMessage)) {
      console.info(`Successfully removed target file: ${fileName} from docker container`);
    } else {
      console.error(`Unexpected result from Docker check: ${checkResult}`);
    }
  } catch (error) {
    console.error(
      `Something went wrong during deleting the file from docker container: ${error}`
    );
  } 
};

/**
 * Create a file in the target container and change its ownership
 * @param {string} containerName - name of the container to to create file from
 * @param {string} fileName - the name of the target file
 * @param {boolean} changeOwnership - change the ownership of this file to kong, default is true
 */
export const createFileInDockerContainer = async(containerName: string, fileName: string, changeOwnership = true) => {
  try {
    // Create the file
    execSync(`docker exec -i $(docker ps -aqf name="${containerName}") sh -c "touch ${fileName}"`);

    // Optionally change ownership to 'kong'
    if (changeOwnership) {
      execSync(`docker exec -i $(docker ps -aqf name="${containerName}") sh -c "chown kong:kong ${fileName}"`);
      console.info(`Ownership of ${fileName} changed to kong:kong`);
    }

    console.info(`File created successfully: ${fileName} in docker container`);
  } catch (error) {
    console.error(`Error during file creation in docker container: ${error}`);
  }
};


/**
 * Generates code snippet and deploys a Konnect Data Plane via Docker in the same network as other test 3rd party services
 * @param {string} controlPlaneEndpoint - Konnect control_plane_endpoint
 * @param {string} telemetryEndpoint - Konnect telemetry_endpoint
 * @param {string} cert - the generated certificate file
 * @param {string} privateKey - the generated private key file
 * @param {string} gatewayDpImage - target gateway image for the data plane
 * @param {string} targetOS- Options are: 'docker' - default, macosintel, macosarm
 * @param {number} dataPlaneCount - number of data planes to deploy, default is 1
 */
export const deployKonnectDataPlane = (controlPlaneEndpoint, telemetryEndpoint, cert, privateKey, gatewayDpImage, targetOS = 'docker', dataPlaneCount = 1) => {
  let osConfig: string
  let dockerNetwork: string

  // Define Platform as in Konnect Platform dropdown menu
  if (targetOS === 'macosintel') {
    osConfig = 'macOsIntelOS'
  } else if (targetOS === 'macosarm') {
    osConfig = 'macOsArmOS'
  } else {
    osConfig = 'linuxdockerOS'
  }

  const staticInstructions = `-e "KONG_ROLE=data_plane" \
  -e "KONG_DATABASE=off" \
  -e "KONG_VITALS=off" \
  -e "KONG_CLUSTER_MTLS=pki" \
  -e "KONG_CLUSTER_CONTROL_PLANE=${controlPlaneEndpoint}:443" \
  -e "KONG_CLUSTER_SERVER_NAME=${controlPlaneEndpoint}" \
  -e "KONG_CLUSTER_TELEMETRY_ENDPOINT=${telemetryEndpoint}:443" \
  -e "KONG_CLUSTER_TELEMETRY_SERVER_NAME=${telemetryEndpoint}" \
  -e "KONG_CLUSTER_CERT=${cert}" \
  -e "KONG_CLUSTER_CERT_KEY=${privateKey}" \
  -e "KONG_LUA_SSL_TRUSTED_CERTIFICATE=system" \
  -e "KONG_KONNECT_MODE=on" \
  -e "KONG_CLUSTER_DP_LABELS=created-by:quickstart,type:docker-${osConfig}"`

  // if the target test network exists, create cdp container in that network
  try {
    execSync(`docker network ls | grep 'gateway-docker-compose-generator_kong-ee-net'`);
    dockerNetwork = '--net gateway-docker-compose-generator_kong-ee-net'
  } catch (error) {
    dockerNetwork = ''
  }

  for(let i = 1; i <= dataPlaneCount; i++) {
    const port1 = 8000 + (i-1) * 10
    const port2 = 8443 + (i-1) * 10

    const dpCodeSnippet = `docker run --name konnect-dp${i} ${dockerNetwork} -d \
    ${staticInstructions} \
    -p ${port1}:8000 \
    -p ${port2}:8443 \
    ${gatewayDpImage}`

    try {
      execSync(dpCodeSnippet, { stdio: 'inherit' });
      console.info(`Successfully deployed the Konnect data plane named: konnect-dp${i} \n`)
    } catch (error) {
      console.error('Something went wrong while deploying the Konnect data plane', error);
    }
  }
}

/**
 * Stops and removes the target container
 * @param {string} containerName 
 */
export const stopAndRemoveTargetContainer = (containerName) => {
  // if konnect-dp1 container exists
  const doesContainerExists = execSync(`docker ps -a -q -f name=${containerName}`).toString().trim()
  if (doesContainerExists) {
    try {
      execSync(`docker stop ${containerName}; docker rm ${containerName} -f`, { stdio: 'inherit' });
      console.info(`Successfully removed the ${containerName} docker container`)
    } catch (error) {
      console.error(`Something went wrong while removing the ${containerName} docker container`, error);
    }
  } else {
    console.info(`Target container ${containerName} doesn't exist, moving on with the rest of the test setup`)
  }
}

/**
 * Stops and removes a list of target containers
 * @param {string[]} containerNames Array of container names
 */
export const stopAndRemoveMultipleContainers = (containerNames: string[]) => {
  containerNames.forEach((containerName) => {
    stopAndRemoveTargetContainer(containerName);
  });
}

/**
 * Update single environment variable in the targe container
 * @param {string} containerName - name of the container to update
 * @param {object} envVars - the environment variables to update
 * 
 */
export const updateEnvVariableInContainer = (containerName: string, envVars: object) => {
  const finalVars = createEnvVarList(envVars)
  try {
    const output = execSync(
      `kongVars=${finalVars} command="kong reload" make gwContainerName=${containerName} update_kong_container_env_var`, 
    )
    expect(output).to.contain('Updating Kong container environment variable')
    
    return output.toString()
  }
  catch (error: any) {
    return error.toString()
  }
}

/**
 * run docker compose command against the docker-compose.yml file 
 * @param {string} command
 */
export const runDockerComposeCommand = (command) => {
  const dockerComposeCommand = `${isGwNative() ? '-f docker-compose-package.yml' : ''} ${command}`
  console.log(`Running docker compose command: ${dockerComposeCommand}`)

  try {
    return execSync(
      `command="${dockerComposeCommand}" make execute_docker_compose_command`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error(`Something went wrong while running the docker compose command: ${command} `, error);
    throw error;
  }
}

/**
 * modify lines in generated docker-compose.yml file with yq command 
 * @param {string} command 
 */
export const updateDockerComposeFile = (command) => {
  try {
    return execSync(
      `command='${command}' make update_generated_docker_compose_file`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.log(
      `Something went wrong while modifying docker-compose.yml with yq command: ${error}`
    );
  }
}


/**
 * Retrieves the Gateway IP of the Docker network used by Kong.
 * 
 * This IP can be used for IP-based access control, like the `sources` field in Kong Route configs.
 * 
 * @returns {Promise<string>} A Promise resolving to the Gateway IP string (e.g., "172.21.0.1").
 * @throws {Error} If the Docker inspect command fails or returns unexpected output.
 */
export const getDockerNetworkGatewayIP = async (): Promise<string> => {
  try {
    const networkName = 'gateway-docker-compose-generator_kong-ee-net'; // Defined in gateway-docker-compose-generator repo
    const shellCommand = `docker network inspect ${networkName} -f '{{(index .IPAM.Config 0).Gateway}}'`;
    const ip = await runSpawnCommand(shellCommand);
    return ip.trim();
  } catch (err) {
    if (err instanceof Error) {
      err.message = `Failed to get Docker network gateway IP: ${err.message}`;
      throw err;
    }
    throw new Error('Non-Error thrown — expected an Error object during Docker network gateway IP fetch');
  }
};

/**
 * Retrieves the IP address of a Docker container.
 * 
 * The returned IP can be used for IP restrictions, such as the `destinations` field in Kong Route configs.
 *
 * @param {string} containerName - Name or ID of the container.
 * @returns {Promise<string>} A Promise resolving to the container's IP address as a string.
 * @throws {Error} If the Docker command fails or container is not found.
 */
export const getDockerContainerIP = async (containerName: string): Promise<string> => {
  try {
    const shellCommand =  `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${containerName}`;
    const ip = await runSpawnCommand(shellCommand);
    return ip.trim();
  } catch (err) {
    if (err instanceof Error) {
      err.message = `Failed to get Docker container IP: ${err.message}`;
      throw err;
    }
    throw new Error('Non-Error thrown — expected an Error object during Docker container IP fetch');
  }
};

/**
 * Checks if a container with the specified image is currently running
 * @param {string} imageName - Name of the Docker image to check
 * @returns {Promise<boolean>} - Returns true if a container using this image is running
 * @throws {Error} If the Docker command fails or running container is not found.
 */
export const isContainerRunningByImage = async (imageName: string): Promise<boolean> => {
  try {
    const shellCommand = `docker ps --filter "ancestor=${imageName}" --format "{{.ID}}"`;
    const output = await runSpawnCommand(shellCommand);
    return output.length > 0;  // Now correctly returns a boolean
  } catch (err) {
    if (err instanceof Error) {
      err.message = `Failed to check running container status for image (${imageName}): ${err.message}`;
      throw err;
    }
    throw new Error('Non-Error thrown — expected an Error object while checking Docker container status');
  }
};

/**
 * Checks if a container with the specified container name is currently running
 * @param {string} containerName - Name of the Docker container to check
 * @returns {Promise<boolean>} - Returns true if a container using this name is running
 * @throws {Error} If the Docker command fails or running container is not found.
 */
export const isContainerRunningByName = async (containerName: string): Promise<boolean> => {
  try {
    const shellCommand = `docker ps --filter "name=${containerName}" --format "{{.ID}}"`;
    const output = await runSpawnCommand(shellCommand);
    return output.length > 0;  // Now correctly returns a boolean
  } catch (err) {
    if (err instanceof Error) {
      err.message = `Failed to check running container status for container (${containerName}): ${err.message}`;
      throw err;
    }
    throw new Error('Non-Error thrown — expected an Error object while checking Docker container status');
  }
};

/**
 * Checks if a container for the specified service name is currently running, if not it
 * starts the container and run assertions when provided to verify it is healthy
 * @param {string} ServiceName - Name of the Docker service to check and start if not running
 * @param {Function} assertions - Async function containing assertions to verify the container started correctly (optional)
 * @returns {Promise<void>} - Resolves when the service container is confirmed running and assertions (if any) pass
 * @throws {Error} If the Docker command fails or starting the container fails.
 */
export const checkOrStartServiceContainer = async <T = void>(
  serviceName: string,
  assertions?: () => Promise<T>
) => {
  try {
    // Check if the target container is running, if not, start it
  const isServiceRunning = await isContainerRunningByName(serviceName);

  if (!isServiceRunning) {
    // Start container
    const command = `--profile manual up -d ${serviceName}`;
    runDockerComposeCommand(command);
    // run assertions if provided
    if (assertions) {
      await eventually(async () => {
        await assertions();
      });
    }
  }  
  } catch (error) {
    throw new Error(`Error in checkOrStartServiceContainer for ${serviceName}: ${error}`);
  }
};

/**
 * Checks if a container is running and stops and removes it if so.
 * @param {string} containerName - Name of the Docker container to check
 * @returns {Promise<void>} - Resolves when the container is confirmed stopped
 * @throws {Error} If the Docker command fails or stopping the container fails.
 */
export const stopContainerByName = async (containerName: string) => {
  try {
    runDockerComposeCommand(`rm -sf ${containerName}`);
    await eventually(async () => {
      const isContainerRunning = await isContainerRunningByName(containerName);
      expect(isContainerRunning, `Container ${containerName} should be stopped`).to.equal(false);
    });
  } catch (error) {
    throw new Error(`Error in stopContainerByName for ${containerName}: ${error}`);
  }
};