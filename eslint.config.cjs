const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", ".claude/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly",
        globalThis: "readonly",
        isSavableWebUrl: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn"
    }
  },
  {
    files: ["tabdesk-core.js", "tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ["types.js"],
    languageOptions: {
      sourceType: "module"
    }
  }
];
