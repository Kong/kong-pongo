import 'dotenv/config';
import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { isWeeklyRun } from '../../support/config/gateway-vars';

/**
 * Hardcoded value of historical test durations for gateway-api-tests specs
 * This is used to optimize test selection and execution.
 * TODO: automate the update of this file as part of the CI process
 */

import durationSpecFileMap from './test_file_durations.json';

/**
 * Utility that is being used to identify test files based on the RUN_SPEC environment variable
 * The identified test files are being used to split into groups and run tests in parallel
 * This script is being executed when 'npm run select-tests' is being called and in this case the tests are being collected following the logic in this file
 * For all other 'npm run' commands the logic is the same as it is in the package.json script instruction
 */

type SpecFilePath = string;
type DurationRecord = { spec: string; duration: number };
type DurationMap = { [spec: string]: number };
interface TestGroup {
  tests: string[];
  hasDbless: boolean;
}

// Max total duration, in seconds, allowed per group when splitting by historical durations
const MAX_DURATION_PER_GROUP = 900; // 15 minutes

// Get the RUN_SPEC environment variable, default to 'weekly' if not set
const runSpec = process.env.RUN_SPEC || 'weekly';
let runWeeklyTests = isWeeklyRun();

// Map runSpec to invert status based on package.json npm script (if the script has negating rules such as 'invert' or '^')
const invertedNpmCommands = new Set(['non-smoke', 'all-except-ai', 'all']);

// useInvert is being used to determine if the test selection should be inverted: !grep.test(content) vs grep.test(content)
const useInvert = invertedNpmCommands.has(runSpec);
const gwApiTestsDir = path.resolve(__dirname, '../../');
const pattern = path.join(gwApiTestsDir, 'test/gateway/**/*.spec.ts');
// will contain all of the filtered test files using the glob pattern
let specFilePaths: SpecFilePath[] = [];
// will be used to conditionally invert the test selection
let invertCommand = '';
let grep: RegExp | null;

// Map test run script logic to the correct pattern and grep
if (runSpec === 'all') {
  grep = runWeeklyTests ? null : /@weekly/;
  invertCommand = '--invert';
} else if (runSpec === 'smoke') {
  grep = /@smoke/;
} else if (runSpec === 'non-smoke') {
  grep = /@smoke/;
  invertCommand = '--invert';
} else if (runSpec === 'oss') {
  grep = /@oss/;
} else if (runSpec === 'aigw') {
  grep = /@ai/;
} else if (runSpec === 'all-except-ai') {
  grep = /@ai|@smoke/;
  invertCommand = '--invert';
} else if (runSpec === 'weekly') {
  grep = /@weekly/;
  // overwrite RUN_WEEKLY_TESTS env variable in case runSpec is 'weekly' to run them regardless
  runWeeklyTests = true;
} else {
  grep = null;
}

//  this condition handles the case where multiple ;-separated spec names are passed to RUN_SPEC
if (runSpec !== 'all' && !grep) {
  // throw error in case multiple specs are not separated by ;
  if (runSpec.includes(',')) {
    console.error("ERROR: Use ';' to separate multiple specs, not ','");
    process.exit(1);
  }
  // Expand test files for each spec in runSpec that is separated by ','
  const fixedSpecs = runSpec
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
  const filePaths: SpecFilePath[] = [];
  for (const spec of fixedSpecs) {
    const p = path.join(gwApiTestsDir, `test/gateway/**/${spec}.spec.ts`);
    filePaths.push(...glob.sync(p));
  }
  // Remove duplicates
  specFilePaths = Array.from(new Set(filePaths));
} else {
  specFilePaths = glob.sync(pattern);
}

/**
 * Additional grep logic for filtering test files such as in case of db-less mode
 * @param content - The content of the test file.
 * @returns True if the file should be included, false otherwise.
 */
const additionalGrepLogic = content => {
  if (process.env.GW_MODE === 'db-less') {
    return /@dbless/.test(content);
  }
  return true;
};

// Read all files and store the files and their content
const fileContents: { file: string; content: string }[] = specFilePaths.map(file => ({
  file,
  content: fs.readFileSync(file, 'utf8'),
}));

// Filter files by grep (exclude if useInvert is true)
let filteredFiles = fileContents;

if (grep !== null) {
  const grepPattern = grep; // TypeScript now knows this is RegExp
  filteredFiles = fileContents.filter(({ content }) => {
    const matchesGrep = grepPattern.test(content);
    const hasWeeklyTag = /@weekly/.test(content);
    const passesAdditionalLogic = additionalGrepLogic(content);

    if (useInvert) {
      // Exclude mode: reject files that match grep pattern
      const baseCondition = !matchesGrep;
      return runWeeklyTests ? baseCondition : baseCondition && !hasWeeklyTag && passesAdditionalLogic;
    } else {
      // Include mode: accept files that match grep pattern
      const baseCondition = matchesGrep;
      return runWeeklyTests ? baseCondition : baseCondition && !hasWeeklyTag && passesAdditionalLogic;
    }
  });
}

