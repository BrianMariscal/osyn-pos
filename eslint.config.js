import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "api/**"]
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-restricted-globals": ["error", "prompt", "confirm", "alert"],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]",
          message: "Usa setHtml() de core/html.ts en lugar de innerHTML directo."
        }
      ],
      "@typescript-eslint/no-explicit-any": "error"
    }
  },
  {
    files: ["src/core/html.ts"],
    rules: {
      "no-restricted-syntax": "off"
    }
  }
);
