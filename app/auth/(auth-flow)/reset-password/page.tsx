"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { createClient } from "@/utils/supabase/client"
import { Loader2, CheckCircle, XCircle, Lock } from "lucide-react"
import Link from "next/link"

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<{
    length?: boolean
    uppercase?: boolean
    lowercase?: boolean
    number?: boolean
    match?: boolean
  }>({})

  // Validate password in real-time
  useEffect(() => {
    if (newPassword.length === 0) {
      setValidationErrors({})
      return
    }

    const errors = {
      length: newPassword.length < 8,
      uppercase: !/[A-Z]/.test(newPassword),
      lowercase: !/[a-z]/.test(newPassword),
      number: !/[0-9]/.test(newPassword),
      match: confirmPassword.length > 0 && newPassword !== confirmPassword
    }

    setValidationErrors(errors)
  }, [newPassword, confirmPassword])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (Object.values(validationErrors).some(v => v === true)) {
      setError("Please fix the password requirements before continuing.")
      return
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.")
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (updateError) {
        throw updateError
      }

      setSuccess(true)

      // Redirect to settings after 3 seconds
      setTimeout(() => {
        router.push("/settings?tab=security&reset=success")
      }, 3000)

    } catch (err: any) {
      setError(err.message || "Failed to reset password. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <Card className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-200">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="w-6 h-6 text-green-500" />
          </div>
          <CardTitle className="text-slate-900">Password Reset Successful</CardTitle>
          <CardDescription className="text-slate-600">
            Your password has been updated successfully
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm text-slate-600">
            You're being redirected to your settings...
          </p>
          <div className="flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-200">
      <CardHeader>
        <div className="mx-auto w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-4">
          <Lock className="w-6 h-6 text-orange-500" />
        </div>
        <CardTitle className="text-center text-slate-900">Reset Your Password</CardTitle>
        <CardDescription className="text-center text-slate-600">
          Enter your new password below
        </CardDescription>
      </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                disabled={loading}
              />
            </div>

            {/* Password Requirements */}
            {newPassword.length > 0 && (
              <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                <p className="text-sm font-medium mb-2">Password Requirements:</p>
                <div className="space-y-1.5 text-sm">
                  <div className={`flex items-center gap-2 ${!validationErrors.length ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {!validationErrors.length ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-current" />
                    )}
                    <span>At least 8 characters</span>
                  </div>
                  <div className={`flex items-center gap-2 ${!validationErrors.uppercase ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {!validationErrors.uppercase ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-current" />
                    )}
                    <span>One uppercase letter</span>
                  </div>
                  <div className={`flex items-center gap-2 ${!validationErrors.lowercase ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {!validationErrors.lowercase ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-current" />
                    )}
                    <span>One lowercase letter</span>
                  </div>
                  <div className={`flex items-center gap-2 ${!validationErrors.number ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {!validationErrors.number ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-current" />
                    )}
                    <span>One number</span>
                  </div>
                  {confirmPassword.length > 0 && (
                    <div className={`flex items-center gap-2 ${!validationErrors.match ? 'text-green-600' : 'text-muted-foreground'}`}>
                      {!validationErrors.match ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-current" />
                      )}
                      <span>Passwords match</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white"
              disabled={loading || Object.values(validationErrors).some(v => v === true)}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Resetting Password...
                </>
              ) : (
                "Reset Password"
              )}
            </Button>

            <div className="text-center">
              <Link
                href="/auth/login"
                className="text-sm text-slate-600 hover:text-orange-500 transition-colors"
              >
                Back to Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <Card className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-200">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        </CardContent>
      </Card>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
