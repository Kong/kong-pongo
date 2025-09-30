import { execSync } from 'child_process';
import { getNegative } from './negative-axios';
import { wait } from './random';
import { logDebug, logResponse } from './logging';
import { expect } from '../assert/chai-expect';

/**
 * Calculates the wait time to send a request based on the desired window ("current" or "next"),
 * ensuring there's a safe buffer before the next window starts.
 * The function is optimized for window lengths between 10 and 60 seconds, with a default of 10 seconds.
 * 
 * @param {string} containerName - The name of the Docker container to check the current UTC time in.
 * @param {number} windowLengthInSeconds - Length of the time window in seconds, defaulting to 10 seconds.
 * @param {number} safeTimeBeforeNextWindowInSeconds - The safe time buffer before the next window starts, in seconds.
 * @returns {Promise<object>} - A promise that resolves with the number of milliseconds to wait before sending the request.
 */
export const calculateWaitTimeForWindow = async (containerName, windowLengthInSeconds = 10, safeTimeBeforeNextWindowInSeconds = 3) => {
  // Ensure windowLength is within the supported range.
  if (windowLengthInSeconds < 10 || windowLengthInSeconds > 60) {
    throw new Error("Window length must be between 10 and 60 seconds.");
  }

  const currentUTCTimeStr = execSync(`docker exec $(docker ps -aqf name="${containerName}") date -u +%s`).toString().trim();
  const currentUTCTime = parseInt(currentUTCTimeStr, 10);
  const timeSinceWindowStart = currentUTCTime % windowLengthInSeconds;
  let waitTimeInSeconds:number;
  let shallRetrigger = false;

  // Define a minimal buffer time (in seconds) to avoid sending at the exact start of the next window.
  const startWindowBufferInSeconds = 3;

  if(timeSinceWindowStart <= 1){
    waitTimeInSeconds = 0;
    shallRetrigger = true;
  } else if (timeSinceWindowStart < (windowLengthInSeconds - safeTimeBeforeNextWindowInSeconds) - startWindowBufferInSeconds) {
    // If within the safe period and not too close to the window's end, no need to wait.
    waitTimeInSeconds = 0;
  } else {
    // If too close to the window's end or at the start of the next window, calculate wait time to ensure we're in the safe period of the next window.
    waitTimeInSeconds = windowLengthInSeconds - timeSinceWindowStart + startWindowBufferInSeconds;
    shallRetrigger = true;
  }

  // Calculate sendWindow in seconds for the next safe request send out time, but will be rounded down to the window time
  // math.floor(time / size) * size here copied window calculation logic in RLA
  const sendWindow = Math.floor((currentUTCTime + waitTimeInSeconds)/windowLengthInSeconds)*windowLengthInSeconds;

  // Return the object with sendWindow and waitTime details.
  return {
    sendWindow: sendWindow.toString(), // Keep it in epoch time format, converted to string to match your initial format request.
    waitTimeInSeconds: waitTimeInSeconds,
    waitTimeInMilliseconds: waitTimeInSeconds * 1000,
    shallRetrigger
  };
};
/**
 * Sends an HTTP request at a targeted time window, ensuring the request lands safely within the specified window.
 * 
 * @param {string} urlProxy - The proxy URL to which the request will be sent.
 * @param {Object} headers - The headers to be included in the request.
 * @param {string} containerName - The name of the container being used.
 * @param {string} [targetWindow="current"] - Specifies whether to target the "current" or "next" window for sending the request.
 * @param {number} [windowLengthInSeconds=10] - Optional. The length of the time window in seconds. Defaults to 10.
 * @param {number} [safeTimeBeforeNextWindowInSeconds=4] - Optional. The safe time buffer before the next window starts, in seconds. Defaults to 4.
 * @param {number} [rateLimit=1] - Optional. The number of requests to send within the rate limit.
 * 
 * @returns {Promise<{response: any, waited: boolean}>} - A promise that resolves to an object containing:
 *   - `response`: The HTTP response from the final request.
 *   - `waited`: A boolean indicating whether there was a delay before sending the request.
 */
