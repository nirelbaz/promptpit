import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the tsup-time define for __APP_VERSION__ so .tsx screens can
  // reference it during tests without blowing up with a ReferenceError.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    globals: true,
    testTimeout: 30000,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: ["node_modules", ".claude", "dist", "test/e2e/real-world-repos.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
    },
  },
});
