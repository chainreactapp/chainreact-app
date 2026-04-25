"use client"

import { useRef, useState, type ChangeEvent, useEffect } from "react"
import { useAuthStore } from "@/stores/authStore"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/utils/supabaseClient"
import { User, Bell, Shield, ShieldCheck, ShieldOff, Palette, Loader2, Sparkles, Camera, Key, Fingerprint, Monitor, LogOut } from "lucide-react"
import { useTheme } from "next-themes"
import { TwoFactorSetup } from "@/components/settings/TwoFactorSetup"
import { SessionManagement } from "@/components/settings/SessionManagement"
import { useSearchParams } from "next/navigation"
import { useSignedAvatarUrl } from "@/hooks/useSignedAvatarUrl"
import { useWorkspaces } from "@/hooks/useWorkspaces"

interface SettingsContentProps {
  initialSection?: string
}

export function SettingsContent({ initialSection }: SettingsContentProps) {
  const { profile, updateProfile, user } = useAuthStore()
  const { toast } = useToast()
  const supabase = createClient()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Account form state
  const [fullName, setFullName] = useState(profile?.full_name || "")
  const [accountSaving, setAccountSaving] = useState(false)

  // Notification state
  const [notifications, setNotifications] = useState({
    email: false,
    slack: false,
    workflow_success: true,
    workflow_failure: true,
    weekly_digest: false
  })
  const [notificationsLoading, setNotificationsLoading] = useState(true)
  const [notificationsSaving, setNotificationsSaving] = useState(false)

  // Slack notification connection state
  const [slackConnection, setSlackConnection] = useState<{
    connected: boolean
    team_name?: string
    channel_id?: string
    channel_name?: string
    channels?: { id: string; name: string }[]
  }>({ connected: false })
  const [slackLoading, setSlackLoading] = useState(false)
  const [slackChannelSaving, setSlackChannelSaving] = useState(false)

  const [newEmail, setNewEmail] = useState("")
  const [emailChanging, setEmailChanging] = useState(false)
  const [showEmailChange, setShowEmailChange] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const displayAvatarUrl = previewUrl || profile?.avatar_url
  const { signedUrl: avatarSignedUrl } = useSignedAvatarUrl(displayAvatarUrl)
  const [show2FASetup, setShow2FASetup] = useState(false)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [twoFactorLoading, setTwoFactorLoading] = useState(true)

  // Default workspace state
  const { workspaces } = useWorkspaces()
  const { updateDefaultWorkspace, clearDefaultWorkspace } = useAuthStore()
  const [defaultWorkspaceValue, setDefaultWorkspaceValue] = useState<string>("")
  const [savingDefaultWorkspace, setSavingDefaultWorkspace] = useState(false)

  // Workflow creation preferences state
  const [workflowCreationMode, setWorkflowCreationMode] = useState<'default' | 'ask' | 'follow_switcher'>(
    profile?.workflow_creation_mode || 'ask'
  )
  const [defaultWorkspaceForCreation, setDefaultWorkspaceForCreation] = useState<string>(
    profile?.default_workspace_type
      ? `${profile.default_workspace_type}:${profile.default_workspace_id || ''}`
      : 'personal:'
  )
  const [savingPreferences, setSavingPreferences] = useState(false)

  const searchParams = useSearchParams()

  useEffect(() => {
    setMounted(true)
    setTwoFactorLoading(false)
  }, [])

  // Handle Slack OAuth callback redirect
  useEffect(() => {
    if (searchParams.get('slack_connected') === 'true') {
      toast({ title: "Slack connected", description: "Slack notifications are now enabled." })
      // Reload notification prefs to pick up new Slack config
      const reload = async () => {
        try {
          const response = await fetch('/api/notifications/preferences')
          if (response.ok) {
            const data = await response.json()
            if (data.preferences) setNotifications(prev => ({ ...prev, ...data.preferences }))
            if (data.slack) setSlackConnection(data.slack)
          }
        } catch (e) { /* ignore */ }
      }
      reload()
      // Clean URL
      window.history.replaceState({}, '', '/settings')
    }
    if (searchParams.get('slack_error')) {
      toast({ title: "Slack connection failed", description: "Could not connect Slack. Please try again.", variant: "destructive" })
      window.history.replaceState({}, '', '/settings')
    }
  }, [searchParams, toast])

  // Scroll to section on mount if initialSection is provided
  useEffect(() => {
    if (initialSection && mounted) {
      const el = document.getElementById(`section-${initialSection}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [initialSection, mounted])

  // Sync default workspace value from profile, default to personal
  useEffect(() => {
    if (profile?.default_workspace_type) {
      const value = `${profile.default_workspace_type}:${profile.default_workspace_id || ''}`
      setDefaultWorkspaceValue(value)
    } else {
      setDefaultWorkspaceValue("personal:")
    }
  }, [profile?.default_workspace_type, profile?.default_workspace_id])

  // Clear preview when profile avatar_url changes
  useEffect(() => {
    if (profile?.avatar_url && previewUrl && !avatarUploading) {
      const currentPreviewUrl = previewUrl
      const timer = setTimeout(() => {
        if (currentPreviewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(currentPreviewUrl)
        }
        setPreviewUrl(null)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [profile?.avatar_url, previewUrl, avatarUploading])

  // Sync fullName from profile
  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name)
  }, [profile?.full_name])

  // Load notification preferences on mount
  useEffect(() => {
    const loadNotificationPrefs = async () => {
      try {
        const response = await fetch('/api/notifications/preferences')
        if (response.ok) {
          const data = await response.json()
          if (data.preferences) {
            setNotifications(prev => ({ ...prev, ...data.preferences }))
          }
          if (data.slack) {
            setSlackConnection(data.slack)
            if (data.slack.connected) {
              setNotifications(prev => ({ ...prev, slack: true }))
            }
          }
        }
      } catch (error) {
        // Defaults are fine if fetch fails
      } finally {
        setNotificationsLoading(false)
      }
    }
    loadNotificationPrefs()
  }, [])

  // Save account profile
  const handleSaveAccount = async () => {
    setAccountSaving(true)
    try {
      await updateProfile({ full_name: fullName.trim() })
      toast({ title: "Profile updated", description: "Your account details have been saved." })
    } catch (error) {
      toast({ title: "Error", description: "Failed to save profile. Please try again.", variant: "destructive" })
    } finally {
      setAccountSaving(false)
    }
  }

  const handleCancelAccount = () => {
    setFullName(profile?.full_name || "")
  }

  // Save notification preferences
  const handleSaveNotifications = async () => {
    setNotificationsSaving(true)
    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: notifications }),
      })
      if (!response.ok) throw new Error('Failed to save')
      toast({ title: "Preferences saved", description: "Your notification settings have been updated." })
    } catch (error) {
      toast({ title: "Error", description: "Failed to save notification preferences.", variant: "destructive" })
    } finally {
      setNotificationsSaving(false)
    }
  }

  // Slack connect flow
  const handleConnectSlack = async () => {
    setSlackLoading(true)
    try {
      const response = await fetch('/api/notifications/slack/connect')
      if (!response.ok) throw new Error('Failed to start Slack connection')
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to start Slack connection.", variant: "destructive" })
      setSlackLoading(false)
    }
  }

  const handleDisconnectSlack = async () => {
    setSlackLoading(true)
    try {
      const response = await fetch('/api/notifications/slack/connect', { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to disconnect')
      setSlackConnection({ connected: false })
      setNotifications(prev => ({ ...prev, slack: false }))
      toast({ title: "Slack disconnected", description: "Slack notifications have been disabled." })
    } catch (error) {
      toast({ title: "Error", description: "Failed to disconnect Slack.", variant: "destructive" })
    } finally {
      setSlackLoading(false)
    }
  }

  const handleSlackChannelChange = async (channelId: string) => {
    setSlackChannelSaving(true)
    try {
      const response = await fetch('/api/notifications/slack/channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId }),
      })
      if (!response.ok) throw new Error('Failed to update channel')
      const channel = slackConnection.channels?.find(c => c.id === channelId)
      setSlackConnection(prev => ({ ...prev, channel_id: channelId, channel_name: channel?.name }))
      toast({ title: "Channel updated", description: `Notifications will be sent to #${channel?.name || channelId}` })
    } catch (error) {
      toast({ title: "Error", description: "Failed to update Slack channel.", variant: "destructive" })
    } finally {
      setSlackChannelSaving(false)
    }
  }

  const check2FAStatus = async () => {
    try {
      setTwoFactorLoading(true)
      const response = await fetch('/api/auth/2fa/status')
      if (response.ok) {
        const data = await response.json()
        setTwoFactorEnabled(data.enabled)
      }
    } catch (error) {
      console.error('Error checking 2FA status:', error)
    } finally {
      setTwoFactorLoading(false)
    }
  }

  // Load 2FA status on mount
  useEffect(() => {
    check2FAStatus()
  }, [])

  const handle2FASuccess = () => {
    setTwoFactorEnabled(true)
    check2FAStatus()
  }

  const disable2FA = async () => {
    try {
      const response = await fetch('/api/auth/2fa/status')
      if (!response.ok) return

      const data = await response.json()
      const factor = data.factors?.[0]
      if (!factor) return

      const disableResponse = await fetch('/api/auth/2fa/unenroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factor_id: factor.id }),
      })

      if (disableResponse.ok) {
        setTwoFactorEnabled(false)
        toast({ title: "2FA disabled", description: "Two-factor authentication has been turned off" })
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to disable 2FA", variant: "destructive" })
    }
  }

  const handleDefaultWorkspaceChange = async (value: string) => {
    try {
      setSavingDefaultWorkspace(true)

      if (!value) {
        await clearDefaultWorkspace()
        toast({ title: "Success", description: "Default workspace cleared" })
      } else {
        const [workspaceType, workspaceId] = value.split(':')
        await updateDefaultWorkspace(
          workspaceType as 'personal' | 'team' | 'organization',
          workspaceId || null
        )

        const selectedWorkspace = workspaces.find((w: any) =>
          w.type === workspaceType && (w.id || '') === (workspaceId || '')
        )
        toast({ title: "Success", description: `Default workspace set to ${selectedWorkspace?.name || 'selected workspace'}` })
      }

      setDefaultWorkspaceValue(value)
    } catch (error) {
      console.error('Error updating default workspace:', error)
      toast({ title: "Error", description: "Failed to update default workspace", variant: "destructive" })
    } finally {
      setSavingDefaultWorkspace(false)
    }
  }

  const handleClearDefaultWorkspace = async () => {
    try {
      setSavingDefaultWorkspace(true)
      await clearDefaultWorkspace()
      setDefaultWorkspaceValue("")
      toast({ title: "Success", description: "Default workspace cleared" })
    } catch (error) {
      console.error('Error clearing default workspace:', error)
      toast({ title: "Error", description: "Failed to clear default workspace", variant: "destructive" })
    } finally {
      setSavingDefaultWorkspace(false)
    }
  }

  const handleSaveWorkflowPreferences = async () => {
    setSavingPreferences(true)
    try {
      const [workspaceType, workspaceId] = defaultWorkspaceForCreation.split(':')

      await updateProfile({
        workflow_creation_mode: workflowCreationMode,
        default_workspace_type: workflowCreationMode === 'default' ? (workspaceType as 'personal' | 'team' | 'organization') : profile?.default_workspace_type || null,
        default_workspace_id: workflowCreationMode === 'default' ? (workspaceId || null) : profile?.default_workspace_id || null
      })

      toast({ title: "Preferences saved", description: "Your workflow creation preferences have been updated" })
    } catch (error) {
      console.error('Error saving preferences:', error)
      toast({ title: "Error", description: "Failed to save preferences", variant: "destructive" })
    } finally {
      setSavingPreferences(false)
    }
  }

  const handleAvatarButtonClick = () => {
    avatarInputRef.current?.click()
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const maxSizeBytes = 1.5 * 1024 * 1024
    const maxDimension = 1024
    if (!file.type.startsWith("image/")) {
      setAvatarError("Please choose a valid image file (PNG, JPG, or GIF).")
      event.target.value = ""
      return
    }

    if (file.size > maxSizeBytes) {
      setAvatarError("Image is too large. Please upload a file smaller than 1.5MB.")
      event.target.value = ""
      return
    }

    setAvatarError(null)
    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)

    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.width, height: img.height })
        img.onerror = () => reject(new Error("Unable to read image dimensions."))
        img.src = objectUrl
      })

      if (dimensions.width > maxDimension || dimensions.height > maxDimension) {
        setAvatarError(`Please upload an image up to ${maxDimension}x${maxDimension} pixels.`)
        setPreviewUrl(null)
        URL.revokeObjectURL(objectUrl)
        event.target.value = ""
        return
      }
    } catch (imageError: any) {
      setAvatarError(imageError?.message || "Unable to validate image size. Please try another file.")
      setPreviewUrl(null)
      URL.revokeObjectURL(objectUrl)
      event.target.value = ""
      return
    }

    setAvatarUploading(true)
    const userId = profile?.id || user?.id

    if (!userId) {
      setAvatarError("Unable to determine user identity. Please refresh and try again.")
      setAvatarUploading(false)
      event.target.value = ""
      return
    }

    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg"
    const fileName = `avatar-${Date.now()}.${extension}`
    const filePath = `${userId}/${fileName}`

    try {
      const { error: uploadError } = await supabase.storage
        .from("user-avatars")
        .upload(filePath, file, { cacheControl: "3600", upsert: true, contentType: file.type })

      if (uploadError) {
        setAvatarError(uploadError.message || "Failed to upload avatar. Please try again.")
        return
      }

      if (profile?.avatar_url?.includes("/user-avatars/")) {
        const [, path] = profile.avatar_url.split("/user-avatars/")
        if (path) await supabase.storage.from("user-avatars").remove([path]).catch(() => {})
      }

      const { data: publicUrlData } = supabase.storage.from("user-avatars").getPublicUrl(filePath)
      const newAvatarUrl = publicUrlData?.publicUrl
      if (!newAvatarUrl) {
        setAvatarError("Unable to retrieve public URL for avatar.")
        setPreviewUrl(null)
        URL.revokeObjectURL(objectUrl)
        return
      }

      const cacheBustedUrl = `${newAvatarUrl}?t=${Date.now()}`
      await updateProfile({ avatar_url: cacheBustedUrl })
      toast({ title: "Profile photo updated", description: "Your new avatar will appear across the app." })
    } catch (error: any) {
      setAvatarError(error.message || "Unexpected error while updating avatar.")
      setPreviewUrl(null)
      URL.revokeObjectURL(objectUrl)
    } finally {
      setAvatarUploading(false)
      event.target.value = ""
    }
  }

  const handleEmailChange = async () => {
    if (!newEmail || !newEmail.includes('@')) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" })
      return
    }
    setEmailChanging(true)
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail })
      if (error) throw error
      toast({
        title: "Confirmation email sent",
        description: `We've sent a confirmation link to ${newEmail}. Please check your inbox to verify the change.`,
        duration: 8000,
      })
      setShowEmailChange(false)
      setNewEmail("")
    } catch (error: any) {
      toast({ title: "Failed to update email", description: error.message || "Please try again.", variant: "destructive" })
    } finally {
      setEmailChanging(false)
    }
  }

  return (
    <>
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Account</h1>
        <p className="text-sm text-gray-500 dark:text-gray-200 mt-1">Manage your profile, notifications, and account settings.</p>
      </div>

      <div className="space-y-6 pb-16">

        {/* ═══════════ Profile ═══════════ */}
        <Card id="section-account">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Profile</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">Your personal information associated with this account.</p>

            <div className="space-y-5">
              {/* Avatar upload */}
              <div className="flex items-center gap-4">
                <div className="relative group">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-muted border-2 border-border">
                    {avatarSignedUrl ? (
                      <img src={avatarSignedUrl} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-lg font-semibold">
                        {(profile?.full_name || user?.email || "?")[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleAvatarButtonClick}
                    disabled={avatarUploading}
                    aria-label={avatarUploading ? "Uploading profile photo" : "Change profile photo"}
                    className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    {avatarUploading ? (
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    ) : (
                      <Camera className="w-5 h-5 text-white" />
                    )}
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">Profile photo</p>
                  <p className="text-xs text-muted-foreground">Click to upload. PNG, JPG, or GIF. Max 1.5MB.</p>
                  {avatarError && <p className="text-xs text-red-500 mt-1">{avatarError}</p>}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="full-name" className="text-sm font-medium">Full name</Label>
                <Input
                  id="full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
            </div>

            <div className="flex justify-end mt-5">
              <Button onClick={handleSaveAccount} disabled={accountSaving} className="bg-orange-500 text-white hover:bg-orange-600">
                {accountSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save profile
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ═══════════ Email Address ═══════════ */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Email Address</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">The email address used to sign in to your account.</p>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{profile?.email || user?.email}</p>
                <p className="text-xs text-muted-foreground">Current email address</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowEmailChange(!showEmailChange)}>
                {showEmailChange ? "Cancel" : "Change email"}
              </Button>
            </div>

            {showEmailChange && (
              <div className="flex items-center gap-3 mt-4">
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="New email address"
                  className="flex-1"
                />
                <Button size="sm" onClick={handleEmailChange} disabled={emailChanging || !newEmail}>
                  {emailChanging ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══════════ Password ═══════════ */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Password</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">Manage your account password.</p>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Reset your password</p>
                <p className="text-xs text-muted-foreground">We&apos;ll send a password reset link to your email address.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const response = await fetch('/api/auth/send-reset', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: user?.email })
                    })
                    if (response.ok) {
                      toast({ title: "Password reset email sent", description: `We've sent a reset link to ${user?.email}.`, duration: 6000 })
                    } else {
                      toast({ title: "Failed to send reset email", description: "Please try again.", variant: "destructive" })
                    }
                  } catch (error) {
                    toast({ title: "Error", description: "Something went wrong.", variant: "destructive" })
                  }
                }}
              >
                Send reset link
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ═══════════ Security ═══════════ */}
        <Card id="section-security">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Security</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">Protect your account with two-factor authentication and passkeys.</p>

            {/* 2FA */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-500" />
                <h3 className="text-sm font-semibold">Two-Factor Authentication</h3>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldOff className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{twoFactorEnabled ? 'Enabled' : 'Not enabled'}</p>
                    <p className="text-xs text-muted-foreground">
                      {twoFactorEnabled ? 'Your account is protected with 2FA.' : 'Your account is not protected with 2FA.'}
                    </p>
                  </div>
                </div>
                {twoFactorLoading ? (
                  <Button variant="outline" size="sm" disabled><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading</Button>
                ) : twoFactorEnabled ? (
                  <Button variant="outline" size="sm" onClick={disable2FA}>Disable 2FA</Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setShow2FASetup(true)}>Enable 2FA</Button>
                )}
              </div>
            </div>

            <div className="border-t my-5" />

            {/* Passkeys & Security Keys */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Passkeys & Security Keys</h3>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                >
                  + Add Passkey
                </Button>
              </div>

              <div className="border border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center">
                <Key className="w-5 h-5 text-muted-foreground mb-2" />
                <p className="text-sm font-medium text-foreground">No passkeys registered</p>
                <p className="text-xs text-muted-foreground">Add a hardware key (YubiKey) or biometric (fingerprint, Face ID) for stronger security.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ═══════════ Appearance ═══════════ */}
        <Card id="section-appearance">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Palette className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Appearance</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">Choose your preferred theme for the dashboard.</p>

            {mounted ? (
              <div className="grid grid-cols-3 gap-4">
                {([
                  { value: 'light', label: 'Light', icon: <Palette className="w-5 h-5" /> },
                  { value: 'dark', label: 'Dark', icon: <Palette className="w-5 h-5" /> },
                  { value: 'system', label: 'System', icon: <Palette className="w-5 h-5" /> },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-6 transition-all ${
                      theme === opt.value
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className={theme === opt.value ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}>
                      {opt.icon}
                    </div>
                    <span className="text-sm font-medium">{opt.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border-2 border-border rounded-lg p-6 flex flex-col items-center gap-2">
                    <div className="w-5 h-5 bg-muted rounded animate-pulse" />
                    <div className="h-4 bg-muted rounded w-12 animate-pulse" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══════════ Notification Preferences ═══════════ */}
        <Card id="section-notifications">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Notification Preferences</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              These settings control notifications sent directly to you &mdash; like emails when a workflow succeeds or fails.
            </p>

            <div className="space-y-1">
              {/* Email notifications */}
              <div className="flex items-center justify-between py-3 border-b">
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Email notifications</p>
                    <p className="text-xs text-muted-foreground">Receive notifications via email</p>
                  </div>
                </div>
                <Switch
                  checked={notifications.email}
                  onCheckedChange={(checked) => setNotifications({ ...notifications, email: checked })}
                  aria-label="Email notifications"
                />
              </div>

              {/* Workflow success */}
              <div className="flex items-center justify-between py-3 border-b">
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Workflow success</p>
                    <p className="text-xs text-muted-foreground">Get notified in-app and via email when workflows complete successfully</p>
                  </div>
                </div>
                <Switch
                  checked={notifications.workflow_success}
                  onCheckedChange={(checked) => setNotifications({ ...notifications, workflow_success: checked })}
                  aria-label="Workflow success notifications"
                />
              </div>

              {/* Workflow failure */}
              <div className="flex items-center justify-between py-3 border-b">
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Workflow failure</p>
                    <p className="text-xs text-muted-foreground">Get notified in-app and via email when workflows encounter errors</p>
                  </div>
                </div>
                <Switch
                  checked={notifications.workflow_failure}
                  onCheckedChange={(checked) => setNotifications({ ...notifications, workflow_failure: checked })}
                  aria-label="Workflow failure notifications"
                />
              </div>

              {/* Weekly digest */}
              <div className="flex items-center justify-between py-3 border-b">
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Weekly digest</p>
                    <p className="text-xs text-muted-foreground">Receive a weekly summary of activity</p>
                  </div>
                </div>
                <Switch
                  checked={notifications.weekly_digest}
                  onCheckedChange={(checked) => setNotifications({ ...notifications, weekly_digest: checked })}
                  aria-label="Weekly digest notifications"
                />
              </div>

              {/* AI agent panel */}
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Open AI chat panel by default</p>
                    <p className="text-xs text-muted-foreground">Auto-open the AI agent when creating workflows</p>
                  </div>
                </div>
                <Switch
                  checked={profile?.ai_agent_preference !== 'always_skip'}
                  aria-label="Auto-open AI assistant when creating workflows"
                  onCheckedChange={async (checked) => {
                    try {
                      await updateProfile({
                        ai_agent_preference: checked ? 'always_show' : 'always_skip',
                        ai_agent_skip_count: 0
                      })
                      toast({
                        title: "Preference updated",
                        description: checked
                          ? "React Agent will now appear when you create workflows"
                          : "React Agent will stay hidden when you create workflows"
                      })
                    } catch (error) {
                      toast({ title: "Error", description: "Failed to update preference.", variant: "destructive" })
                    }
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end mt-5">
              <Button onClick={handleSaveNotifications} disabled={notificationsSaving} className="bg-orange-500 text-white hover:bg-orange-600">
                {notificationsSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save preferences
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ═══════════ Danger Zone ═══════════ */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-red-500" />
              <h2 className="text-base font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5">Irreversible actions for your account.</p>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Delete account</p>
                <p className="text-xs text-muted-foreground">We&apos;ll send a confirmation email. Your account will have a 30-day recovery period before permanent deletion.</p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  toast({ title: "Contact support", description: "Please contact support to delete your account.", duration: 6000 })
                }}
              >
                Delete account
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ═══════════ Session Management ═══════════ */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-base font-semibold text-foreground mb-4">Session Management</h2>

            <div className="flex items-center justify-between py-3 border-b">
              <div className="flex items-center gap-3">
                <Monitor className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Current Session</p>
                  <p className="text-xs text-muted-foreground">This is the device you&apos;re currently using.</p>
                </div>
              </div>
              <span className="text-xs font-medium text-green-600 dark:text-green-400">Active</span>
            </div>

            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const response = await fetch("/api/sessions?all=true", { method: "DELETE" })
                    if (response.ok) {
                      toast({ title: "Sessions revoked", description: "All other sessions have been signed out." })
                    } else {
                      throw new Error("Failed")
                    }
                  } catch {
                    toast({ title: "Error", description: "Failed to sign out other sessions.", variant: "destructive" })
                  }
                }}
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Sign out all other sessions
              </Button>
              <p className="text-xs text-muted-foreground mt-2">This will sign out all other browsers and devices where you&apos;re logged in. Your current session will remain active.</p>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>

    <TwoFactorSetup open={show2FASetup} onOpenChange={setShow2FASetup} onSuccess={handle2FASuccess} />
    </>
  )
}

/* ─── Notification toggle helper (kept for potential reuse) ─── */
function NotificationToggle({
  icon, iconBg, label, description, checked, onCheckedChange, switchColor, hoverBorder = "hover:border-primary/50"
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  switchColor: string
  hoverBorder?: string
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-b-0">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <Label className="text-sm font-medium cursor-pointer">{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className={switchColor} />
    </div>
  )
}
