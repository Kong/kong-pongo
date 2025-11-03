import { createClient, createCluster } from 'redis';
import { expect } from '../assert/chai-expect';
import { Environment, getBasePath, isGateway } from '../config/environment';
import { wait, findRegex } from './random';
import { eventually } from './eventually';
import { getGatewayContainerLogs } from '../exec/gateway-container';
import { logDebug } from './logging';

const redisUser = 'redisuser';
const redisPassword = 'redispassword';
const redisCluster = {
  node1: {
    host: 'rc-node-1',
    port: 6379,
    extPort: 9080,
  },
  node2: {
    host: 'rc-node-2',
    port: 6379,
    extPort: 9081,
  },
  node3: {
    host: 'rc-node-3',
    port: 6379,
    extPort: 9082,
  },
}

export let valkeyClient: any;
export let redisClient: any;
export let redisClusterClient: any;

export const createRedisClient = () => {
  const host = getBasePath({ environment: isGateway() ? Environment.gateway.hostName : undefined });
  const redisConnectUrl = `redis://${redisUser}:${redisPassword}@${host}:6379`;
  redisClient = createClient({ url: redisConnectUrl });
};

export const createValkeyClient = () => {
  const host = getBasePath({ environment: isGateway() ? Environment.gateway.hostName : undefined });
  const valkeyConnectUrl = `redis://${redisUser}:${redisPassword}@${host}:6389`;
  valkeyClient = createClient({ url: valkeyConnectUrl });
};

/**
 * Gets target redis database key metadata
 * @param {string} key - redis database key
 */
export const getTargetKeyData = async (key: any) => {
  const rawKeyDetails = await redisClient.hGetAll(key);
  const keyDetails = Object.entries(rawKeyDetails)[0];

  return { entryCount: keyDetails[1], host: keyDetails[0] };
};

/**
 * Gets Redis database size
 * @param {object} options 
 *    - options.expectedSize: 2 - to specify target size of DB
 *    - options.isValkey: true - to specify if the Valkey client should be used. Default is false
 * @returns {number} - DBSize of redis
 */
export const getDbSize = async (options: any = {}) => {
  let dbSize = options?.isValkey === true ? await valkeyClient.DBSIZE() : await redisClient.DBSIZE();

  if (options?.expectedSize !== dbSize) {
    console.log(
      `Getting redis db size one more time as previous one was non-expected: ${dbSize}`
    );
    await wait(4000); // eslint-disable-line no-restricted-syntax
    dbSize = options?.isValkey === true ? await valkeyClient.DBSIZE() : await redisClient.DBSIZE();
  }

  return dbSize;
};

/**
 * Checks if the Redis database size matches an expected size.
 *
 * This function retrieves the current Redis database size and compares
 * it to an expected size. It throws an error if the sizes do not match.
 *
 * @param {number} expectedSize - The expected size of the Redis database.
 * @param {boolean} [isValkey=false] - Whether to check the Valkey or Redis database.
 * @throws Will throw an error if the database size does not match `expectedSize`.
 */
export const checkRedisDBSize = async (expectedSize: number, isValkey = false) => {
  const dbSize = await getDbSize({ expectedSize: expectedSize, isValkey: isValkey });
  expect(dbSize, `Redis DB size should be ${expectedSize}`).equal(expectedSize);
}

/**
 * Waits until the Redis database size reaches an expected size or times out.
 *
 * This function periodically checks the Redis database size, waiting for it
 * to match the expected size within the specified timeout and interval. It
 * supports optional verbosity for logging.
 *
 * @param {number} expectedSize - The expected size of the Redis database.
 * @param {number} [timeout] - The maximum time to wait (in ms) before timing out.
 * @param {number} [interval] - The interval (in ms) between size checks.
 * @param {boolean} [verbose] - Whether to log additional details.
 * @returns {Promise<void>} Resolves when the database size matches `expectedSize`.
 * @throws Will throw an error if the database size does not match `expectedSize` within the timeout.
 */
