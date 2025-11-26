const { spawnSync } = require('child_process');
const glob = require('glob');

// Parse arguments - npm passes everything after -- as separate arguments
// Look for spec argument and collect everything else as mocha args
let specString = null;
let mochaArgs = [];

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('spec=') || arg.startsWith('--spec=')) {
    specString = arg.replace(/^(-{0,2})spec=/, '');
  } else {
    // Any argument that's not the spec becomes a mocha argument
    mochaArgs.push(arg);
  }
}

// Fallback for legacy npm style
if (!specString && process.env.npm_config_spec) {
  specString = process.env.npm_config_spec;
}

if (!specString) {
  console.error("ERROR: Please provide --spec='spec1;spec2;spec3'");
  process.exit(1);
}
if (specString.includes(',')) {
  console.error("ERROR: Use ';' to separate multiple specs, not ','");
  process.exit(1);
}
const specs = specString
  .split(';')
  .map(s => s.trim())
  .filter(Boolean);
if (!specs.length) {
  console.error('ERROR: No valid spec files found in --spec argument');
  process.exit(1);
}
console.log('Running the following spec files:');
const patterns = specs.map(s => `test/gateway/**/${s}.spec.ts`);
patterns.forEach(p => console.log(`  ${p}`));

// Expand patterns using glob (default options)
let expandedFiles = [];
let missing = [];
for (const pattern of patterns) {
  const matches = glob.sync(pattern);
  if (matches.length === 0) {
    missing.push(pattern);
  } else {
    expandedFiles.push(...matches);
  }
}
if (missing.length > 0) {
  console.error('\nERROR: The following spec patterns did not match any files:');
  missing.forEach(f => console.error(`  ${f}`));
  process.exit(2);
}

// Print additional mocha arguments if any
if (mochaArgs.length > 0) {
  console.log(`\nAdditional mocha arguments: ${mochaArgs.join(' ')}`);
}

// Print the final command line to be executed
const allArgs = [...expandedFiles.map(f => `"${f}"`), ...mochaArgs];
const cmd = `npx mocha ${allArgs.join(' ')}`;
console.log(`\nCommand to be executed:\n${cmd}\n`);

const result = spawnSync('npx', ['mocha', ...expandedFiles, ...mochaArgs], { stdio: 'inherit' });
process.exit(result.status);