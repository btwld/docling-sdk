import baseConfig from '../../tools/jest-config/base';

export default {
  ...baseConfig,
  displayName: 'core',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.test.ts'],
};