export const waitForRedisDBSize = async (
  expectedSize: number,
  timeout?: number,
  interval?: number,
  verbose?: boolean,
  isValkey = false
): Promise<void> => {
  await eventually(
    () => checkRedisDBSize(expectedSize, isValkey),
    timeout,
    interval,
    verbose
  );
};

/**
 * Define Redis Cluster node external and internal address mapping according to the setup in gateway-docker-compose-generator repository
 */
export const getClusterConfiguration = () => {
  const host = getBasePath({ environment: isGateway() ? Environment.gateway.hostName : undefined });
  const rootNodes = [
    { url: `redis://${host}:${redisCluster.node1.extPort}` },
    { url: `redis://${host}:${redisCluster.node2.extPort}` },
    { url: `redis://${host}:${redisCluster.node3.extPort}` },
  ];

  const nodeAddressMap = {
    [`${redisCluster.node1.host}:${redisCluster.node1.port}`]: { host: host, port: 9080 },
    [`${redisCluster.node2.host}:${redisCluster.node2.port}`]: { host: host, port: 9081 },
    [`${redisCluster.node3.host}:${redisCluster.node3.port}`]: { host: host, port: 9082 },
  };

  return { rootNodes, nodeAddressMap };
};

/**
 * Connect Redis Cluster according to cluster configuration
 */
export const createRedisClusterClient = () => {
  const { rootNodes, nodeAddressMap } = getClusterConfiguration();

  redisClusterClient = createCluster({
    rootNodes,
    nodeAddressMap,
    defaults: {
      password: redisPassword,
    },
  });

  redisClusterClient.on('error', (err) => console.error('Redis Cluster Client Error', err));
};

/**
 * Gets Redis DB size from each individual node in the cluster.
 */
export const getClusterDbSizes = async () => {
  const nodeClients = redisClusterClient.nodeByAddress; // Get all node clients
  const dbSizes: Record<string, number> = {}; // Object to store sizes per node

  for (const [address, node] of nodeClients.entries()) {
    try {
      const client = node.client; // Access the RedisClient instance
      if (!client) {
        console.error(`No client found for node: ${address}`);
        dbSizes[address] = 0; // Default to 0 if no client is found
        continue;
      }

      let cursor = '0'; // Cursor for Redis SCAN command, starts at '0' to begin scanning keys. 
      // Redis returns a new cursor in each response to indicate the next position.
      // When the cursor becomes '0' again, it means the scan is complete.
      let nodeSize = 0; // Size for this specific node
      const maxIterations = 1000;
      let iteration = 0;
      do {
        const response = await client.sendCommand(['SCAN', cursor, 'COUNT', '1000']);
        if (!response || response.length < 2) {
          console.error(`Invalid response from SCAN on ${address}:`, response);
          break;
        }

        const [nextCursor, keys] = response;
        console.log(`Keys on node ${address}:`, keys); // Log keys being scanned
        nodeSize += keys.length;
        cursor = nextCursor;
        iteration++;
        if (iteration > maxIterations) {
          throw new Error(`SCAN loop exceeded max iterations (${maxIterations}) for node ${address}`);
        }
      } while (cursor !== '0');

      dbSizes[address] = nodeSize; // Store the size for this node
    } catch (err) {
      console.error(`Failed to scan keys from ${address}`, err);
      dbSizes[address] = 0; // Default to 0 in case of an error
    }
  }

  console.log(`DB sizes per node:`, dbSizes);
  return dbSizes; // Return the object with sizes per node
};

/**
 * Waits until the total Redis Cluster database size reaches an expected size or times out.
 *
 * This function periodically checks the total size of all nodes in the Redis Cluster,
 * waiting for it to match the expected size within the specified timeout and interval.
 * It supports optional verbosity for logging.
 *
 * @param {number} expectedTotalSize - The expected total number of keys across the cluster.
 * @param {number} [timeout] - The maximum time to wait (in ms) before timing out.
 * @param {number} [interval] - The interval (in ms) between size checks.
 * @param {boolean} [verbose] - Whether to log additional details.
 * @returns {Promise<void>} Resolves when the total cluster size matches `expectedTotalSize`.
 * @throws Will throw an error if the total size does not match `expectedTotalSize` within the timeout.
 */