export const sendRequestInWindow = async ({
  url,
  headers,
  containerName,
  windowLengthInSeconds = 10,
  safeTimeBeforeNextWindowInSeconds = 4,
  rateLimit = 1
}:{url:string, 
  headers?:object, 
  containerName:string, 
  windowLengthInSeconds?:number, 
  safeTimeBeforeNextWindowInSeconds?:number, 
  rateLimit?:number}) => {
  type RequestResult = { response: any; waited: boolean; sendWindow: string};
  let waited = false;
  const calculate: any = await calculateWaitTimeForWindow(containerName, windowLengthInSeconds, safeTimeBeforeNextWindowInSeconds);
  const waitTime = calculate.waitTimeInMilliseconds;
  const shallRetrigger = calculate.shallRetrigger;
  const sendWindow = calculate.sendWindow;
  logDebug(`Waiting for ${waitTime} milliseconds before sending the request to ensure it lands in the same window, retrigger option is ${shallRetrigger}.`);

  // Use the wait function to delay the request sending.
  await wait(waitTime);// eslint-disable-line no-restricted-syntax
  if (shallRetrigger === true) {
    for (let i = 0; i <= rateLimit; i++) {
      //Send request to reach rate limit
      const resp = await getNegative(url, headers);
      logResponse(resp);
    }
    waited = true;
  }
  //Send request for final check
  const response = await getNegative(url, headers);
  logResponse(response);
  const result: RequestResult = { response, waited, sendWindow };
  return result;
};

/**
* Verifies the effect of rate limiting by sending multiple requests to the specified URL.
* It checks if the requests are rejected with a specific status code after exceeding the rate limit.
*
* @param {Object} params - The parameters for the verification function.
* @param {number} params.rateLimit - The maximum allowed number of requests before triggering rate limiting.
* @param {number} [params.rejectCode=429] - The expected status code when rate limiting is triggered (default is 429).
* @param {number} [params.passCode=200] - The expected status code when requests are under the rate limit (default is 200).
* @param {string} params.url - The URL to send the requests to for rate limit verification.
* @param {object} [params.headers] - Optional headers to include with each request.
* 
* @returns {Promise<void>} - Resolves if the rate limit verification is successful, otherwise throws an error.
*
* @example
* // Verifies that the rate limit is enforced with a 429 status code after 5 requests
* await verifyRateLimitingEffect({ rateLimit: 5, url: "https://api.example.com", headers: { "Authorization": "Bearer token" } });
*/
export const verifyRateLimitingEffect = async ({
  rateLimit,
  rejectCode = 429,
  passCode = 200,
  url,
  headers = {} // Make headers default to an empty object
}: {
  rateLimit: number;
  rejectCode?: number;
  passCode?: number;
  url: string;
  headers?: object;
}) => {
  for (let i = 0; i <= rateLimit; i++) {
    const resp: any = await getNegative(url, headers);
    logResponse(resp);

    if (i === rateLimit) {
      expect(resp.status, `Status should be ${rejectCode}`).to.equal(rejectCode);
    } else {
      expect(resp.status, `Status should be ${passCode}`).to.equal(passCode);
    }
  }
};

/**
 * Internal helper for sending a request, tracking status, latency, and returning details.
 * Updates metrics and allRecordedHeaders if provided.
 * Not exported; intended for internal use only.
 *
 * @param {string} url
 * @param {object|undefined} headers
 * @param {object} [metrics] - Optional metrics object to update.
 * @param {object} [allRecordedHeaders] - Optional object to accumulate all headers.
 * @param {number} [requestId] - Optional request ID for logging.
 * @returns {Promise<{response: any, latency: number, status: number, headers: object, hasThrottlingHeaders: boolean, requestId?: number, error?: string}>}
 */
