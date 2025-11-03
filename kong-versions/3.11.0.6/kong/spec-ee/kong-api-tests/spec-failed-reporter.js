/* eslint-disable @typescript-eslint/no-var-requires */
const { Spec } = require('mocha/lib/reporters');
const fs = require('fs');
const path = require('path');
const { isCI } = require('./support/config/environment');

const DEFAULTS = {
  REPORT_FILE: 'failed-tests.txt',
  PROJECT_ROOT_MARKER: 'kong-api-tests/'
};
const reportFile = path.resolve(process.cwd(), DEFAULTS.REPORT_FILE);

/**
 * CustomSpecReporter
 * ------------------
 * Extending Mocha's custom spec reporter to write failed spec file names to a failed-tests.txt file
 * This reporter tracks all spec files containing tests that match the current Mocha grep pattern.
 * For each matching test, it records completion and pass/fail status in a fileStatus map:
 * 
 *   <spec-file>: {
 *     allPassed: true,
 *     completedTests: Set,
 *     totalTests: Set
 *   }
 * 
 * At the start, all matching spec files are listed in failed-tests.txt.
 * As tests finish, if all tracked tests in a file are completed and passed, the file is removed from failed-tests.txt.
 * 
 * Negative cases:
 * - Skipped tests or tests not matching grep are not tracked.
 * - If any test fails, the file is not removed.
 * - If beforeAll/before/beforeEach hooks fail, no tests run, so the file remains in failed-tests.txt.
 * - If afterEach hook fails, only completed tests are counted; file remains if not all tests complete.
 * - If after/afterAll hook fails, currently only test-level failures are tracked (hook failures may not mark file as failed).
 * - If process exits early, any files not fully passed remain in failed-tests.txt.
 */
class CustomSpecReporter extends Spec {
  constructor(runner, options) {
    super(runner, options);
    this.__verifyMochaInterface(runner);

    this.verboseLogs = process.env.VERBOSE_RESPONSE_LOGS === 'true';

    if (isCI() || process.env.GKE === 'true') {
      const fileStatus = new Map(); // Key: filePath, Value: { allPassed: boolean, completedTests: Set, totalTests: Set }
      let totalFiles = 0;
      let passedFiles = 0;
      let failedFiles = 0;

      runner.on('start', () => {
        const grepPattern = runner._grep;
        const invert = runner._invert;

        this.__log(`Start phase, Current Grep: ${grepPattern} |  Current Invert: ${invert}`);
        
        // Get all tests that match the grep pattern
        const matchingTests = this.__getMatchingTests(runner);
        
        // Group tests by file
        matchingTests.forEach(test => {
          const filePath = this.__normalizeFilePath(test.file);
          if (!fileStatus.has(filePath)) {
            fileStatus.set(filePath, { 
              allPassed: true, 
              completedTests: new Set(), 
              totalTests: new Set() 
            });
          }
          fileStatus.get(filePath).totalTests.add(test.fullTitle());
        });

        // Log initial status
        this.__log(`Initial fileStatus Map, total Files to run ${fileStatus.size}:`);
        fileStatus.forEach((status, filePath) => {
          totalFiles++;
          this.__log(`File: ${filePath}, Total Tests: ${status.totalTests.size}`);
          status.totalTests.forEach(testTitle => {
            this.__log(`  - ${testTitle}`);
          });
        });

        // Write the initial list of files to the report
        const filesToTrack = Array.from(fileStatus.keys());
        if (!fs.existsSync(reportFile)) {
          fs.writeFileSync(reportFile, filesToTrack.join('\n'));
        }
      });

      // Track test completion (pass/fail/skip)
      runner.on('test end', (test) => {
        const filePath = this.__normalizeFilePath(test.file);
        const testTitle = test.fullTitle();
        
        if (fileStatus.has(filePath)) {
          const status = fileStatus.get(filePath);
          
          if (status.totalTests.has(testTitle)) {

            // Mark test as completed
            status.completedTests.add(testTitle);
            
            // Mark file as failed if this test failed
            if (test.state === 'failed') {
              this.__log(`  - MARKING FILE AS FAILED due to test: "${testTitle}"`);
              status.allPassed = false;
            }
                        
            // Check if all tests in this file are completed
            const allTestsCompleted = status.completedTests.size === status.totalTests.size;
            this.__log(`  - allTestsCompleted: ${allTestsCompleted}`);
            this.__log(`  - shouldRemove: ${allTestsCompleted && status.allPassed}`);
            
            if (allTestsCompleted && status.allPassed) {
              this.__removeTestFromFile(filePath);
              this.__log(`File removed from report: ${filePath}`);
            } else if (allTestsCompleted && !status.allPassed) {
              this.__log(`File not removed because tests failed: ${filePath}`);
            } else {
              this.__log(`File not removed because not all tests completed: ${filePath}`);
            }
          } else {
            this.__log(`Test "${testTitle}" not in expected tests for file ${filePath} (filtered out by grep)`);
          }
        } else {
          this.__log(`ERROR: File ${filePath} not found in fileStatus map!`);
        }
      });

      // Handle test failures
      runner.on('fail', (test) => {
        if (!test.file) {
          this.__log(`WARNING: Test failure without file property. Type: ${test.type}, Title: ${test.title}`);
        }

        if (test.type === 'hook') {
          this.__log(`HOOK FAILURE: ${test.title} in ${test.file}`);
        } else if (test.type === 'test') {
          this.__log(`TEST FAILURE: ${test.fullTitle()} in ${test.file}`);
          this.__log(`This failed test will be rerun: ${test.file}`);
        }
        
      });

      // Final summary
      runner.on('end', () => {
        this.__log("Test run has ended, File Status Map at the end of the test run:");
        fileStatus.forEach((status, filePath) => {
          this.__log(`File: ${filePath}, All Passed: ${status.allPassed}, Tests Completed: ${status.completedTests.size}/${status.totalTests.size}`);
          if (status.allPassed && status.completedTests.size === status.totalTests.size) {
            passedFiles++;
          } else {
            failedFiles++;
          }
        });
        this.__log(`Test run finished: ${passedFiles} files passed, ${failedFiles} files failed out of ${totalFiles} total files.`);
      });
    }
  }

