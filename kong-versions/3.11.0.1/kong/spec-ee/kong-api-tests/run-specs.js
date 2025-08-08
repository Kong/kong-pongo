const { spawnSync } = require('child_process');
const glob = require('glob');

// Prefer CLI arg, fallback to npm_config_spec for backward compatibility
// The following handles both the new (future-safe) CLI usage (npm run test-spec -- spec=ai-proxy)
// and the legacy npm style (npm run test-spec --spec=ai-proxy), which is still used locally by many developers.
// This ensures local workflows keep working even though CI does not use the

let specArg = process.argv.find(arg => arg.startsWith('spec=')) ||
              process.argv.find(arg => arg.startsWith('--spec='));
let specString = specArg ? specArg.replace(/^(-{0,2})spec=/, '') : null;

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

// Print the final command line to be executed
const cmd = `npx mocha ${expandedFiles.map(f => `"${f}"`).join(' ')}`;
console.log(`\nCommand to be executed:\n${cmd}\n`);

const result = spawnSync('npx', ['mocha', ...expandedFiles], { stdio: 'inherit' });
process.exit(result.status);