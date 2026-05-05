"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, XCircle, Users, Crown, Shield, Eye, Mail } from "lucide-react"
import { LightningLoader } from '@/components/ui/lightning-loader'
import { toast } from "sonner"
import { supabase } from '@/utils/supabaseClient'

import { logger } from '@/lib/utils/logger'

// PR-AUTH-6: switched from a locally-constructed @supabase/supabase-js client
// to the SSR singleton at @/utils/supabase/client. Same auth/storage stack
// as the rest of the app — sign-up here populates the same session that
// authStore picks up via onAuthStateChange.

function InviteSignupPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [signingUp, setSigningUp] = useState(false)
  const [invitation, setInvitation] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const token = searchParams.get('token')
  const orgSlug = searchParams.get('org')

  // Form state
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [username, setUsername] = useState("")

  useEffect(() => {
    if (!token || !orgSlug) {
      setError("Invalid invitation link")
      setLoading(false)
      return
    }

    validateInvitation()
  }, [token, orgSlug])

  const validateInvitation = async () => {
    try {
      const response = await fetch(`/api/invitations/validate?token=${token}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Invalid invitation')
      }
      
      const data = await response.json()
      setInvitation(data.invitation)
      setEmail(data.invitation.email) // Pre-fill email
    } catch (error) {
      logger.error('Error validating invitation:', error)
      setError(error instanceof Error ? error.message : 'Failed to validate invitation')
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !password || !fullName || !username) {
      toast.error('Please fill in all fields')
      return
    }

    setSigningUp(true)
    try {
      // Sign up the user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            username: username
          }
        }
      })

      if (authError) {
        throw new Error(authError.message)
      }

      if (authData.user) {
        // Accept the invitation
        const response = await fetch('/api/invitations/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to accept invitation')
        }

        toast.success('Account created and invitation accepted! Welcome to ChainReact!')
        router.push('/dashboard')
      } else {
        // Email confirmation required
        toast.success('Please check your email to confirm your account, then return to this page to accept the invitation.')
      }
    } catch (error) {
      logger.error('Error signing up:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create account')
    } finally {
      setSigningUp(false)
    }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin":
        return <Crown className="w-4 h-4 text-yellow-600" />
      case "editor":
        return <Shield className="w-4 h-4 text-orange-600" />
      case "viewer":
        return <Eye className="w-4 h-4 text-gray-600" />
      default:
        return null
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin":
        return "bg-yellow-100 text-yellow-700 border-yellow-200"
      case "editor":
        return "bg-orange-100 text-orange-700 border-orange-200"
      case "viewer":
        return "bg-gray-100 text-gray-700 border-gray-200"
      default:
        return "bg-gray-100 text-gray-700 border-gray-200"
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-rose-100">
        <div className="text-center">
          <LightningLoader size="lg" color="orange" className="mx-auto mb-4" />
          <p className="text-slate-600">Validating invitation...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-rose-100">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Invalid Invitation</h2>
            <p className="text-slate-600 mb-4">{error}</p>
            <Button onClick={() => router.push('/')} className="w-full">
              Go to Homepage
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-rose-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-orange-600" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900">
            Create Your Account
          </CardTitle>
          <p className="text-slate-600">
            You've been invited to join <strong>{invitation?.organization?.name}</strong>
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-6 text-center">
            <Badge className={`flex items-center space-x-1 ${getRoleBadgeColor(invitation?.role)} mx-auto mb-4`}>
              {getRoleIcon(invitation?.role)}
              <span className="capitalize">{invitation?.role}</span>
            </Badge>
            <p className="text-sm text-slate-500">
              This invitation expires on {new Date(invitation?.expires_at).toLocaleDateString()}
            </p>
          </div>

          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                disabled
                className="bg-slate-50"
              />
              <p className="text-xs text-slate-500 mt-1">Email is pre-filled from your invitation</p>
            </div>

            <div>
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                required
              />
            </div>

            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                required
              />
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                required
                minLength={6}
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-orange-600 hover:bg-orange-700 text-white"
              disabled={signingUp}
            >
              {signingUp ? (
                <>
                  <LightningLoader size="sm" className="mr-2" />
                  Creating Account...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Create Account & Join Organization
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-slate-400">
              By creating an account, you agree to our Terms of Service and Privacy Policy.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function InviteSignupPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <InviteSignupPageContent />
    </Suspense>
  )
} 