  //get all tests that match the grep pattern
  __getMatchingTests(runner) {
    const matchingTests = [];
    
    const __traverseForMatchingTests = (suite) => {
      suite.tests.forEach(test => {
        const matchesGrep = this.__getMatchStatus(test, runner);
        if (matchesGrep) {
          matchingTests.push(test);
        }
      });
      suite.suites?.forEach(__traverseForMatchingTests);
    };
    
    __traverseForMatchingTests(runner.suite);
    return matchingTests;
  }

  __log(message) {
    if (this.verboseLogs) {
      console.log(message); // Print debug logs if verbose mode is enabled
    } else {
      // Print only important logs if verbose mode is disabled
      if (message.includes('failed') || message.includes('removed from report') || message.includes('Test run finished')) {
        console.log(message);
      }
    }
  }

  __verifyMochaInterface(runner) {
    const requiredProperties = ['suite', '_grep', '_invert'];
    const requiredSuiteProperties = ['file', 'tests', 'root'];
    const requiredTestProperties = ['file', 'fullTitle', 'type'];

    // Check for required properties in the runner object
    requiredProperties.forEach(prop => {
        if (!(prop in runner)) {
            console.error(`Missing required Mocha runner property: ${prop}`);
            process.exit(1); // Fail the job
        }
    });

    // Recursive function to traverse and check suites and their tests
    const __checkSuite = (suite) => {
        if (!suite.root) {
            requiredSuiteProperties.forEach(prop => {
                if (!(prop in suite)) {
                    console.error(`Missing required suite property: ${prop}`);
                    process.exit(1); // Fail the job
                }
            });
        }

        // Check if suite has tests and validate the test properties
        if (suite.tests) {
            suite.tests.forEach(test => {
                requiredTestProperties.forEach(prop => {
                    if (!(prop in test)) {
                        console.error(`Missing required test property: ${prop}`);
                        process.exit(1); // Fail the job
                    }
                });
            });
        }

        // Recursively check nested suites (if any)
        if (suite.suites) {
            suite.suites.forEach(subSuite => __checkSuite(subSuite));
        }
    };

    // Start checking from the root suite
    __checkSuite(runner.suite);
}
  
  __getMatchStatus(test, runner) {
    try {
      const matchesGrep = runner._grep.test(test.fullTitle());
      return runner._invert ? !matchesGrep : matchesGrep;
    } catch (error) {
      console.error('Error evaluating grep pattern:', error.message);
      process.exit(1);
    }
  }

  __normalizeFilePath(filePath) {
    if (!filePath || !filePath.includes(DEFAULTS.PROJECT_ROOT_MARKER)) {
      console.error(`Invalid or unexpected file path: ${filePath}`);
      process.exit(1); // Fail the job
    }
    return filePath.split(DEFAULTS.PROJECT_ROOT_MARKER).pop();
  }

  __removeTestFromFile(testFile) {
  try {
    this.__log(`=== REMOVING FILE FROM REPORT ===`);
    this.__log(`Attempting to remove: ${testFile}`);
    
    const content = fs.readFileSync(reportFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    this.__log(`Report file before removal has ${lines.length} lines:`);
    lines.forEach((line, index) => {
      this.__log(`  ${index + 1}: ${line}`);
    });
    
    const updatedLines = lines.filter(line => line.trim() !== testFile);
    this.__log(`Report file after removal has ${updatedLines.length} lines:`);
    updatedLines.forEach((line, index) => {
      this.__log(`  ${index + 1}: ${line}`);
    });
    
    const updatedContent = updatedLines.join('\n');
    fs.writeFileSync(reportFile, updatedContent);
    this.__log(`Successfully removed ${testFile} from report file`);
    this.__log(`=== FILE REMOVAL COMPLETE ===\n`);
  } catch (error) {
    console.error(`Error updating report file: ${error.message}`);
    throw new Error(`Failed to update report file: ${error.message}`);
  }
}
}

module.exports = CustomSpecReporter;