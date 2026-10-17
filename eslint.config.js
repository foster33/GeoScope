/**
 * ESLint (flat config). Recommended rules only — the goal is catching real
 * mistakes (undefined names, unused imports, unreachable code), not style
 * bikeshedding. Three environments: Node for the server and tests, the
 * browser plus the two CDN globals (Cesium, satellite.js) for public/js.
 */
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "test-results/", "playwright-report/", "data/", "docs/"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "all" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["server.js", "server/**", "lib/**", "sources/**", "watch/**", "fixtures/**", "test/**", "e2e/**", "scripts/**", "playwright.config.js", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["public/js/**"],
    languageOptions: { globals: { ...globals.browser, Cesium: "readonly", satellite: "readonly" } },
  },
];
