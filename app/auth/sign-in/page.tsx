import Link from "next/link";
import { AuthForm } from "@/features/auth/AuthForm";
import { signIn } from "@/app/auth/actions";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex flex-col gap-6 w-full max-w-sm">
        <h1 className="text-2xl font-bold">Sign in</h1>
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
