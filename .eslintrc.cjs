/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist/", "node_modules/", "dashboard/dist/"],
  rules: {
    "react-refresh/only-export-components": "warn",
    "@typescript-eslint/no-explicit-any": "error",
  },
  overrides: [
    {
      files: ["packages/core/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["react", "react-dom", "react-*"],
                message: "packages/core must stay framework-agnostic -- no React imports (ADR-0005)",
              },
              {
                group: ["**/*.css", "**/*.module.css"],
                message: "packages/core must stay framework-agnostic -- no CSS imports (ADR-0005)",
              },
            ],
            paths: [
              {
                name: "react",
                message: "packages/core must stay framework-agnostic (ADR-0005)",
              },
              {
                name: "react-dom",
                message: "packages/core must stay framework-agnostic (ADR-0005)",
              },
            ],
          },
        ],
      },
    },
  ],
};
