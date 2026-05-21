/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['./test/helpers/setup.js'],
  coverageDirectory: './coverage',
  rootDir: './',
  roots: ['./test'],
  testMatch: ['**/test/**/*.spec.(ts|js)'],
  testTimeout: 60000,
  collectCoverageFrom: [
    'services/**/*.ts',
    'mixins/**/*.ts',
    'modules/**/*.ts',
    'types/**/*.ts',
    'utils/**/*.ts',
    '!**/*.d.ts',
    '!services/sentry.service.ts',
    '!**/index.ts',
  ],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
};
