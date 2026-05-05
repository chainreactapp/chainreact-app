"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, XCircle, Users, Crown, Shield, Eye, LogIn, UserPlus } from "lucide-react"
import { LightningLoader } from '@/components/ui/lightning-loader'
import { toast } from "sonner"
import { useAuthStore } from '@/stores/authStore'

import { logger } from '@/lib/utils/logger'

// PR-AUTH-6: removed the locally-constructed @supabase/supabase-js client.
// That client used a different cookie/storage stack from the SSR singleton
// at @/utils/supabase/client and didn't share auth state with the rest of
// the app. We now read login state from the cached Zustand authStore — the
// same source the rest of the app uses, so a logged-in user landing on an
// invite link is recognized immediately.

function InvitePageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [invitation, setInvitation] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [autoAccepting, setAutoAccepting] = useState(false)

  const token = searchParams.get('token')
  const orgSlug = searchParams.get('org')

  useEffect(() => {
    if (!token || !orgSlug) {
      setError("Invalid invitation link")
      setLoading(false)
      return
    }

    checkAuthAndValidate()
  }, [token, orgSlug])

  const checkAuthAndValidate = async () => {
    try {
      // PR-AUTH-6: read login state from cached auth store (no lock).
      const userIsLoggedIn = !!useAuthStore.getState().user
      setIsLoggedIn(userIsLoggedIn)

      // Validate invitation
      const response = await fetch(`/api/invitations/validate?token=${token}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Invalid invitation')
      }
      
      const data = await response.json()
      setInvitation(data.invitation)

      // If user is logged in and we have a valid invitation, auto-accept it
      if (userIsLoggedIn && data.invitation) {
        await autoAcceptInvitation()
      }
    } catch (error) {
      logger.error('Error validating invitation:', error)
      setError(error instanceof Error ? error.message : 'Failed to validate invitation')
    } finally {
      setLoading(false)
    }
  }

  const autoAcceptInvitation = async () => {
    try {
      setAutoAccepting(true)
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to accept invitation')
      }

      const result = await response.json()
      toast.success(result.message || 'Successfully joined the organization!')
      
      // Redirect to the organization page
      router.push(`/teams/${result.organization.slug}`)
    } catch (error) {
      logger.error('Error auto-accepting invitation:', error)
      // Don't show error toast for auto-accept, just let user manually accept
      setAutoAccepting(false)
    }
  }

  const acceptInvitation = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to accept invitation')
      }

      const result = await response.json()
      toast.success(result.message || 'Successfully joined the organization!')
      
      // Redirect to the organization page
      router.push(`/teams/${result.organization.slug}`)
    } catch (error) {
      logger.error('Error accepting invitation:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to accept invitation')
    } finally {
      setLoading(false)
    }
  }

  const handleSignIn = () => {
    // Redirect to login with return URL to this invitation
    const returnUrl = encodeURIComponent(window.location.href)
    router.push(`/auth/login?returnUrl=${returnUrl}`)
  }

  const handleSignUp = () => {
    // Redirect to signup with return URL to this invitation
    const returnUrl = encodeURIComponent(window.location.href)
    router.push(`/auth/register?returnUrl=${returnUrl}`)
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

  if (loading || autoAccepting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-rose-100">
        <div className="text-center">
          <LightningLoader size="lg" color="orange" className="mx-auto mb-4" />
          <p className="text-slate-600">
            {autoAccepting ? 'Joining organization...' : 'Validating invitation...'}
          </p>
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
            You're Invited!
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <p className="text-slate-600 mb-4">
              You've been invited to join <strong>{invitation?.organization?.name}</strong> on ChainReact.
            </p>
            
            <div className="flex items-center justify-center space-x-2 mb-4">
              <Badge className={`flex items-center space-x-1 ${getRoleBadgeColor(invitation?.role)}`}>
                {getRoleIcon(invitation?.role)}
                <span className="capitalize">{invitation?.role}</span>
              </Badge>
            </div>

            <p className="text-sm text-slate-500">
              This invitation expires on {new Date(invitation?.expires_at).toLocaleDateString()}
            </p>
          </div>

          {isLoggedIn ? (
            // User is logged in - show accept button (fallback in case auto-accept failed)
            <div className="space-y-3">
              <Button
                onClick={acceptInvitation}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <LightningLoader size="sm" className="mr-2" />
                    Accepting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Accept Invitation
                  </>
                )}
              </Button>
              
              <Button 
                variant="outline" 
                onClick={() => router.push('/')} 
                className="w-full"
              >
                Decline
              </Button>
            </div>
          ) : (
            // User is not logged in - show sign in/sign up options
            <div className="space-y-3">
              <div className="text-center mb-4">
                <p className="text-sm text-slate-600 mb-3">
                  To accept this invitation, you'll need to sign in to your account or create a new one.
                </p>
              </div>
              
              <Button
                onClick={handleSignIn}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Sign In to Accept
              </Button>
              
              <Button 
                variant="outline"
                onClick={handleSignUp}
                className="w-full"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Create Account & Accept
              </Button>
              
              <Button 
                variant="ghost" 
                onClick={() => router.push('/')} 
                className="w-full text-slate-500"
              >
                Decline
              </Button>
            </div>
          )}

          <div className="text-center">
            <p className="text-xs text-slate-400">
              {isLoggedIn 
                ? "By accepting this invitation, you'll be added to the organization and can start collaborating with the team."
                : "After signing in or creating an account, you'll be automatically added to the organization."
              }
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <InvitePageContent />
    </Suspense>
  )
} 