export const waitForRedisClusterDBSize = async (
  expectedTotalSize: number,
  timeout?: number,
  interval?: number,
  verbose?: boolean
): Promise<void> => {
  await eventually(
    async () => {
      const dbSizes = await getClusterDbSizes();
      const totalSize = Object.values(dbSizes).reduce((sum, size) => sum + size, 0);
      if (verbose) {
        console.log(`Current Redis Cluster DB size: ${totalSize} (Expected: ${expectedTotalSize})`, dbSizes);
      }
      expect(
        totalSize,
        `Redis cluster DB size should match the expected size. Current: ${totalSize}, Expected: ${expectedTotalSize}`
      ).to.equal(expectedTotalSize);
    },
    timeout,
    interval,
    verbose
  );
};

/**
 * Robustly cleans up all keys from all Redis cluster nodes.
 * Retries up to 4 times if keys remain after flush, with interval and max timeout.
 *
 * @param {number} [maxRetries=4] - Maximum number of flush attempts.
 * @param {number} [interval=2000] - Interval in ms between retries.
 * @param {number} [maxTimeout=15000] - Maximum total timeout in ms.
 * @returns {Promise<void>}
 */
export const resetRedisCluster = async (
  maxRetries = 4,
  interval = 2000,
  maxTimeout = 15000
): Promise<void> => {
  const startTime = Date.now();
  let attempt = 0;

  while (attempt < maxRetries && (Date.now() - startTime) < maxTimeout) {
    attempt += 1;
    logDebug(`Redis cluster cleanup attempt ${attempt}...`);

    // Flush all nodes
    const nodeClients = redisClusterClient.nodeByAddress;
    for (const [address, node] of nodeClients.entries()) {
      try {
        if (!node.readonly) {
          const client = node.client;
          if (!client) {
            logDebug(`No client found for node: ${address}`);
            continue;
          }
          await client.sendCommand(['FLUSHALL']);
          logDebug(`Flushed all DB on ${address}`);
        }
      } catch (err) {
        logDebug(`Failed to flush DB on ${address}: ${err}`);
      }
    }

    // Check if any keys remain
    const dbSizes = await getClusterDbSizes();
    const totalSize = Object.values(dbSizes).reduce((sum, size) => sum + size, 0);
    logDebug(`After flush attempt ${attempt}, cluster DB sizes: ${JSON.stringify(dbSizes)}, total: ${totalSize}`);

    if (totalSize === 0) {
      logDebug('Redis cluster is fully cleaned up.');
      return;
    }

    // Wait before next attempt
    await wait(interval);// eslint-disable-line no-restricted-syntax
  }

  // Final check
  const finalDbSizes = await getClusterDbSizes();
  const finalTotal = Object.values(finalDbSizes).reduce((sum, size) => sum + size, 0);
  if (finalTotal !== 0) {
    throw new Error(`Redis cluster cleanup failed: ${finalTotal} keys remain after ${maxRetries} attempts. DB sizes: ${JSON.stringify(finalDbSizes)}`);
  }
  logDebug('Redis cluster cleanup completed after retries.');
};

/**
 * Gets all Redis database Keys
 * @returns {object} - redis database keys
 */
export const getAllKeys = async () => {
  const allKeys = await redisClient.sendCommand(['KEYS', '*']);

  return allKeys;
};

/**
 * Shuts down Redis service/container
 */
export const shutDownRedis = async () => {
  return redisClient.sendCommand(['shutdown']);
};

/**
 * Clears all entries from Redis database
 * @param {boolean} [isValkey=false] - Whether to reset the Valkey or Redis database.
 */
export const resetRedisDB = async (isValkey = false) => {
  return isValkey ? await valkeyClient.sendCommand(['flushdb']) : await redisClient.sendCommand(['flushdb']);
};

/**
 * Reusable assertion to check standardized redis configuration fields
 * @param {object} resp - axios admin api plugin response containg the redis fields
 */
