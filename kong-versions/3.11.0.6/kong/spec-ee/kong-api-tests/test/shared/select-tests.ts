import 'dotenv/config';
import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { isWeeklyRun } from '../../support/config/gateway-vars';

/**
 * IMPORTANT NOTE:
 * The workflow expects exactly 2 lines on stdout (testCmd + JSON), 
 * so all debug/informational output must use console.error to avoid breaking the parsing logic.
 */

/**
 * Utility that is being used to identify test files based on the RUN_SPEC environment variable
 * The identified test files are being used to split into groups and run tests in parallel
 * This script is being executed when 'npm run select-tests' is being called and in this case the tests are being collected following the logic in this file
 * For all other 'npm run' commands the logic is the same as it is in the package.json script instruction
 */

type SpecFilePath = string;
type DurationRecord = { spec: string; duration: number };
interface TestGroup {
  tests: string[];
  hasDbless: boolean;
}

// Max total duration, in seconds, allowed per group when splitting by historical durations
const MAX_DURATION_PER_GROUP = 900; // 15 minutes
const DURATION_FILE_PATH = path.join(__dirname, '../../runtimes-gateway-api-tests.json');

// Get the RUN_SPEC environment variable, default to 'smoke' if not set
const runSpec = process.env.RUN_SPEC || 'smoke';
const skipE2eTests = process.env.SKIP_E2E_TEST || '';
const testsToSkip = new Set<string>();

// Get current branch name from GitHub Actions environment
const getCurrentBranch = (): string => {
  const githubRef = process.env.GITHUB_REF || '';
  console.error(`Current GITHUB_REF is "${githubRef}"`);
  
  // Extract actual branch name by skipping Git ref prefixes
  // This handles all Git reference formats consistently:
  // - refs/heads/feature/branch-name -> feature/branch-name
  // - refs/pull/123/merge -> 123/merge
  // - refs/tags/v1.0.0 -> v1.0.0
  // - refs/remotes/origin/main -> origin/main
  if (githubRef.startsWith('refs/')) {
    const parts = githubRef.split('/');
    if (parts.length >= 3) {
      // Always skip 'refs' and the ref type (heads/pull/tags/remotes)
      return parts.slice(2).join('/');
    }
    // If malformed refs (< 3 parts), fall through to fallback
  } else {
    // If it doesn't start with 'refs/', assume it's already a clean branch name
    return githubRef;
  }
  
  // Final fallback for malformed refs or other cases
  return process.env.GITHUB_REF_NAME || 'unknown';
};

const currentBranch = getCurrentBranch();

/**
 * Parse SKIP_E2E_TEST environment variable
 * 
 * Supported formats:
 * 1. Simple comma-separated: "test1,test2,test3" (applies to all branches)
 * 2. Branch-specific with semicolons: "branch1:test1,test2;branch2:test3;all:test4"
 * 3. Mixed format: "global-test,branch1:branch-test,all:another-test"
 * 
 * Examples:
 * 
 * | Format | Example | Description |
 * |--------|---------|-------------|
 * | Global | `"service,upstreams"` | Skip service & upstreams tests on ALL branches |
 * | Branch-specific | `"master:flaky-test"` | Skip flaky-test only on master branch |
 * | Wildcard | `"next/*:ai-plugin"` | Skip ai-plugin on any next/* branch |
 * | Multiple rules | `"rbac;master:datadog"` | Skip rbac globally + datadog on master |
 * | All branches | `"all:deprecated"` | Skip deprecated test on all branches (same as global) |
 * | Complex | `"auth;feature/*:router;main:service"` | Skip auth globally + router on feature branches + service on main |
 * 
 * Branch pattern examples:
 * - `"master"` → exact match
 * - `"next/*"` → matches next/3.11.x.x, next/feature, etc.
 * - `"release/*"` → matches release/3.1, release/4.0, etc.
 * - `"all"` → matches every branch
 */
if (skipE2eTests && skipE2eTests.trim() && skipE2eTests !== 'false') {
  // First, split by semicolons to handle branch-specific rules
  const rules = skipE2eTests.split(';').map(rule => rule.trim()).filter(Boolean);
  
  rules.forEach(rule => {
    const colonIndex = rule.indexOf(':');
    
    if (colonIndex === -1) {
      // No colon found - treat as comma-separated global skips
      const testList = rule.split(',').map(test => test.trim()).filter(Boolean);
      testList.forEach(test => testsToSkip.add(test));
      if (testList.length > 0) {
        console.error(`Skipping tests globally: ${testList.join(', ')}`);
      }
    } else {
      // Colon found - branch-specific rule
      const branchPattern = rule.substring(0, colonIndex).trim();
      const tests = rule.substring(colonIndex + 1).trim();
      
      if (!branchPattern || !tests) {
        console.error(`Invalid SKIP_E2E_TEST format: "${rule}". Expected format: "branch:test1,test2"`);
        return;
      }
      
      let shouldSkip = false;
      
      if (branchPattern === 'all') {
        // Special case: skip for all branches
        shouldSkip = true;
      } else {
        // Check if current branch matches the pattern
        // Use exact match first, then fallback to regex pattern matching for wildcards
        if (currentBranch === branchPattern) {
          shouldSkip = true;
        } else {
          // For regex matching, ensure we match the full string or use wildcards intentionally
          const escapedPattern = branchPattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
          const regex = new RegExp(`^${escapedPattern}$`);
          const regexResult = currentBranch.match(regex);
          shouldSkip = Boolean(regexResult);
        }
      }
      
      if (shouldSkip) {
        const testList = tests.split(',').map(test => test.trim()).filter(Boolean);
        testList.forEach(test => testsToSkip.add(test));
        console.error(`Skipping tests on branch '${currentBranch}' due to rule '${branchPattern}:${testList.join(',')}'`);
      }
    }
  });
}