// construct the npm command e.g. npm run test-multiple -- -g "@ai|@weekly|@smoke" --invert
const grepStr = grep ? grep.toString().replace(/^\/|\/$/g, '') : '';
let testCmd = 'npm run test-multiple --';

if (grepStr) {
  testCmd += ` -g "${grepStr}"`;
}
if (invertCommand) {
  testCmd += ` ${invertCommand}`;
}

testCmd = testCmd.trim();

// Group filtered files into dbless and non-dbless
const dblessFiles: string[] = [];
const otherFiles: string[] = [];
const dblessSet = new Set<string>();

for (const { file, content } of filteredFiles) {
  if (content.includes('@dbless')) {
    dblessFiles.push(file);
    dblessSet.add(file);
  } else {
    otherFiles.push(file);
  }
}

// Remove any dbless files from otherFiles to avoid duplication
const filteredOtherFiles = otherFiles.filter(file => !dblessSet.has(file));
const groups: TestGroup[] = [];

// Don't split smoke and aigw tests into groups as these suites are already small enough
if (runSpec === 'smoke' || runSpec === 'aigw') {
  // Output two groups: one for db-less tests, one for non-dbless tests
  if (dblessFiles.length > 0) {
    groups.push({ tests: dblessFiles.map(file => path.relative(gwApiTestsDir, file)), hasDbless: true });
  }
  if (filteredOtherFiles.length > 0) {
    groups.push({ tests: filteredOtherFiles.map(file => path.relative(gwApiTestsDir, file)), hasDbless: false });
  }

  // console.log the npm run command to use it GH Actions gateway-api-tests workflow
  console.log(testCmd);
  console.log(JSON.stringify(groups));
  process.exit(0);
}

/**
 * Forms test groups based on historical test durations using First-Fit Decreasing bin packing algorithm.
 * This function optimizes test parallelization by grouping tests to balance execution time across groups
 * while ensuring no group exceeds the maximum duration threshold.
 *
 * The algorithm:
 * 1. Sorts tests by duration in descending order (longest first)
 * 2. Places each test in the first group that has sufficient remaining capacity
 * 3. Creates a new group if no existing group can accommodate the test
 *
 * @param {DurationMap} durationMap - Map of test file paths to their historical execution durations in seconds
 * @param {string[]} fileTargetList - Array of absolute file paths to be grouped
 * @param {boolean} hasDbless - Flag indicating if the group contains database-less tests
 * @param {number} [maxPerGroup=MAX_DURATION_PER_GROUP] - Maximum total duration allowed per group in seconds.
 *
 * @returns {void} This function modifies the global `groups` array by pushing new test groups
 *
 * @example
 * // Group database-less test files with 15-minute duration limit
 * formTestGroupsByDuration(durationMap, dblessFiles, true, 900);
 *
 * @see {@link https://en.wikipedia.org/wiki/First-fit-decreasing_bin_packing} First-Fit Decreasing algorithm
 */

const formTestGroupsByDuration = (
  durationMap: DurationMap,
  fileTargetList: string[],
  hasDbless: boolean,
  maxPerGroup: number = MAX_DURATION_PER_GROUP,
): void => {
  const testTitles = fileTargetList.map(file => path.relative(gwApiTestsDir, file));

  // Build records only for the provided fileList (unknown specs default to 0s)
  const normalized: DurationRecord[] = testTitles.map(spec => ({
    spec,
    duration: Math.max(0, Number(durationMap[spec] ?? 0)),
  }));

  // Sort by duration descending (First-Fit Decreasing)
  normalized.sort((a, b) => b.duration - a.duration);

  // Groups with running totals to enforce cap
  const groupsPerDuration: { total: number; specs: string[] }[] = [];

  for (const { spec, duration } of normalized) {
    let placed = false;

    for (const group of groupsPerDuration) {
      if (group.total + duration <= maxPerGroup) {
        group.specs.push(spec);
        group.total += duration;
        placed = true;
        break;
      }
    }

    if (!placed) {
      groupsPerDuration.push({ total: duration, specs: [spec] });
    }
  }

  // Append formed groups to the global groups array
  groups.push(...groupsPerDuration.map(g => ({ tests: g.specs, hasDbless })));
};

// console.log the npm run command to use it GH Actions gateway-api-tests workflow
console.log(testCmd);
formTestGroupsByDuration(durationSpecFileMap, dblessFiles, true);
formTestGroupsByDuration(durationSpecFileMap, filteredOtherFiles, false);
console.log(JSON.stringify(groups));
