import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// FR-5.1 / Risk #1 (requirements doc): no provider SDK type may cross the
// model-gateway boundary. This rule is the enforcement mechanism, not a
// convention — provider SDK imports are only legal inside providers/.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message:
                "Provider SDK types must not cross the gateway boundary (FR-5.1). Import only inside src/gateway/providers/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/gateway/providers/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
