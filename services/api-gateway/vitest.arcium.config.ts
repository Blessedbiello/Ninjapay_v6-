import { defineConfig } from 'vitest/config';

/**
 * Vitest config for Arcium integration tests
 * These tests don't require the database mock setup
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // No setup file needed - Arcium tests are standalone
    include: ['tests/arcium-integration.test.ts'],
    testTimeout: 30000, // Longer timeout for network calls
  },
});
