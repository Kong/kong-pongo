import { AxiosResponse } from 'axios';

/**
 * Define whether to verbose log request responses or not
 */
export const isLoggingEnabled = () => {
  return process.env.VERBOSE_RESPONSE_LOGS !== 'false';
};

/**
 * Log the axios response details (url, status, headers, body)
 * @param {AxiosResponse} response axios response
 */
export const logResponse = (response: AxiosResponse): void => {
  if (isLoggingEnabled()) {
    console.log('\n');
    console.log(`URL: ${response.config.url}`);
    console.log(`METHOD: ${response.config.method?.toUpperCase()}`);
    console.log(`STATUS: ${response.status}`);
    console.log('HEADERS:');
    console.log(response.headers);
    console.log('BODY:');
    console.log(JSON.stringify(response.data, null, 2));
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