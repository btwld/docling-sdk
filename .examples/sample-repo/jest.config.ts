export default {
  projects: [
    '<rootDir>/packages/core/jest.config.ts',
    '<rootDir>/packages/server/jest.config.ts',
  ],
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    '!packages/*/src/**/*.spec.ts',
    '!packages/*/src/**/*.test.ts',
    '!packages/*/src/**/*.e2e-spec.ts',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
