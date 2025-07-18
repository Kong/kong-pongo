import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getKongContainerName, isGwNative, isFipsMode } from 'support/config/gateway-vars';
import axios from 'axios';
import { expect } from 'chai';
import { eventually, getGatewayBasePath, runSpawnCommand } from 'support';
import { wait } from 'support/utilities/random';

/**
 * Create a list of variables from an object to pass to docker command
 */
export const createEnvVarList = (envVars: object) => {
  const newVars: any = [];
  for (const variable in envVars) {
    const modifiedVar = `-e ${variable}=${envVars[variable]}`;
    newVars.push(modifiedVar);
  }
  return newVars.join(' ');
}

/**
 * Sets Kong Gateway target container variables and restarts kong
 * @param {object} targetEnvironmentVariables - {KONG_PORTAL: 'on', KONG_VITALS: 'off'}
 * @param {string} containerName - target docker kong container name, default is 'kong-cp'
 */
export const resetGatewayContainerEnvVariable = async (
  targetEnvironmentVariables: object,
  containerName: string
) => {
  const isKongNative = isGwNative();
  let restartCommand;

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
  
  try {
    const shellCommand = `kongVars="${finalVars}" command="${restartCommand}" make gwContainerName=${containerName} update_kong_container_env_var`;
    await runSpawnCommand(shellCommand);
  } catch (err) {
    if (err instanceof Error) {
      err.message = `Something went wrong during updating the container environment variable: ${err}`;
      throw err;
    }
    throw new Error('Unexpected non-Error type thrown');
  }

  // wait before test to prevent the case where we are checking before any worker exits
  await wait(5000); // eslint-disable-line no-restricted-syntax

  await eventually(async () => {
    const base_url = containerName === 'kong-dp1' ? getGatewayBasePath('statusDP') : getGatewayBasePath('status')
    const resp = await axios.get(`${base_url}/status/ready`)

    expect(resp.status, 'Kong Gateway timed out, restarting').to.equal(200)
    expect(resp.data.message, 'Message should be ready').to.equal('ready')
  });

  if (isFipsMode()) {
     await wait(5000); // eslint-disable-line no-restricted-syntax
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
      const levelRegex = new RegExp(`\\[${logLevelFilter}\\]`, 'i');
      logs = logs
        .split('\n')
        .filter(line => levelRegex.test(line))
        .join('\n');
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
export const runDockerContainerCommand = async (containerName, command) => {
  const result = await execSync(`docker ${command} ${containerName}`);
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
export const copyFileFromDockerContainer = (containerName, fileName) => {
  const cwd = path.resolve(process.cwd());
  execSync(`docker cp ${containerName}:/${fileName} ${cwd}`);
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
      `kongVars="${finalVars}" command="kong reload" make gwContainerName=${containerName} update_kong_container_env_var`, 
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
  try {
    return execSync(
      `command="${command}" make execute_docker_compose_command`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error(`Something went wrong while running the docker compose command: ${command} `, error);
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