export const expectRedisFieldsInPlugins = (resp, { includeRedisProxyType = true } = {}) => {
  const redisConfigurations = resp.config.redis

  const redisConfigKeys = [
    'ssl',
    'server_name',
    'sentinel_addresses',
    'sentinel_nodes',
    'password',
    'port',
    'ssl_verify',
    'connect_timeout',
    'send_timeout',
    'read_timeout',
    'host',
    'sentinel_password',
    'sentinel_username',
    'timeout',
    'cluster_addresses',
    'cluster_nodes',
    'cluster_max_redirections',
    'database',
    'keepalive_backlog',
    'keepalive_pool_size',
    'sentinel_role',
    'sentinel_master',
    'username',
    'connection_is_proxied',
    'redis_proxy_type'
  ]
  // If redis_proxy_type is not to be included, remove it from the validation keys
  const keysToCheck = includeRedisProxyType
    ? redisConfigKeys
    : redisConfigKeys.filter(key => key !== 'redis_proxy_type');

  expect(redisConfigurations, 'Should have redis object in plugin response').to.be.a(
    'object'
  );
  expect(Object.keys(redisConfigurations), 'Should have correct number of redis configurations').to.have.lengthOf(keysToCheck.length);
  expect(redisConfigurations, 'Plugin should have correct redis configuration fields').to.have.keys(keysToCheck);

  const stringValueKeys = ['server_name', 'sentinel_addresses', 'password', 'host', 'sentinel_password', 'sentinel_username', 'cluster_addresses', 'sentinel_role', 'sentinel_master', 'username'];
  const numberValueKeys = ['port', 'connect_timeout', 'send_timeout', 'read_timeout', 'timeout', 'database', 'keepalive_backlog', 'keepalive_pool_size'];
  const booleanValueKeys = ['ssl', 'ssl_verify'];

  stringValueKeys.forEach((key) => {
    if (redisConfigurations[key] !== null) {
      expect(redisConfigurations[key], `${key} should be a string`).to.be.a('string');
    }
  });

  numberValueKeys.forEach((key) => {
    if (redisConfigurations[key] !== null) {
      expect(redisConfigurations[key], `${key} should be a number`).to.be.a('number');
    }
  });

  booleanValueKeys.forEach((key) => {
    if (redisConfigurations[key] !== null) {
      expect(redisConfigurations[key], `${key} should be a boolean`).to.be.a('boolean');
    }
  });
}

/**
 * Checks the Redis entries to validate the count, host, and optional namespace.
 *
 * @param {string} params.expectedEntryCount - Expected count of entries in the target Redis key.
 * @param {string} params.expectedHost - Expected host value in the Redis key data.
 * @param {string} [params.expectedNamespace] - Optional namespace that should be included in the key.
 * @param {number} [params.allKeysLength] - Expected length of all Redis keys.
 * @param {number} [params.keyName] - Index of the target key in the allKeys array.
 * @returns {Promise<void>} Resolves if all checks pass, otherwise throws an error.
 */

export const checkRedisEntries = async ({
  expectedEntryCount, // Now an array of strings
  expectedHost,
  expectedNamespace,
  allKeysLength,
  keyName,
}: {
  expectedEntryCount: string[]; // Changed to string[]
  expectedHost: string;
  expectedNamespace?: string;
  allKeysLength?: number;
  keyName?: string;
}): Promise<void> => {
  const allKeys: any = await getAllKeys();

  if (typeof allKeysLength !== 'undefined') {
    expect(allKeys.length, `All Keys store in Redis should have size ${allKeysLength}`).to.equal(allKeysLength);
  }

  const safeKeyName = (typeof keyName !== 'undefined') ? keyName : allKeys[0];

  if (expectedNamespace) {
    expect(safeKeyName, `Key should include namespace ${expectedNamespace}`).to.include(expectedNamespace);
  }

  const { entryCount, host } = await getTargetKeyData(safeKeyName);
  const entryCountStr = entryCount as string; // Type assertion

  // Allow check multiple expected value ['a','b'] a or b as expected entry count to handle edge cases
  expect(expectedEntryCount.includes(entryCountStr), `Should see one of the expected entry counts [${expectedEntryCount.join(", ")}] in redis key for the expected requests`).to.be.true;

  expect(host, 'Should have host as header value').to.equal(expectedHost);
};

