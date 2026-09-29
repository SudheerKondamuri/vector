import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/escrow.ts", "lib/pilot-ledger.ts", "lib/pilot-eligibility.ts", "lib/pilot-server/**/*.ts", "lib/pilot-verifier/**/*.ts", "components/pilot/workspace-validation.tsx"],
      exclude: ["**/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 }
    }
  }
});
