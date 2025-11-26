import { isCI } from '@support';
import { isLoggingEnabled, getLoggingContext, isWaitForConfigRebuildLoggingEnabled } from './logging';
/**
 * Wait for the `assertions` does not throw any exceptions.
 * @param assertions - The assertions to be executed.
 * @param timeout - The timeout in milliseconds.
 * @param delay - initial delay between retries
 * @param verbose - Verbose logs in case of error
 * @returns {Promise<void>} - Asnyc void promise.
 */
export const eventually = async <T = void>(
  assertions: () => Promise<T>,
  timeout = 120000,
  delay = 100,
  verbose = isLoggingEnabled(),
): Promise<T> => {
  // enable verbose logs in GH Actions for debugability
  let shouldLogVerbose = verbose;
  if (getLoggingContext() === 'waitForConfigRebuild') {
    // Both CI and local ignore verbose arg inside waitForConfigRebuild
    shouldLogVerbose = isWaitForConfigRebuildLoggingEnabled();
  } else {
    if (isCI()) {
      shouldLogVerbose = true;
    } else {
      shouldLogVerbose = verbose;
    }
  }


  let errorMsg = '';
  let errorStack = '';
  let elapsed = 0;
  let remaining = timeout;

  const start = Date.now();

  while (remaining >= 0) {
    try {
      return await assertions();
    } catch (error: any) {
      errorMsg = error.message;
      errorStack = error.stack;
      elapsed = Date.now() - start;
      remaining = timeout - elapsed;

      if (remaining > 0) {
        const jitter = Math.random() * 10;
        delay = Math.min(delay * 1.25 + jitter, remaining);

        if (shouldLogVerbose) {
          console.log(errorMsg);
          console.log(`** Assertion(s) Failed -- Retrying in ${delay / 1000} seconds **`);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  errorMsg = `** Timed Out (after ${elapsed / 1000} seconds) -- Last error: '${errorMsg}' **`;

  if (shouldLogVerbose) {
    console.log(errorMsg);
  }

  const err = new Error(errorMsg);

  err.stack += `\nCaused by: ${errorStack}`;

  throw err;
};
