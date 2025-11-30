import { v4 as uuidv4 } from 'uuid';
import { expect } from '@support'
/**
 * @returns {string} - Random string
 */
export const randomString = () => {
  return uuidv4().toUpperCase().split('-')[4];
};

/**
 * @param {number} waitTime - number in milliseconds to wait
 */
export const wait = async (waitTime: number) => {
  return await new Promise((resolve) => setTimeout(resolve, waitTime));
};

/**
 * Find match of a given regex in a given string and return Boolean
 * @param {string} regexPattern to search for
 * @param {string} targetString
 * @param {string} testOrExec - either 'test' or 'exec' to control the return value
 * @returns {boolean}
 */
export const findRegex = (regexPattern, targetString, testOrExec = 'test') => {
  const regex = new RegExp(regexPattern, 'g');
  return testOrExec === 'test' ? regex.test(targetString) : regex.exec(targetString);
};

/**
 * Find number of matches of a given regex in a given string and return count
 * @param {string} regexPattern to search for
 * @param {string} targetString
 * @returns {number}
 */
export const regexCount = (regexPattern, targetString) => {
  const regex = new RegExp(regexPattern, 'g');
  return (targetString.match(regex) || []).length;
};

/**
 * Checks if a substring appears in a string the expected number of times based on the specified match type.
 * @param {string} text - The text to search.
 * @param {string} keyword - The substring to count.
 * @param {number} expectedCount - The expected number of occurrences.
 * @param {string} matchType - The type of match to perform: 'equal' (default), 'gte', or 'lte'.
 * @returns {void}
 */
export const matchOccurrences = (
  text: string,
  keyword: string,
  expectedCount: number,
  matchType: 'equal' | 'gte' | 'lte' = 'equal'
): void => {
  const matches = text.match(new RegExp(keyword, 'g')) || [];
  const actualCount = matches.length;

  // Perform the assertion based on the match type
  switch (matchType) {
    case 'equal':
      expect(
        actualCount,
        `Expected the keyword "${keyword}" to appear exactly ${expectedCount} times, but it appeared ${actualCount} times. Full text: "${text}"`
      ).to.equal(expectedCount);
      break;

    case 'gte':
      expect(
        actualCount,
        `Expected the keyword "${keyword}" to appear at least ${expectedCount} times, but it appeared ${actualCount} times. Full text: "${text}"`
      ).to.be.gte(expectedCount);
      break;

    case 'lte':
      expect(
        actualCount,
        `Expected the keyword "${keyword}" to appear at most ${expectedCount} times, but it appeared ${actualCount} times. Full text: "${text}"`
      ).to.be.lte(expectedCount);
      break;

    default:
      throw new Error(`Invalid matchType "${matchType}". Valid options are 'equal', 'gte', or 'lte'.`);
  }
};