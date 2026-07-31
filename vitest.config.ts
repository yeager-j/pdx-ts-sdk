import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "design/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["tests/**/*.test-d.ts"],
    },
  },
});
