import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// PR-AUTH-7: forbid client code from calling supabase.auth.getSession() /
// .getUser() directly. Use getAuthHeader() from @/lib/auth/getAuthHeader
// instead — it reads the cached token from the auth store and avoids the
// @supabase/ssr navigator-lock contention that causes UI hangs.
//
// AST selector matches anything of the shape `<x>.auth.<getSession|getUser>()`
// with NO arguments, covering both `supabase.auth.getSession()` and
// `createClient().auth.getSession()`. The zero-arg constraint deliberately
// excludes server-side token validation (`auth.getUser(jwt)` takes a bearer
// token), which uses the admin client and isn't navigator-lock-bound.
// Allowed call sites (auth subsystem, server middleware, server routes,
// sign-in UI, server components) live in the `files` list below.
const RESTRICTED_AUTH_CALL_RULE = {
  selector:
    "CallExpression[arguments.length=0][callee.property.name=/^(getSession|getUser)$/][callee.object.property.name='auth']",
  message:
    "Use getAuthHeader() from '@/lib/auth/getAuthHeader' instead of supabase.auth.getSession()/getUser(). See learning/docs/auth-reliability-refactor.md.",
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "public/**",
      "scripts/**/*.js",
      "scripts/**/*.cjs",
      "scripts/**/*.mjs",
    ],
  },
  {
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
  // PR-AUTH-7 client-auth guard: applied to the whole repo, then disabled
  // for the explicit allow-list of paths that legitimately need direct
  // supabase auth access (auth subsystem itself, server-side SSR client,
  // sign-in/sign-up UI, server route handlers, middleware).
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", RESTRICTED_AUTH_CALL_RULE],
    },
  },
  {
    files: [
      "lib/auth/**/*.ts",
      "stores/auth*.ts",
      "stores/authBootMachine.ts",
      "app/auth/**/*.ts",
      "app/auth/**/*.tsx",
      "components/auth/**/*.ts",
      "components/auth/**/*.tsx",
      // Server-side Next.js paths that use the cookie-based SSR client and
      // do NOT contend on the browser navigator-lock that the rule targets.
      "app/api/**/*.ts",
      "app/api/**/*.tsx",
      "app/(app)/**/route.ts",
      "app/actions/**/*.ts", // Next.js server actions ("use server")
      "middleware.ts",
      "lib/utils/admin-auth.ts",
      "utils/supabase/middleware.ts",
      // Server-component pages (no "use client" pragma — they run on the
      // server using the cookie-based createSupabaseServerClient). Listed
      // explicitly because path-based rules can't distinguish server- from
      // client-marked pages under `app/`. New server-component pages that
      // need to read auth should be added here; new client pages MUST use
      // getAuthHeader().
      "app/(app)/teams/**/page.tsx",
      "app/(builder)/workflows/builder/**/page.tsx",
      // Test files — they mock supabase.auth.* directly.
      "__tests__/**/*.ts",
      "__tests__/**/*.tsx",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
];

export default eslintConfig;
