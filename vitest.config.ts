import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    // Unit tests never call the ERP. These values live here, not in the shared
    // setup file, so the real-ERP integration suite still skips without a key.
    env: {
      ERP_BASE_URL: "https://pta-erp-api.onrender.com",
      ERP_API_KEY: "unit-test-placeholder",
    },
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/shared/**/*.ts"],
      exclude: ["src/shared/database/generated/**"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
});
