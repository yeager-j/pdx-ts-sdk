import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["design/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["packages/sdk/tests/**/*.test-d.ts"],
    },
  },
});
