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
 * Extending Mocha's custom spec reporter to write failed spec file names to a failed-tests.txt file
 */
class CustomSpecReporter extends Spec {
  constructor(runner, options) {
    super(runner, options);
    this.__verifyMochaInterface(runner);

    const grepPattern = runner._grep;
    const invert = runner._invert;

    this.verboseLogs = process.env.VERBOSE_RESPONSE_LOGS === 'true';

    if (isCI() || process.env.GKE === 'true') {
      // Initialize a map to track suites by their file path
      const suiteStatus = new Map(); // Key: filePath, Value: { allPassed: boolean, suites: Set, totalSuites: number }
      let totalFiles = 0;
      let passedFiles = 0;
      let failedFiles = 0;
      // Write all test file names at the beginning
      runner.on('start', () => {
        this.__log(`Start phase, Current Grep: ${grepPattern} |  Current Invert: ${invert}`);
        const allTests = this.__getTestsFromRunner(runner);

        // Initialize the suite status map for each test file
        allTests.forEach(testFile => {
          suiteStatus.set(testFile, { allPassed: true, suites: new Set(), totalSuites: 0 });
        });

        // Precompute total number of suites for each test file
        this.__precomputeTotalSuites(runner, suiteStatus);

        // Print the initial content of the suiteStatus map
        this.__log(`Initial suiteStatus Map, total Files to run ${suiteStatus.size}:`);
        suiteStatus.forEach((status, filePath) => {
          totalFiles++;
          this.__log(`File: ${filePath}, Total Suites: ${status.totalSuites}`);
        });

        // Write the initial list of tests to the file
        if (!fs.existsSync(reportFile)) {
          fs.writeFileSync(reportFile, allTests.join('\n'));
        }
      });

      // When a suite finishes, update its status and file status
      runner.on('suite end', (suite) => {
        if (suite.file) {
          const filePath = this.__normalizeFilePath(suite.file); // Normalize file path
          this.__log(`Suite finished: ${suite.title}`);
          suite.tests.forEach(test => {
            this.__log(`Test: ${test.fullTitle()} | State: ${test.state}`);
          });

          // Check if this suite passed or not (failed or undefined test states are considered failed)
          const suitePassed = suite.tests.every(test => test.state !== 'failed' && test.state !== undefined);

          // Retrieve the current status of the file
          if (suiteStatus.has(filePath)) {
            const fileStatus = suiteStatus.get(filePath);

            // Mark the file as failed if this suite did not pass
            if (!suitePassed) {
              fileStatus.allPassed = false;
            }

            // Add the suite to the list of suites for this file
            fileStatus.suites.add(suite.title);

            // If all suites in the file have finished and passed, we can remove it from the report
            const allSuitesCompleted = fileStatus.suites.size === fileStatus.totalSuites;

            if (allSuitesCompleted && fileStatus.allPassed) {
              this.__removeTestFromFile(filePath);
              this.__log(`File removed from report: ${filePath}`);
            } else {
              this.__log(`File not removed because not all suites passed: ${filePath}`);
            }
          }
        }
      });

      // On test failure, log the failed test
      runner.on('fail', (test) => {
        if (!test.file) {
          console.error(`Something went wrong that is not a regular test failure`, test.err);
          process.exit(1);
        }

        // Failed tests will remain in the file, we don't need to modify the file here
        this.__log(`This failed test will be rerun: ${test.file}`);
      });

      // After all tests finish, ensure that failed tests remain in the file
      runner.on('end', () => {
        // Print the status of all test files
        this.__log("Test run has ended, Suite Status Map at the end of the test run:");
        suiteStatus.forEach((status, filePath) => {
          this.__log(`File: ${filePath}, All Passed: ${status.allPassed}, Suites Completed: ${status.suites.size}/${status.totalSuites}`);
          if (status.allPassed) {
            passedFiles++;
          } else {
            failedFiles++;
          }
        });
        // Print the final summary of passed and failed files
        this.__log(`Test run finished: ${passedFiles} files passed, ${failedFiles} files failed out of ${totalFiles} total files.`);
      });
    }
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
    const requiredTestProperties = ['file', 'fullTitle'];

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
  
  __precomputeTotalSuites(runner, suiteStatus) {
    const __traverseForTotalSuites = (suite) => {
      if (suite.file) {
        const filePath = this.__normalizeFilePath(suite.file);
        if (suiteStatus.has(filePath)) {
          suiteStatus.get(filePath).totalSuites++;
        }
      }
      suite.suites?.forEach(__traverseForTotalSuites);
    }
    __traverseForTotalSuites(runner.suite);
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

  __getFilteredTests(suite, runner, files) {
    const __traverseForTests = (suite) => {
      suite.tests.forEach(test => {
        const invertedMatch = this.__getMatchStatus(test, runner);
          
        if (invertedMatch) {
          files.add(this.__normalizeFilePath(test.file));
        }
      });
      suite.suites?.forEach(__traverseForTests);
    };
    __traverseForTests(suite);
  }

  __getTestsFromRunner(runner) {
    const files = new Set();
    this.__getFilteredTests(runner.suite, runner, files);
    return Array.from(files);
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
      const content = fs.readFileSync(reportFile, 'utf8');
      const updatedContent = content.split('\n')
        .filter(line => line.trim() !== testFile)
        .join('\n');
      fs.writeFileSync(reportFile, updatedContent);
    } catch (error) {
      console.error(`Error updating report file: ${error.message}`);
      throw new Error(`Failed to update report file: ${error.message}`);
    }
  }
}

module.exports = CustomSpecReporter;