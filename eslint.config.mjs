import js from "@eslint/js";
import tseslint from "typescript-eslint";

// FR-5.1 / Risk #1 (requirements doc): no provider SDK type may cross the
// model-gateway boundary. This rule is the enforcement mechanism, not a
// convention — provider SDK imports are only legal inside providers/.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
);
