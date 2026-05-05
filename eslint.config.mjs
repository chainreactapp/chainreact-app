import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

const REPO_PATTERNS = [
  "@/repositories",
  "@/repositories/**",
  "**/repositories",
  "**/repositories/**",
];
const SERVICE_PATTERNS = [
  "@/services",
  "@/services/**",
  "**/services",
  "**/services/**",
];
const SUPABASE_PATTERNS = ["@supabase/supabase-js", "@supabase/ssr"];

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "@next/next": nextPlugin,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "max-lines": [
        "warn",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // BOUNDARY: components/ may not call fetch() directly.
  {
    files: ["components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'CallExpression[callee.name="fetch"]',
          message:
            "Components must not call fetch() directly. Use a feature hook → lib/api/<domain>.ts. (project-structure-and-module-boundaries.md §4)",
        },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // BOUNDARY: stores/ no console.log.
  {
    files: ["stores/**/*.{ts,tsx}"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // BOUNDARY: features/ hooks: no console.log.
  {
    files: ["features/**/hooks/**/*.{ts,tsx}"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // BOUNDARY: client code may not import server-only modules.
  // Repositories AND services are server-side only. Client uses lib/api/.
  {
    files: [
      "features/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "stores/**/*.{ts,tsx}",
      "lib/api/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: REPO_PATTERNS,
              message:
                "Repositories are server-side only. Client code calls lib/api/<domain>.ts. (workflow-state-store.md, project-structure-and-module-boundaries.md §4)",
            },
            {
              group: SERVICE_PATTERNS,
              message:
                "Server services are not importable from client code. Use lib/api/<domain>.ts. (project-structure-and-module-boundaries.md §4)",
            },
          ],
        },
      ],
    },
  },

  // BOUNDARY: direct Supabase imports outside repositories/, core/auth/, tests/.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "repositories/**",
      "core/auth/**",
      "tests/**",
      "utils/supabase/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: SUPABASE_PATTERNS,
              message:
                "Direct Supabase imports allowed only in repositories/, core/auth/, and tests/. (project-structure-and-module-boundaries.md §10)",
            },
          ],
        },
      ],
    },
  },

  // BOUNDARY: zero-arg supabase.auth.getSession() / getUser() — PR-AUTH-7 invariant.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "core/auth/**",
      "stores/auth*.ts",
      "stores/authBootMachine.ts",
      "app/auth/**",
      "features/auth/**",
      "app/api/**",
      "middleware.ts",
      "tests/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(getSession|getUser)$/][arguments.length=0]",
          message:
            "Zero-arg auth.getSession()/getUser() forbidden outside auth subsystem. Use core/auth/getAuthHeader(). (PR-AUTH-7 invariant)",
        },
      ],
    },
  },

  // BOUNDARY: core/ purity — no app/features/components/repositories/services/stores.
  {
    files: ["core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/app",
                "@/app/**",
                "@/features",
                "@/features/**",
                "@/components",
                "@/components/**",
                "@/repositories",
                "@/repositories/**",
                "@/services",
                "@/services/**",
                "@/stores",
                "@/stores/**",
              ],
              message:
                "core/ may import only from contracts/. (project-structure-and-module-boundaries.md §4)",
            },
          ],
        },
      ],
    },
  },

  // BOUNDARY: repositories/ may not import services/ or business logic.
  {
    files: ["repositories/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: SERVICE_PATTERNS,
              message:
                "Repositories must not import services. (project-structure-and-module-boundaries.md §4)",
            },
          ],
        },
      ],
    },
  },

  // Test files: Jest globals + relax max-lines and `any`.
  {
    files: ["tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.jest, ...globals.node },
    },
    rules: {
      "max-lines": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
