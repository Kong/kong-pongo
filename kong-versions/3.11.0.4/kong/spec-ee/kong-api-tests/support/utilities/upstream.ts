import { expect, logResponse } from '@support';
import axios from 'axios';

export const TARGET_HOST = 'host.docker.internal';

export interface UpstreamTarget {
  containerName: string;
  portTarget: number;
}


/**
 * Gets the current request count from the specified target server
 * @param {UpstreamTarget} target - The target server to check
 * @returns {Promise<number>} - Returns the current request count
 * @throws {Error} - Throws an error if the request fails
 */
export const getTargetCount = async (target: UpstreamTarget): Promise<number> => {
  try {
    const resp = await axios({
      method: 'get',
      url: `http://localhost:${target.portTarget}/counter`,
    });

    logResponse(resp);

    return resp.data.counter;
  } catch (error) {
    console.error(`Error fetching request count for target ${target.containerName}:`, error);
    throw error;
  }
};

/**
 * Resets the current request count from the specified target server
 * @param {UpstreamTarget[]} targets - The target servers to reset
 * @returns {Promise<void>} - Returns nothing
 * @throws {Error} - Throws an error if the request fails
 */
export const resetCounterForTarget = async (targets: UpstreamTarget[]) => {
  try {
    for (const target of targets) {
      // reset target counter
      // we use a custom endpoint in the target server to reset its internal request counter
      const resp = await axios({
        method: 'post',
        url: `http://localhost:${target.portTarget}/reset`,
      });
      expect(resp.data.counter, `Target ${target.containerName} counter should be zero`).to.equal(0);
    }
  } catch (error) {
    console.error('Error resetting target counters:', error);
    throw error;
  }
};

/**
 * Asserts that the request count for a specific target matches the expected count
 * @param target - The target server to check
 * @param expectedCount - The expected request count
 */
export const assertTargetRequestCount = async (target: UpstreamTarget, expectedCount: number) => {
  try {
    const counter = await getTargetCount(target);

    expect(
      counter,
      `Target ${target.containerName} should have received exactly ${expectedCount} requests`,
    ).to.be.equal(expectedCount);
  } catch (error) {
    console.error(`Error fetching request count for target ${target.containerName}:`, error);
    throw error;
  }
};

/**
 * Asserts that the request count for a specific target is greater than the minimum expected count
 * @param target - The target server to check
 * @param minimumExpectedCount - The minimum expected request count
 */
export const assertTargetRequestGreaterThanCount = async (target: UpstreamTarget, minimumExpectedCount: number) => {
  try {
    const counter = await getTargetCount(target);

    expect(
      counter,
      `Target ${target.containerName} should have received more than ${minimumExpectedCount} requests`,
    ).to.be.greaterThan(minimumExpectedCount);
  } catch (error) {
    console.error(`Error fetching request count for target ${target.containerName}:`, error);
    throw error;
  }
};