// Final summary of all tests to skip
if (testsToSkip.size > 0) {
  console.error(`Total tests to skip on branch ${currentBranch}:${Array.from(testsToSkip).join(', ')}`);
}

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
 * Check if a test file should be skipped based on SKIP_E2E_TEST environment variable
 * @param filePath - The path to the test file
 * @returns True if the file should be skipped, false otherwise
 */
const shouldSkipTestFile = (filePath: string): boolean => {
  if (testsToSkip.size === 0) {
    return false;
  }

  const fileName = path.basename(filePath, '.spec.ts');
  
  // Check for exact matches first
  if (testsToSkip.has(fileName)) {
    return true;
  }
  
  // Check for wildcard patterns
  for (const skipPattern of testsToSkip) {
    if (skipPattern === '*') {
      // Skip all tests
      return true;
    }
    
    if (skipPattern.includes('*')) {
      // Convert glob pattern to regex and test
      const escapedPattern = skipPattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
      const regex = new RegExp(`^${escapedPattern}$`);
      if (regex.test(fileName)) {
        return true;
      }
    }
  }
  
  return false;
};

/**
 * Apply SKIP_E2E_TEST filtering to remove skipped test files
 * Do the operation here before reading the file contents to optimize performance
 */
if (testsToSkip.size > 0) {
  const beforeSkipCount = specFilePaths.length;
  specFilePaths = specFilePaths.filter(filePath => !shouldSkipTestFile(filePath));
  const afterSkipCount = specFilePaths.length;
  if (beforeSkipCount > afterSkipCount) {
    console.error(`Filtered out ${beforeSkipCount - afterSkipCount} test files based on SKIP_E2E_TEST`);
  }
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

// Apply SKIP_E2E_TEST filtering to filtered files as a safety net
if (testsToSkip.size > 0) {
  filteredFiles = filteredFiles.filter(({ file }) => !shouldSkipTestFile(file));
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
  // eslint-disable-next-line no-restricted-syntax, no-console
  console.log(testCmd);
  // eslint-disable-next-line no-restricted-syntax, no-console
  console.log(JSON.stringify(groups));
  process.exit(0);
}


/**
 * 
 * Reads a JSON array from a file, supporting both legacy and current formats.
 * 
 * Example of legacy format (not a proper JSON file):
 *  {"suite":"gateway-api-tests","filename":"test/gateway/admin-api/dbless-config-sync.spec.ts","expectedDuration":3.13}
 *  {"suite":"gateway-api-tests","filename":"test/gateway/plugins/ai/ai-proxy-advanced.spec.ts","expectedDuration":311.49}
 *  {"suite":"gateway-api-tests","filename":"test/gateway/plugins/kafka-log.spec.ts","expectedDuration":384.78}
 *  ...
 * 
 * @param filename 
 * @returns Array of parsed JSON objects
 */
const readJSONArray = (filename: string) => {
  // We must be prepared for legacy format (one JSON document containing an array) and
  // for the current one-object-per-line format.
  const contents = fs.readFileSync(filename, { encoding: 'utf-8' });
  return contents[0] === '[' ? JSON.parse(contents) : contents.split('\n').map(line => JSON.parse(line));
};

/**
 * Reads the runtime info file and constructs a nested map of suite -> filename -> expectedDuration.
 * 
 * Example output:
 * {
 *  "gateway-api-tests": {
 *   "test/gateway/admin-api/dbless-config-sync.spec.ts": 3.13,
 *   "test/gateway/plugins/ai/ai-proxy-advanced.spec.ts": 311.49,
 *   ...
 *  }
 * }
 *
 * @param runtimeInfoFilename
 * @returns A nested map of suite -> filename -> expectedDuration JSON object
 */
const readRuntimeInfoFile = (runtimeInfoFilename: string) =>
  readJSONArray(runtimeInfoFilename).reduce((result, { suite, filename, expectedDuration }) => {
    result[suite] = result[suite] || {};
    result[suite][filename] = expectedDuration;
    return result;
  }, {});

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
 * @param {string} durationMapPath - Path to the JSON file containing test file paths and their historical execution durations in seconds
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
  durationMapPath: string,
  fileTargetList: string[],
  hasDbless: boolean,
  maxPerGroup: number = MAX_DURATION_PER_GROUP,
): void => {
  const testTitles = fileTargetList.map(file => path.relative(gwApiTestsDir, file));

  const durationMap = readRuntimeInfoFile(durationMapPath)["gateway-api-tests"];

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

/* 
  "select-tests" will now pull previous test durations from runtimes-gateway-api-tests.json which is stored in a
  separate repository: https://github.com/Kong/gateway-action-storage/blob/main/.ci/runtimes-gateway-api-tests.json

  If you want to run select-tests locally, make sure to download the runtimes-gateway-api-tests.json file to 
  the ./spec-ee/kong-api-tests/ directory.
*/

formTestGroupsByDuration(DURATION_FILE_PATH, dblessFiles, true);
formTestGroupsByDuration(DURATION_FILE_PATH, filteredOtherFiles, false);

// console.log the npm run command to use it GH Actions gateway-api-tests workflo
// eslint-disable-next-line no-restricted-syntax, no-console
console.log(testCmd);
// eslint-disable-next-line no-restricted-syntax, no-console
console.log(JSON.stringify(groups));