import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      exclude: ["src/generated/**", "src/test-support/**"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
