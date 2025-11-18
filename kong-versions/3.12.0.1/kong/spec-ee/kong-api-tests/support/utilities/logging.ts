import { AxiosResponse } from 'axios';

// Track the current logging context
let currentLoggingContext: string | null = null;

/**
 * Define whether to verbose log request responses or not
 */
export const isLoggingEnabled = () => {
  return process.env.VERBOSE_RESPONSE_LOGS !== 'false';
};

/**
 * Check if waitForConfigRebuild logs should be shown
 */
export const isWaitForConfigRebuildLoggingEnabled = () => {
  return process.env.VERBOSE_CONFIG_REBUILD_LOGS === 'true';
};

/**
 * Set the current logging context
 */
export const setLoggingContext = (context: string | null) => {
  currentLoggingContext = context;
};

/**
 * Get the current logging context
 */
export const getLoggingContext = () => {
  return currentLoggingContext;
};

/**
 * Log the axios response details (url, status, headers, body)
 * @param {AxiosResponse} response axios response
 */
export const logResponse = (response: AxiosResponse): void => {
  if (!isLoggingEnabled()) {
    return;
  }

  // If we're in waitForConfigRebuild context, only log if specifically enabled
  if (currentLoggingContext === 'waitForConfigRebuild' && !isWaitForConfigRebuildLoggingEnabled()) {
    return;
  }

  console.log('\n');
  console.log(`URL: ${response.config.url}`);
  console.log(`METHOD: ${response.config.method?.toUpperCase()}`);
  console.log(`STATUS: ${response.status}`);
  console.log('HEADERS:');
  console.log(response.headers);
  console.log('BODY:');
  console.log(JSON.stringify(response.data, null, 2));
  console.log('\n');
};
/**
 * Log AWS SDK response details (metadata and output)
 * @param {any} response AWS SDK command output
 * @param {string} commandName optional command name for context
 */
export const logSDKResponse = (response: any, commandName?: string): void => {
  if (isLoggingEnabled()) {
    console.log('\n');
    if (commandName) {
      console.log(`COMMAND: ${commandName}`);
    }
    console.log('SDK RESPONSE METADATA:');
    if (response.$metadata) {
      console.log(JSON.stringify(response.$metadata, null, 2));
    }
    console.log('SDK RESPONSE DATA:');
    // Create a copy without $metadata to avoid duplication
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $metadata, ...responseData } = response;
    console.log(JSON.stringify(responseData, null, 2));
    console.log('\n');
  }
};

/**
 * Conditional debug logging to console
 * @param {string} msg message to be logged
 */
export const logDebug = (msg: string): void => {
  if (isLoggingEnabled()) {
    console.log('DEBUG: ', String(msg));
  }
};

/**
 * Logs the start or end marker for a function's execution scope.
 * 
 * This utility function prints a debug log indicating the start or end of a 
 * function's execution, based on the provided `action`. It helps in tracing 
 * the flow of function calls, especially when debugging.
 * 
 * @param {string} functionName - The name of the function for which the scope is being logged.
 * @param {'start' | 'end'} action - Specifies whether to log the start or end of the function execution.
 *                                     Accepts either 'start' or 'end'.
 * 
 * @example
 * logScope('myFunction', 'start'); // Logs: "-----------Start of myFunction-----------"
 * logScope('myFunction', 'end');   // Logs: "-----------End of myFunction-----------"
 */
export const logScope = (functionName: string, action: 'start' | 'end') => {
  if (isLoggingEnabled()) {
    const marker = action === 'start' ? 'Start' : 'End';
    console.log(`-----------${marker} of ${functionName}-----------`);
  }
};