/**
 * Checks if a Redis connection error log exists for a specified namespace.
 *
 * This function searches the logs of the specified container for a Redis
 * connection error log pattern. It then checks if the presence of this
 * log matches the expected existence state.
 *
 * @async
 * @param {string} namespace - The namespace to check in the log.
 * @param {boolean} isExist - Whether the error log should exist (true) or not (false).
 * @throws Will throw an error if the log existence does not match `isExist`.
 */
export const checkRedisConnectErrLog = async (namespace: string, containerName: string, isExist: boolean) => {
  await eventually(async () => {
    const currentLogs = await getGatewayContainerLogs(containerName, 5);
    const logPattern = `\\[rate-limiting-advanced\\] error in fetching counters for namespace ${namespace}: failed to connect to redis: connection refused`;
    const isLogFound = findRegex(logPattern, currentLogs);

    expect(
      isLogFound,
      `Redis connection error log for namespace '${namespace}' should${isExist ? '' : ' not'} exist`
    ).to.equal(isExist);
  });
}

/**
 * Checks if a Redis username or password error log exists for a specified namespace.
 *
 * This function searches the logs of the specified container for a Redis
 * username or password error pattern. It then checks if the presence of this
 * log matches the expected existence state.
 *
 * @async
 * @param {string} namespace - The namespace to check in the log.
 * @param {boolean} isExist - Whether the error log should exist (true) or not (false).
 * @throws Will throw an error if the log existence does not match `isExist`.
 */
export const checkRedisAuthErrLog = async (namespace: string, containerName: string, isExist: boolean, logSpan?: number) => {
  await eventually(async () => {
    const linesToRead = logSpan ?? 5; // Default to 5 lines if not provided
    const currentLogs = await getGatewayContainerLogs(containerName, linesToRead, 'error');
    const logPattern = new RegExp(`\\[rate-limiting-advanced\\].* namespace ${namespace}:.*WRONGPASS invalid username-password pair`);
    const isLogFound = findRegex(logPattern, currentLogs);

    expect(
      isLogFound,
      `Redis auth error log for namespace '${namespace}' should${isExist ? '' : ' not'} exist`
    ).to.equal(isExist);
  });
}

/**
 * Gets all keys from Redis cluster that match a partial string pattern
 * @param {string} partialKey - Partial string to match in key names
 * @returns {Promise<Array>} Array of matching keys with their node information
 */
export const getClusterKeysMatching = async (partialKey: string) => {
  const nodeClients = redisClusterClient.nodeByAddress;
  const matchingKeys: Array<{
    key: string;
    node: string;
    type: string;
    hashContents?: Record<string, string>;
  }> = [];

  for (const [address, node] of nodeClients.entries()) {
    try {
      const client = node.client;
      if (!client) {
        console.error(`No client found for node: ${address}`);
        continue;
      }
      
      let cursor = '0';
      const maxIterations = 1000;
      let iteration = 0;
      do {
        const response = await client.sendCommand(['SCAN', cursor, 'MATCH', `*${partialKey}*`, 'COUNT', '100']);
        
        if (!response || response.length < 2) {
          console.error(`Invalid response from SCAN on ${address}:`, response);
          break;
        }
        iteration++;
        
        const [nextCursor, keys] = response;
        // Get details for each matching key
        for (const key of keys) {
          try {
            const keyType = await client.sendCommand(['TYPE', key]);

            const keyInfo: any = {
              key,
              node: address,
              type: keyType,
            };

            // If it's a hash, get the hash contents
            if (keyType === 'hash') {
              const hashContents = await client.sendCommand(['HGETALL', key]);
              // Convert array response to object
              const hashObj: Record<string, string> = {};
              for (let i = 0; i < hashContents.length; i += 2) {
                hashObj[hashContents[i]] = hashContents[i + 1];
              }
              keyInfo.hashContents = hashObj;
            } else if (keyType === 'string') {
              keyInfo.value = await client.sendCommand(['GET', key]);
            }

            matchingKeys.push(keyInfo);
          } catch (err) {
            console.error(`Error getting details for key ${key} on ${address}:`, err);
          }
        }
        
        if (iteration > maxIterations) {
          throw new Error(`SCAN loop exceeded max iterations (${maxIterations}) for node ${address}`);
        }

        cursor = nextCursor;
      } while (cursor !== '0');
    } catch (err) {
      console.error(`Failed to scan keys from ${address}`, err);
    }
  }

  // Log summary of all matching keys found
  if (matchingKeys.length > 0) {
    logDebug(`Total ${matchingKeys.length} matching keys found for pattern '${partialKey}':`);
    matchingKeys.forEach((keyInfo, index) => {
      logDebug(`  ${index + 1}. ${keyInfo.key} (node: ${keyInfo.node}, type: ${keyInfo.type})`);
    });
  } else {
    logDebug(`No keys found matching pattern '${partialKey}'`);
  }

  return matchingKeys;
};