const _sendRequestAndTrackStatus = async (
  url: string,
  headers: object | undefined,
  metrics?: { status200Count: number; status429Count: number; statusError: number; totalLatency: number },
  allRecordedHeaders?: object,
  requestId?: number
) => {
  const startTime = Date.now();
  try {
    const resp: any = await getNegative(url, headers);
    const endTime = Date.now();
    const latency = endTime - startTime;

    // Update metrics if provided
    if (metrics) {
      metrics.totalLatency += latency;
      if (resp.status === 200) {
        metrics.status200Count++;
      } else if (resp.status === 429) {
        metrics.status429Count++;
      } else if (resp.status >= 400) {
        metrics.statusError++;
      }
    }

    // Update allRecordedHeaders if provided
    if (allRecordedHeaders) {
      Object.assign(allRecordedHeaders, resp.headers);
    }

    // Check for throttling headers
    const hasThrottlingHeaders = Object.keys(resp.headers).some(headerName =>
      headerName.toLowerCase().includes('x-ratelimit-throttling')
    );

    logResponse(resp);
    logDebug(`Request${requestId !== undefined ? ` ${requestId}` : ''}: Status ${resp.status}, Latency ${latency}ms, Throttling headers: ${hasThrottlingHeaders}`);

    return {
      response: resp,
      latency,
      status: resp.status,
      headers: resp.headers,
      hasThrottlingHeaders,
      requestId
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug(`Request${requestId !== undefined ? ` ${requestId}` : ''} failed after ${latency}ms: ${errorMessage}`);
    return {
      response: null,
      latency,
      status: undefined,
      headers: {},
      hasThrottlingHeaders: false,
      requestId,
      error: errorMessage
    };
  }
};

/**
 * Sends a burst of concurrent HTTP requests using _sendRequestAndTrackStatus.
 * Used for rate limiting and throttling header verification.
 *
 * @param {string} url - The URL to send requests to.
 * @param {object} reqheaders - Headers to include in each request.
 * @param {number} burstSize - Number of requests to send in the burst.
 * @param {object} [allRecordedHeaders] - Optional object to accumulate all response headers.
 * @param {number} [totalRequestCount] - Optional offset for request IDs.
 * @returns {Promise<Array>} - Resolves to an array of result objects from _sendRequestAndTrackStatus.
 */
async function sendBurstRequests(
  url: string,
  reqheaders: object,
  burstSize: number,
  allRecordedHeaders?: object,
  totalRequestCount?: number,
): Promise<Array<{
  response: any;
  latency: number;
  status: number;
  headers: object;
  hasThrottlingHeaders: boolean;
  requestId?: number;
  error?: string;
}>> {
  const promises: Promise<any>[] = [];
  for (let i = 1; i <= burstSize; i++) {
    const requestId = (totalRequestCount ?? 0) + i;
    promises.push(_sendRequestAndTrackStatus(url, reqheaders, undefined, allRecordedHeaders, requestId));
  }
  return Promise.all(promises);
}

/**
 * Analyzes the results of burst requests, categorizing them by throttling headers,
 * high latency, and rate-limited responses.
 *
 * @param {Array} results - Array of result objects from _sendRequestAndTrackStatus.
 * @returns {object} - Object containing arrays: throttledResults, highLatencyResults, rateLimitedResults.
 */
function analyzeBurstResults(results) {
  const throttledResults = results.filter(r => r.response && r.hasThrottlingHeaders);
  const highLatencyResults = results.filter(r => r.response && r.latency > 3000);
  const rateLimitedResults = results.filter(r => r.response && r.response.status === 429);

  return { throttledResults, highLatencyResults, rateLimitedResults };
}

/**
 * Validates response headers against expected header names and match type.
 * Asserts presence or absence of headers and logs results.
 *
 * @param {string[]} respheaderName - Array of header names to check.
 * @param {string} matchType - 'include' to require headers, 'notinclude' to require absence.
 * @param {Record<string, any>} responseHeaders - Headers from the HTTP response.
 * @returns {Array} - Array of validation result objects for each header.
 */
function validateHeaders(
  respheaderName: string[],
  matchType: string,
  responseHeaders: Record<string, any>
) {
  const responseHeaderKeys = Object.keys(responseHeaders);
  const results: Array<{
    headerName: string;
    matchType: string;
    found: boolean;
    matchedHeaders: string[];
    headerValue: any[] | null;
  }> = [];

  respheaderName.forEach(headerName => {
    const lowerHeaderName = headerName.toLowerCase();
    const matchedHeaders = responseHeaderKeys.filter(key => key.toLowerCase().includes(lowerHeaderName));
    const headerFound = matchType === 'include' ? matchedHeaders.length > 0 : matchedHeaders.length === 0;

    if (matchType === 'include') {
      expect(matchedHeaders.length, `Response headers should include partial match for '${headerName}'. Found: ${matchedHeaders.join(', ')}`).to.be.greaterThan(0);
    } else {
      expect(matchedHeaders.length, `Response headers should NOT include '${headerName}'. Found: ${matchedHeaders.join(', ')}`).to.equal(0);
    }

    results.push({
      headerName,
      matchType,
      found: headerFound,
      matchedHeaders,
      headerValue: matchedHeaders.length > 0 ? matchedHeaders.map(h => responseHeaders[h]) : null
    });

    const foundText = matchType === 'notinclude'
      ? (matchedHeaders.length === 0 ? 'NOT FOUND (as expected)' : 'FOUND (unexpected)')
      : (headerFound ? 'FOUND' : 'NOT FOUND');
    logDebug(`Header '${headerName}' (${matchType}): ${foundText} - Matches: [${matchedHeaders.join(', ')}]`);
  });

  return results;
}


/**
 * Verifies the rate limiting rate by sending a specified number of HTTP requests
 * to the provided URL and calculating the rate of 429 (Too Many Requests) responses
 * relative to the total number of requests, excluding error statuses (400, 500).
 * Also tracks average latency for performance analysis.
 * 
 * @param {string} params.url - The URL to which requests are sent.
 * @param {object} [params.headers] - Optional headers to include in the requests.
 * @param {number} [params.interval=500] - The interval (in milliseconds) between requests. Default is 500ms.
 * @param {number} [params.totalRequests=20] - The total number of requests to send. Default is 20 requests.
 * @param {boolean} [params.returnDetailed=false] - If true, returns detailed metrics object; if false, returns just the ratio for backward compatibility.
 * @param {boolean} [params.useBurst=false] - If true, sends requests in bursts.
 * @param {number} [params.burstSize=10] - Number of requests to send in each burst (only used if useBurst is true).
 * 
 * @returns {Promise<number | {rateLimitRate: number, averageLatency: number, status200Count: number, status429Count: number, statusError: number}>} 
 * - A promise that resolves to either the rate limit ratio (backward compatibility) or detailed metrics object.
 */
export const verifyRateLimitingRate = async ({
  url,
  headers,
  interval = 500,
  totalRequests = 20,
  returnDetailed = false,
  useBurst = false,
}: {
  url: string;
  headers?: object;
  interval?: number;
  totalRequests?: number;
  returnDetailed?: boolean;
  useBurst?: boolean;
  burstSize?: number;
}) => {
  const metrics = {
    status200Count: 0,
    status429Count: 0,
    statusError: 0,
    totalLatency: 0,
  };

  if (useBurst) {
    const promises: Promise<any>[] = [];
    for (let i = 0; i < totalRequests; i++) {
      promises.push(_sendRequestAndTrackStatus(url, headers, metrics));
      if (i < totalRequests - 1) {
        await wait(interval); // eslint-disable-line no-restricted-syntax
      }
    }
    await Promise.all(promises);
  } else {
    for (let i = 0; i < totalRequests; i++) {
      await _sendRequestAndTrackStatus(url, headers, metrics);
      await wait(interval); // eslint-disable-line no-restricted-syntax
    }
  }

  const rateLimitRate = parseFloat((metrics.status429Count / (totalRequests - metrics.statusError)).toFixed(2));
  const averageLatency = parseFloat((metrics.totalLatency / totalRequests).toFixed(2));

  logDebug(`Total requests: ${totalRequests}`);
  logDebug(`200 Status Count: ${metrics.status200Count}`);
  logDebug(`429 Status Count: ${metrics.status429Count}`);
  logDebug(`Error Status Count: ${metrics.statusError}`);
  logDebug(`Rate Limit Rate: ${rateLimitRate}`);
  logDebug(`Average Latency: ${averageLatency}ms`);

  if (returnDetailed) {
    return {
      rateLimitRate,
      averageLatency,
      status200Count: metrics.status200Count,
      status429Count: metrics.status429Count,
      statusError: metrics.statusError,
      totalRequests
    };
  }

  return rateLimitRate;
};

/**
 * Rapidly sends concurrent requests to exhaust rate limit and trigger throttling,
 * 
 * @param {string} params.url - The URL to send requests to until rate limited.
 * @param {object} [params.reqheaders] - Optional headers to include in the requests.
 * @param {string[]} params.respheaderName - Array of header names to verify in the response.
 * @param {string} [params.matchType='include'] - Match type: 'include', or 'notinclude'.
 * @param {number} [params.burstSize=15] - Number of concurrent requests to send in initial burst.
 * @param {number} [params.maxRetries=3] - Maximum number of burst attempts.
 * @param {number} [params.retryDelay=2000] - Delay between burst attempts in milliseconds.
 * 
 * @returns {Promise<{response: any, requestCount: number, allHeaders: object}>} 
 * - A promise that resolves to an object containing the throttled response, request count, and all headers.
 * 
 * @example
 * // Test throttling headers with concurrent burst approach
 * const result = await verifyThrottlingHeaders({
 *   url: 'http://localhost:8000/test',
 *   reqheaders: { 'X-Limit-Hit': 'testKey' },
 *   respheaderName: ['x-ratelimit-throttling-waiting-', 'x-ratelimit-throttling-limit'],
 *   matchType: 'include'
 * });
 */
export const verifyThrottlingHeaders = async ({
  url,
  reqheaders = {},
  respheaderName,
  matchType = 'include',
  burstSize = 15,
  maxRetries = 5,
  retryDelay = 2000
}) => {
  let throttledResponse: { headers: Record<string, any>; status?: number } | null = null;
  let totalRequestCount = 0;
  let attemptCount = 0;
  const allRecordedHeaders = {};

  logDebug(`Starting throttling header verification with burst approach`);
  logDebug(`Burst size: ${burstSize}, Max retries: ${maxRetries}, Retry delay: ${retryDelay}ms`);

  while (attemptCount < maxRetries && !throttledResponse) {
    attemptCount++;
    logDebug(`\n--- Burst Attempt ${attemptCount}/${maxRetries} ---`);

    const results = await sendBurstRequests(url, reqheaders, burstSize, allRecordedHeaders, totalRequestCount);
    totalRequestCount += burstSize;

    const { throttledResults, highLatencyResults, rateLimitedResults } = analyzeBurstResults(results);

    logDebug(`Burst ${attemptCount} results:`);
    logDebug(`- Total requests: ${results.length}`);
    logDebug(`- Successful responses: ${results.filter(r => r.response).length}`);
    logDebug(`- With throttling headers: ${throttledResults.length}`);
    logDebug(`- High latency (>3s): ${highLatencyResults.length}`);
    logDebug(`- Rate limited (429): ${rateLimitedResults.length}`);

    if (throttledResults.length > 0 && matchType === 'include') {
      throttledResponse = throttledResults[0].response;
      logDebug(`Found throttling headers in request ${throttledResults[0].requestId}`);
      break;
    }

    if (rateLimitedResults.length > 0 && matchType === 'notinclude') {
      throttledResponse = rateLimitedResults[0].response;
      logDebug(`Using rate-limited response from request ${rateLimitedResults[0].requestId} for 'notinclude' verification`);
      break;
    }

    if (attemptCount === maxRetries && !throttledResponse) {
      if (highLatencyResults.length > 0) {
        const slowestResult = highLatencyResults.reduce((prev, current) =>
          (current.latency > prev.latency) ? current : prev
        );
        throttledResponse = slowestResult.response;
        logDebug(`Using high-latency response from request ${slowestResult.requestId} (${slowestResult.latency}ms)`);
      } else if (rateLimitedResults.length > 0) {
        throttledResponse = rateLimitedResults[0].response;
        logDebug(`Using rate-limited response from request ${rateLimitedResults[0].requestId}`);
      }
      break;
    }

    if (attemptCount < maxRetries && !throttledResponse) {
      logDebug(`Waiting ${retryDelay}ms before next burst...`);
      await wait(retryDelay);// eslint-disable-line no-restricted-syntax
    }
  }

  if (!throttledResponse) {
    throw new Error(`Failed to find suitable response after ${attemptCount} burst attempts (${totalRequestCount} total requests)`);
  }

  const responseHeaders = throttledResponse.headers;
  const headerValidationResults = validateHeaders(respheaderName, matchType, responseHeaders);

  logDebug(`\nThrottling header verification completed:`);
  logDebug(`- Total requests sent: ${totalRequestCount}`);
  logDebug(`- Burst attempts: ${attemptCount}`);
  logDebug(`- Response status: ${throttledResponse.status}`);
  logDebug(`- Headers verified: ${headerValidationResults.length}`);
  logDebug(`- All validations passed: ${headerValidationResults.every(r => r.found)}`);

  return {
    response: throttledResponse,
    requestCount: totalRequestCount,
    burstAttempts: attemptCount,
    allHeaders: allRecordedHeaders,
    headerValidationResults,
    responseHeaders
  };
};