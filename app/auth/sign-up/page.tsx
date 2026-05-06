import Link from "next/link";
import { AuthForm } from "@/features/auth/AuthForm";
import { GoogleSignInButton } from "@/features/auth/GoogleSignInButton";
import { signUp } from "@/app/auth/actions";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex flex-col gap-6 w-full max-w-sm">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <GoogleSignInButton />
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <AuthForm action={signUp} submitLabel="Sign up" />
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
