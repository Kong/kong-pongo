import { constants } from './constants';
import { execSync } from 'child_process';
import { Environment, getBasePath, isKoko } from './environment';
import axios from 'axios';

const getUrl = (endpoint = '') => {
  const basePath = getBasePath({
    environment: Environment.gateway.admin,
  });

  return `${basePath}/${endpoint}`;
};

export const vars = {
  aws: {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY
  },
  cognito: {
    AWS_COGNITO_CLIENT_SECRET: process.env.AWS_COGNITO_CLIENT_SECRET
  },
  azure: {
    AZURE_FUNCTION_KEY:  process.env.AZURE_FUNCTION_KEY
  },
  azure_ad: {
    AZURE_AD_CLIENT_SECRET: process.env.AZURE_AD_CLIENT_SECRET
  },
  app_dynamics: {
    APPD_PASSWORD: process.env.APPD_PASSWORD,
  },
  license: {
    KONG_LICENSE_DATA: process.env.KONG_LICENSE_DATA,
  },
  ai_providers: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    VERTEX_API_KEY: process.env.VERTEX_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    AZUREAI_API_KEY: process.env.AZUREAI_API_KEY,
    AZUREAI_REALTIME_API_KEY: process.env.AZUREAI_REALTIME_API_KEY,
  },
  datadog: {
    DATADOG_API_KEY: process.env.DATADOG_API_KEY
  },
  confluent: {
    CLUSTER_API_KEY: process.env.CONFLUENT_CLOUD_API_KEY,
    CLUSTER_API_SECRET: process.env.CONFLUENT_CLOUD_API_SECRET,
  }
};
/**
 * Check that all necessary environment variables are defined before test execution
 * @param {string} scope - narrow down the scope to a specific set of variables e.g. azure or aws
 */
export const checkGwVars = (scope) => {
  const missingVars: string[] = [];
  for (const envVar in vars[scope]) {
    if (!vars[scope][envVar]) {
      missingVars.push(envVar);
    }
  }
  if (missingVars.length > 0) {
    throw new Error(
      `required gateway environment secrets not found: ${missingVars.join(
        ', '
      )}`
    );
  }
};

/**
 * Get current gateway host
 * @returns {string} - current gateway host
 */
export const getGatewayHost = (): string => {
  return process.env.GW_HOST || 'localhost';
};

/**
 * Check if current database is running in local mode
 * @returns {boolean} - true if the database is running in local mode else false
 */
export const isLocalDatabase = (): boolean => {
  return process.env.PG_IAM_AUTH == 'true' ? false : true;
};

/**
 * Get current gateway mode
 * @returns {string} - current gateway mode
 */
export const getGatewayMode = (): string => {
  return process.env.GW_MODE || 'classic';
};

/**
 * Get a valid Kong EE License from environment variables
 * @returns {string} - gateway license
 */
export const getGatewayEELicense = (): string => {
  if (!isKoko()) {
    checkGwVars('license');
  }
  return process.env.KONG_LICENSE_DATA || '';
};

/**
 * Check if current gateway mode is hybrid
 * @returns {boolean} - true if gateway runs in hybrid mode else false
 */
export const isGwHybrid = (): boolean => {
  return getGatewayMode() === 'hybrid' ? true : false;
};

/**
 * Check if current gateway mode is db-less
 * @returns {boolean} - true if gateway runs in db-less mode else false
 */
export const isGwDbless = (): boolean => {
  return getGatewayMode() === 'db-less' ? true : false;
};

/**
 * Check if current gateway mode is OSS
 * @returns {boolean} - true if gateway runs in oss mode
 */
export const isKongOSS = (): boolean => {
  return process.env.IS_KONG_OSS === 'true' ? true : false;
};

/**
 * Check if gateway is installed natively (package tests)
 * @returns {boolean} - true if gateway is installed using a package
 */
export const isGwNative = (): boolean => {
  return process.env.KONG_PACKAGE ? true : false;
};

/**
 * Check if fips mode is enabled
 * @returns {boolean}
 */
export const isFipsMode = (): boolean => {
  return process.env.FIPS_MODE == 'on' ? true : false;
};

/**
 * Check if RUN_WEEKLY_TESTS environment variable is set to true
 * This is used to control test execution which we want to happen only once a week e.g. Confluent tests
 * @returns {boolean}
 */
export const isWeeklyRun = (): boolean => {
  return process.env.RUN_WEEKLY_TESTS === 'true' ? true : false;
};

/**
 * Check if tests are runing for custom plugins
 * @returns {string}
 */
export const isCustomPlugin = (): string => {
  return process.env.CUSTOM_PLUGIN ? process.env.CUSTOM_PLUGIN : 'false'
}

/**
 * Get running kong container name based on which test suite is running
 * @returns {string} - the name of the container
 */
export const getKongContainerName = (): string => {
  return process.env.KONG_PACKAGE ? process.env.KONG_PACKAGE : 'kong-cp';
};

/**
 * Get kong version
 * @returns {string} - the name of the container
 */
export const getKongVersion = (): string | undefined => {
  return process.env.KONG_VERSION;
};

/**
 * Get the target docker image for Konnect data plane, default is konnect-dp1
 * @returns {string}
 */
export const getDataPlaneDockerImage = (): string | undefined => {
  return process.env.KONNECT_DP_IMAGE ? process.env.KONNECT_DP_IMAGE : 'kong/kong-gateway-dev:nightly-ubuntu'
}

/**
 * Get the Control Pane Docker image name from GW_IMAGE
 * @returns {string}
 */
export const getControlPlaneDockerImage = (): string => {
  if(process.env.GW_IMAGE) {
    return process.env.GW_IMAGE 
  } else {
    try{
      return execSync(`docker ps --filter "name=kong-cp" --format '{{.Image}}'`).toString().trim();
    } catch(e) {
      console.error(`Error getting control plane docker image: ${e}`)
      return ''
    }
  }
}

/**
 * Checks if GATEWAY_PASSWORD env var is set to return respective Auth header key:value
 */
export const gatewayAuthHeader = () => {
  return {
    authHeaderKey: constants.gateway.ADMIN_AUTH_HEADER,
    authHeaderValue: constants.gateway.ADMIN_PASSWORD,
  };
};

/**
 * Get Incremental Sync configuration status
 * @returns {boolean} - true if incremental sync is enabled
 */
export const getIncrementalSyncStatus = async () => {
  const resp = await axios(getUrl(''));
  console.log(`Incremental Sync Status: ${resp.data.configuration.incremental_sync}`);
  return resp.data.configuration.incremental_sync;
};