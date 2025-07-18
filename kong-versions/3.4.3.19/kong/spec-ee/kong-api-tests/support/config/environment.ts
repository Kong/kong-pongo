import { getGatewayHost } from './gateway-vars';

/**
 * Enum of available apps
 */
export enum App {
  gateway = 'gateway',
}

/**
 * Enum of available protocols
 */
export enum Protocol {
  rest = 'rest',
  grpc = 'grpc',
}

/**
 * Enum of available environments
 */
export const Environment = Object.freeze({
  gateway: {
    admin: 'admin',
    adminSec: 'adminSec',
    proxy: 'proxy',
    proxy2: 'proxy2',
    proxy3: 'proxy3',
    proxy4: 'proxy4',
    proxySec: 'proxySec',
    ec2host: 'ec2host',
    hostName: 'hostName',
    wsProxy: 'wsProxy',
    wssProxy: 'wssProxy',
    ec2TestServer: 'ec2TestServer',
  },
});

/**
 * Object of available base paths
 */
const getPaths = () => {
  return {
    gateway: {
      admin: `http://${getGatewayHost()}:8001`,
      adminSec: `https://${getGatewayHost()}:8444`,
      status: `https://${getGatewayHost()}:8100`,
      statusDP: `https://${getGatewayHost()}:8101`,
      proxy: `http://${getGatewayHost()}:8000`,
      proxySec: `https://${getGatewayHost()}:8443`,
      proxy2: `http://${getGatewayHost()}:8010`,
      proxySec2: `https://${getGatewayHost()}:8453`,
      proxy3: `http://${getGatewayHost()}:8020`,
      proxySec3: `https://${getGatewayHost()}:8463`,
      proxy4: `http://${getGatewayHost()}:8030`,
      proxySec4: `https://${getGatewayHost()}:8473`,
      wsProxy: `ws://${getGatewayHost()}:8000`,
      wssProxy: `wss://${getGatewayHost()}:8443`,
      ec2host: 'ec2-18-117-8-125.us-east-2.compute.amazonaws.com',
      ec2TestServer: '18.117.9.215',
      hostName: getGatewayHost(),
    },
  };
};

/**
 * Get the current app under test (if configured)
 * @param {string | undefined} app current app to check for
 * @returns {string} current app
 */
export const getApp = (app = 'gateway'): string => {
  if (!app || !(app in App)) {
    throw new Error(
      `App '${app}' does not exist or was not provided. Use 'export TEST_APP=<kauth|konnect|gateway>'`
    );
  }
  return app;
};

/**
 * Get the current primary protocol under test (if supported)
 * @returns {string} current primary protocol
 */
export const getProtocol = (): string => {
  let protocol = process.env.TEST_PROTOCOL || '';
  if (!protocol) {
    protocol = Protocol.rest;
  }
  if (!(protocol in Protocol)) {
    throw new Error(`Protocol '${protocol}' is not currently supported`);
  }
  return protocol;
};

/**
 * Get the current app environment (if configured)
 * @param {string | undefined} app current app to use
 * @param {string | undefined} environment current environment to check for
 * @returns {string} app environment
 */
export const getEnvironment = (
  app: string | undefined = getApp(),
  environment: string | undefined = process.env.TEST_ENV
): string => {
  if (
    !environment ||
    !(app in Environment) ||
    !(environment in Environment[app])
  ) {
    throw new Error(
      `Environment '${environment}' does not exist or was not provided. Use 'export TEST_ENV=<environment>'`
    );
  }
  return environment;
};

/**
 * Get the base path for the current environment of app under test
 * @param {string | undefined} options.app current app
 * @param {string | undefined} options.environment current environment
 */
export const getBasePath = (
  options: { app?: string | undefined; environment?: string | undefined } = {}
): string => {
  const app = getApp(options.app);
  const environment = getEnvironment(app, options.environment);
  return getPaths()[app][environment];
};

/**
 * Get the base path for a certain endpoint in the gateway test envronment
 */

export const getGatewayBasePath = (key: string): string =>
    getPaths()['gateway'][key];

/**
 * Check if the current test run environment is CI
 * @returns {boolean}- true or false
 */
export const isCI = (): boolean => {
  return process.env.CI === 'true' ? true : false;
};

/**
 * Check if the current app environment matches the target
 * @param {string} environment target to match
 * @returns {boolean} if matched - true; else - false
 */
export const isEnvironment = (environment: string): boolean => {
  return getEnvironment() === environment;
};

/**
 * Check if the current app environment is localhost
 * @param {string} app current app to use
 * @returns {boolean} if localhost - true; else - false
 */
export const isLocal = (app: string = getApp()): boolean => {
  return isEnvironment(Environment[app].local);
};

/**
 * Check if the current app is Gateway
 * @returns {boolean} if Gateway - true; else - false
 */
export const isGateway = (): boolean => {
  return getApp() === App.gateway;
};

/**
 * Check if running on GKE cluster
 * @returns {boolean} if GKE - true; else - false
 */
export const isGKE = (): boolean => {
  return process.env.GKE === 'true' ? true : false;
};

/**
 * Use preview endpoints (if configured)
 * @returns {boolean} preview
 */
export const isPreview = (): boolean => {
  return process.env.TEST_PREVIEW === 'true';
};

/**
 * Check if the current protocol is gRPC
 * @returns {boolean} if gRPC - true; else - false
 */
export const isGRPC = (): boolean => {
  return getProtocol() === Protocol.grpc;
};

/**
 * Check if the current protocol is REST
 * @returns {boolean} if REST - true; else - false
 */
export const isREST = (): boolean => {
  return getProtocol() === Protocol.rest;
};

/**
 * Get current unix timestamp
 * @returns {string} - current unix timestamp
 */
export const getUnixTimestamp = (): string => {
  return process.env.UNIX_TIMESTAMP || Math.floor(Date.now() / 1000).toString();
};

/**
 * Get current package install method
 * @returns {string} - current package/repository install method
 */
export const getPackageInstallMethod = (): string | undefined => {
  return process.env.PACKAGE_INSTALL_METHOD;
};
