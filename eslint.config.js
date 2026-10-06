import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "packages/*/dist/**",
      "node_modules/**",
      "src-tauri/**",
      "tmp/**",
    ],
  },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["react", "react-dom", "react-native", "monaco-editor", "vitest"],
          patterns: [
            {
              group: [
                "react*",
                "@tauri-apps/*",
                "@monaco-editor/*",
                "monaco*",
                "node:*",
                "fs",
                "path",
                "os",
                "crypto",
                "util",
                "events",
                "stream",
                "buffer",
                "child_process",
                "url",
                "**/src/**",
                "../../../*",
              ],
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "localStorage",
        "fetch",
        "setTimeout",
        "setInterval",
        "queueMicrotask",
        "requestAnimationFrame",
        "process",
        "Buffer",
        "require",
        "__dirname",
        "globalThis",
        "Intl",
      ],
    },
  },
  {
    files: ["packages/*/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["react", "react-dom", "react-native", "monaco-editor"],
          patterns: [
            {
              group: [
                "react*",
                "@tauri-apps/*",
                "@monaco-editor/*",
                "monaco*",
                "fs",
                "path",
                "os",
                "crypto",
                "util",
                "events",
                "stream",
                "buffer",
                "child_process",
                "url",
                "**/src/**",
                "../../../*",
                "node:*",
                "!node:fs",
                "!node:path",
              ],
            },
          ],
        },
      ],
      "no-restricted-globals": "off",
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "vite.config.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "@typescript-eslint/no-empty-object-type": "warn",
      // The legacy test suite intentionally uses broad mocks. Tighten this after
      // those fixtures have typed helpers instead of emitting hundreds of warnings.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-constant-condition": ["warn", { checkLoops: "allExceptWhileTrue" }],
      "no-control-regex": "off",
      "no-irregular-whitespace": "warn",
      "no-unsafe-finally": "warn",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/**/*.tsx"],
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
);
