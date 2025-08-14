import nestjsConfig from '../../tools/jest-config/nestjs';

export default {
  ...nestjsConfig,
  displayName: 'server-e2e',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.e2e-spec.ts'],
  testTimeout: 60000,
};