/**
 * Checks if a specific hash field exists in any Redis cluster key matching the partial string
 * @param {string} partialKey - Partial string to match in key names
 * @param {string} hashField - Hash field to look for
 * @returns {Promise<boolean>} True if hash field exists, false otherwise
 */
export const checkClusterHashFieldExists = async (partialKey: string, hashField: string): Promise<boolean> => {
  const matchingKeys = await getClusterKeysMatching(partialKey);
  if (matchingKeys.length > 0) {
    for (const keyInfo of matchingKeys) {
      if (keyInfo.type === 'hash' && keyInfo.hashContents) {
        if (hashField in keyInfo.hashContents) {
          return true;
        }
      }
    }
    return false;
  } else {
    logDebug(`No keys found matching partial key: ${partialKey}`);
    return false;
  }
};


/**
 * Waits until a specific hash field exists in Redis cluster with expected value
 * @param {string} partialKey - Partial string to match in key names
 * @param {string} hashField - Hash field to check
 * @param {number} [timeout] - Maximum time to wait in milliseconds
 * @param {number} [interval] - Check interval in milliseconds
 * @param {boolean} [verbose] - Whether to log progress
 * @returns {Promise<void>} Resolves when condition is met
 */
export const waitForClusterHashField = async (
  partialKey: string,
  hashField: string,
  timeout?: number,
  interval?: number,
  verbose?: boolean
): Promise<void> => {
  await eventually(
    async () => {
      const exists = await checkClusterHashFieldExists(partialKey, hashField);
      if (verbose) {
        console.log(`Checking if hash field '${hashField}' exists in keys matching '${partialKey}': ${exists}`);
      }
      expect(
        exists,
        `Hash field '${hashField}' should exist in keys matching '${partialKey}'`
      ).to.be.true;
    },
    timeout,
    interval,
    verbose
  );
};

/**
 * Validates the response for linked plugins in Redis partial configurations.
 * API endpoint: `/workspaces/{workspace}/partials/{partialId}/links`
 * This function checks if the response contains the expected linked plugins, ensuring that:
 * - The response has the correct structure (e.g., `data` array and `count` property).
 * - The number of linked plugins matches the expected count.
 * - At least one linked plugins matches the expected ID and name.
 *
 * @param {any} responseData - The response data to validate.
 * @param {string} expectedId - The expected ID of a linked plugin.
 * @param {string} expectedName - The expected name of a linked plugin.
 * @param {number} expectedCount - The expected number of linked plugins.
 */
