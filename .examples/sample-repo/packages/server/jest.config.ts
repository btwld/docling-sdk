import nestjsConfig from '../../tools/jest-config/nestjs';

export default {
  ...nestjsConfig,
  displayName: 'server',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Temporarily exclude E2E tests due to ES module compatibility issues
  // testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/tests/**/*.spec.ts'],
  moduleNameMapper: {
    ...nestjsConfig.moduleNameMapper,
    '^@nest-mind/mcp-core$': '<rootDir>/../core/src',
  },
  // Add timeouts and force exit for CI
  testTimeout: 60000, // 60 seconds per test (CI can be slower)
  forceExit: true, // Force Jest to exit after tests complete
  detectOpenHandles: true, // Help identify what's keeping the process alive
  // Additional CI-specific settings
  ...(process.env.CI && {
    maxWorkers: 1, // Use single worker in CI
    workerIdleMemoryLimit: '512MB',
  }),
};
