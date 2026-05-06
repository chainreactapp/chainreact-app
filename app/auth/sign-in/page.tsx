import Link from "next/link";
import { AuthForm } from "@/features/auth/AuthForm";
import { GoogleSignInButton } from "@/features/auth/GoogleSignInButton";
import { signIn } from "@/app/auth/actions";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex flex-col gap-6 w-full max-w-sm">
        <h1 className="text-2xl font-bold">Sign in</h1>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {decodeURIComponent(error)}
          </p>
        )}
        <GoogleSignInButton />
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <AuthForm action={signIn} submitLabel="Sign in" />
        <p className="text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/auth/sign-up" className="underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
