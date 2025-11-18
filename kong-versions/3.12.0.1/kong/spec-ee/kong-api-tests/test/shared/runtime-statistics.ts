import * as fs from 'fs';
import * as path from 'path';
import { parseStringPromise } from 'xml2js';

interface TestCase {
  $: {
    file: string;
    time: string;
  };
  skipped?: any;
}

interface TestSuite {
  testcase?: TestCase[];
}

interface TestResults {
  testsuite?: TestSuite | TestSuite[];
  testsuites?: {
    testsuite?: TestSuite[];
  };
}

interface RuntimeRecord {
  suite: string;
  filename: string;
  duration: number;
}

const TEST_RESULTS_DIR = path.resolve(__dirname, '../../results');
const RUNTIME_TEST_FILE = 'test-runtime.json';
const SUITE_NAME = 'gateway-api-tests';

/**
 * Extracts test cases from parsed XML, handling different XML structures. This function will
 * grab a parsed test result xml file and it will extract the test cases elements and return all of them
 * under the TestCase[] type.
 * 
 * @param {TestResults} parsedXml - Parsed XML object
 * @returns {TestCase[]} Array of TestCase objects
 */
function extractTestCases(parsedXml: TestResults): TestCase[] {
  const testCases: TestCase[] = [];

  // Handle testsuite at root level
  if (parsedXml.testsuite) {
    const testsuites = Array.isArray(parsedXml.testsuite) ? parsedXml.testsuite : [parsedXml.testsuite];
    testsuites.forEach(suite => {
      if (suite.testcase) {
        testCases.push(...suite.testcase);
      }
    });
  }

  // Handle testsuites wrapper
  if (parsedXml.testsuites?.testsuite) {
    parsedXml.testsuites.testsuite.forEach(suite => {
      if (suite.testcase) {
        testCases.push(...suite.testcase);
      }
    });
  }

  return testCases;
}

/**
 * Normalizes file paths to extract test/gateway/ paths. This is needed in order to do comparisons
 * between different test suites or test result files.
 * 
 * @param {string} filePath - Original file path from test case
 * @returns {string} Normalized path or null if not under test/gateway/
 */
function normalizeFilePath(filePath: string): string | null {
  const match = filePath.match(/test\/gateway\/.*/);
  return match ? match[0] : null;
}

/**
 * Processes XML test result files and generates JSON duration statistics
 * @param resultsDir - Directory containing XML test result files (defaults to ../../results)
 * @returns Promise<void>
 *
 * File output example:
 *
 * {"suite":"gateway-api-tests","filename":"test/gateway/admin-api/dbless-config-sync.spec.ts","duration":3.13}
 * {"suite":"gateway-api-tests","filename":"test/gateway/plugins/ai/ai-proxy-advanced.spec.ts","duration":311.49}
 * {"suite":"gateway-api-tests","filename":"test/gateway/plugins/kafka-log.spec.ts","duration":384.78}
 * {"suite":"gateway-api-tests","filename":"test/gateway/plugins/acme.spec.ts","duration":8.87}
 * {"suite":"gateway-api-tests","filename":"test/gateway/admin-api/router.spec.ts","duration":45.30}
 * {"suite":"gateway-api-tests","filename":"test/gateway/admin-api/certificates.spec.ts","duration":16.58}
 * {"suite":"gateway-api-tests","filename":"test/gateway/admin-api/consumer-groups-scope.spec.ts","duration":21.74}
 * {"suite":"gateway-api-tests","filename":"test/gateway/plugins/ai/ai-semantic-cache.spec.ts","duration":18.93}
 * {"suite":"gateway-api-tests","filename":"test/gateway/plugins/kafka-consume.spec.ts","duration":239.80}
 * {"suite":"gateway-api-tests","filename":"test/gateway/plugins/ai/ai-aws-guardrails.spec.ts","duration":17.39}
 * {"suite":"gateway-api-tests","filename":"test/gateway/deck/deck-redis-config.spec.ts","duration":4.88}
 * {"suite":"gateway-api-tests","filename":"test/gateway/plugins/basic-auth-instance-name.spec.ts","duration":20.33}
 * ...
 *
 */
async function generateRuntimeStatistics(resultsDirPath?: string): Promise<void> {
  const workingDir = resultsDirPath || TEST_RESULTS_DIR;

  try {
    // Find all XML files in the results directory
    const files = fs.readdirSync(workingDir);
    const xmlFiles = files.filter(file => file.endsWith('.xml'));

    if (xmlFiles.length === 0) {
      console.log('No XML files found to read.');
      return;
    }

    const filesDurations: Record<string, Record<string, number>> = {};

    // Process each XML file
    for (const xmlFile of xmlFiles) {
      const xmlPath = path.join(workingDir, xmlFile);
      const xmlContent = fs.readFileSync(xmlPath, 'utf8');
      const fileDurations: Record<string, number> = {};

      try {
        const parsedXml = (await parseStringPromise(xmlContent)) as TestResults;

        // Extract test cases from different XML structures
        const testCases = extractTestCases(parsedXml);

        // Process each test case
        testCases.forEach(testCase => {
          const filePath = testCase.$.file;
          const duration = Math.round(parseFloat(testCase.$.time) * 100) / 100; // Round to 2 decimal places

          // Normalize to paths under test/gateway/
          const normalizedPath = normalizeFilePath(filePath);
          if (normalizedPath) {
            const currentDuration = fileDurations[normalizedPath] || 0.0;
            const newDuration = Math.round((currentDuration + duration) * 100) / 100; // Round sum to 2 decimal places
            fileDurations[normalizedPath] = newDuration;
          }
        });
      } catch (parseError) {
        console.error(`Error parsing XML file ${xmlFile}:`, parseError);
      }

      filesDurations[xmlFile] = fileDurations;
    }

    // Aggregate durations across all files
    const finalRuntimeDurations: Record<string, number> = {};

    Object.values(filesDurations).forEach(durations => {
      Object.entries(durations).forEach(([filename, duration]) => {
        const currentMax = finalRuntimeDurations[filename] || 0;
        const roundedDuration = Math.round(duration * 100) / 100; // Round to 2 decimal places
        finalRuntimeDurations[filename] = Math.max(currentMax, roundedDuration);
      });
    });

    // Write the duration statistics to JSON file
    const outputPath = path.join(workingDir, RUNTIME_TEST_FILE);

    // Transform each entry to the required format
    const runtimeRecords: string[] = Object.entries(finalRuntimeDurations).map(([filename, duration]) => {
      const record: RuntimeRecord = {
        suite: SUITE_NAME,
        filename,
        duration,
      };
      return JSON.stringify(record);
    });

    // Join with newlines to create NDJSON format
    const output = runtimeRecords.join('\n');

    // Write to file
    fs.writeFileSync(outputPath, output, 'utf8');

    console.log(`Processed ${xmlFiles.length} XML files.`);
    console.log(`Successfully wrote ${runtimeRecords.length} records to ${outputPath}`);
  } catch (error) {
    console.error('Error processing runtime statistics:', error);
    throw error;
  }
}

generateRuntimeStatistics();
