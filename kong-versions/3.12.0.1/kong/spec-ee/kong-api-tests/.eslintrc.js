module.exports = {
  root: true,
  env: {
    node: true,
    mocha: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  ignorePatterns: ['packages/**'],
  rules: {
    'prettier/prettier': 0,
    'no-restricted-syntax': [
      'error',
      {
        selector: "AwaitExpression[argument.type='CallExpression'][argument.callee.name='wait']",
        message: "Don't use `await wait()` due to it's flakiness, prefer `eventually`",
      },
    ],
    '@typescript-eslint/no-var-requires': 'warn',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  "overrides": [
    {
      "files": ["**/test/**/*.spec.ts"], 
      "rules": {
        "@typescript-eslint/no-non-null-assertion": "off"
      }
    },
    {
      "files": ["**/select-tests.ts"],
      "rules": {
        "no-console": ["error", { 
          "allow": ["error", "warn"] 
        }],
        "no-restricted-syntax": [
          "error",
          {
            "selector": "CallExpression[callee.object.name='console'][callee.property.name='log']",
            "message": "console.log is forbidden in select-tests.ts - use console.error for debug output to avoid breaking workflow stdout parsing"
          }
        ]
      }
    }
  ]
};