export const validateLinkedEntitiesResponse = (
  responseData: any,
  {
    expectedId,
    expectedName,
    expectedCount,
  }: {
    expectedId: string;
    expectedName: string;
    expectedCount: number;
  }
) => {
  // Check top-level structure
  expect(responseData).to.have.property('data').that.is.an('array');
  expect(responseData).to.have.property('count').that.is.a('number');

  const actualCount = responseData.count;
  const actualData = responseData.data;

  // Verify count matches the array length and expected value
  expect(actualData, 'data should be an array').to.have.lengthOf(expectedCount);
  expect(actualCount, 'count should match length of data').to.equal(expectedCount);

  // Verify one of the items matches expected ID and name
  const found = actualData.some((item: any) => {
    return item.id === expectedId && item.name === expectedName;
  });

  expect(found, `Should find item with id=${expectedId} and name=${expectedName}`).to.be.true;
}

export const validateRedisClusterConfig = (actualConfig: any, expectedConfig: any) => {
  // Validate cluster_nodes: at least one node should match structure & not be empty
  expect(actualConfig.cluster_nodes, 'cluster_nodes should be a non-empty array')
    .to.be.an('array')
    .that.is.not.empty;

  const hasValidNode = actualConfig.cluster_nodes.some((node: any) => {
    return (
      typeof node === 'object' &&
      typeof node.ip === 'string' &&
      node.ip.trim() !== '' &&
      typeof node.port === 'number'
    );
  });

  expect(
    hasValidNode,
    'At least one cluster_node should match expected structure with non-empty values'
  ).to.be.true;

  // Common fields to validate exact match
  const fieldsToCheck = [
    'cluster_max_redirections',
    'password',
    'connection_is_proxied',
    'keepalive_backlog',
    'keepalive_pool_size',
    'database',
    'ssl_verify',
    'ssl',
    'connect_timeout',
    'send_timeout',
    'read_timeout',
  ];

  for (const field of fieldsToCheck) {
    expect(
      actualConfig[field],
      `config.${field} should match`
    ).to.equal(expectedConfig[field]);
  }
}

export const validateRedisStandaloneConfig = (actualConfig: any, expectedConfig: any) => {
  // Basic required properties
  expect(actualConfig, 'config should be an object').to.be.an('object');

  const requiredFields = [
    'host',
    'port',
    'username',
    'password',
    'connection_is_proxied',
    'keepalive_backlog',
    'keepalive_pool_size',
    'ssl_verify',
    'ssl',
    'database',
    'connect_timeout',
    'send_timeout',
    'read_timeout',
  ];

  for (const field of requiredFields) {
    expect(
      actualConfig[field],
      `config.${field} should match`
    ).to.equal(expectedConfig[field]);
  }

  // Optional: Additional structure checks
  expect(actualConfig.host, 'host should be a non-empty string')
    .to.be.a('string')
    .that.is.not.empty;

  expect(actualConfig.port, 'port should be a number').to.be.a('number');

  if (actualConfig.username !== undefined) {
    expect(actualConfig.username, 'username should be a string').to.be.a('string');
  }

  expect(actualConfig.password, 'password should be a string').to.be.a('string');
}

export const validateRedisSentinelConfig = (actualConfig: any, expectedConfig: any) => {
  // Validate sentinel_nodes: at least one node should match structure & not be empty
  expect(actualConfig.sentinel_nodes, 'sentinel_nodes should be a non-empty array')
    .to.be.an('array')
    .that.is.not.empty;

  const hasValidSentinelNode = actualConfig.sentinel_nodes.some((node: any) => {
    return (
      typeof node === 'object' &&
      typeof node.host === 'string' &&
      node.host.trim() !== '' &&
      typeof node.port === 'number'
    );
  });

  expect(
    hasValidSentinelNode,
    'At least one sentinel_node should match expected structure with non-empty values'
  ).to.be.true;

  // Fields to check exact match (excluding sentinel_nodes)
  const fieldsToCheck = [
    'sentinel_master',
    'sentinel_username',
    'sentinel_password',
    'username',
    'sentinel_role',
    'password',
    'ssl',
    'ssl_verify',
    'database',
    'connect_timeout',
    'send_timeout',
    'read_timeout',
    'keepalive_pool_size',
    'keepalive_backlog',
  ];

  for (const field of fieldsToCheck) {
    expect(
      actualConfig[field],
      `config.${field} should match`
    ).to.equal(expectedConfig[field]);
  }
}
