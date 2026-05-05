"use client"

/**
 * ShareConnectionDialog Component
 *
 * Zapier-like sharing dialog for integrations:
 * - Share with everyone in organization
 * - Share with specific teams
 * - Share with specific users
 * - Manage existing shares
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StaticIntegrationLogo } from '@/components/ui/static-integration-logo'
import {
  Globe,
  Users,
  User,
  Lock,
  Loader2,
  X,
  Check,
  AlertCircle,
  Building2,
  Share2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'
import { logger } from '@/lib/utils/logger'
import { getAuthHeader } from '@/lib/auth/getAuthHeader'

interface Team {
  id: string
  name: string
  member_count?: number
}

interface ShareRecipient {
  id: string
  type: 'team' | 'user'
  name: string
  email?: string
  permission_level: string
  created_at?: string
}

interface ShareConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  integrationId: string
  providerId: string
  providerName: string
  email?: string
  displayName?: string
  onShareUpdated?: () => void
}

type SharingScope = 'private' | 'team' | 'organization'

export function ShareConnectionDialog({
  open,
  onOpenChange,
  integrationId,
  providerId,
  providerName,
  email,
  displayName,
  onShareUpdated,
}: ShareConnectionDialogProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Sharing state
  const [sharingScope, setSharingScope] = useState<SharingScope>('private')
  const [originalScope, setOriginalScope] = useState<SharingScope>('private')
  const [shares, setShares] = useState<ShareRecipient[]>([])

  // Available teams for sharing
  const [availableTeams, setAvailableTeams] = useState<Team[]>([])
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set())

  // Fetch current sharing settings
  const fetchSharingSettings = useCallback(async () => {
    if (!integrationId) return

    setLoading(true)
    setError(null)

    try {
      // PR-AUTH-5: cached auth header. Missing → server returns 401, surfaced
      // through the existing !response.ok branch as "Failed to fetch sharing settings".
      const authHeader = await getAuthHeader()

      // Fetch sharing settings
      const response = await fetchWithTimeout(
        `/api/integrations/share?integration_id=${integrationId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...authHeader,
          },
        },
        8000
      )

      if (!response.ok) {
        throw new Error('Failed to fetch sharing settings')
      }

      const data = await response.json()

      setSharingScope(data.integration?.sharing_scope || 'private')
      setOriginalScope(data.integration?.sharing_scope || 'private')

      // Transform shares to recipients
      const recipients: ShareRecipient[] = (data.shares || []).map((share: any) => ({
        id: share.id,
        type: share.shared_with_team_id ? 'team' : 'user',
        name: share.teams?.name || share.users?.email || 'Unknown',
        email: share.users?.email,
        permission_level: share.permission_level,
        created_at: share.created_at,
      }))
      setShares(recipients)

      // Set selected teams from existing shares
      const teamIds = new Set(
        (data.shares || [])
          .filter((s: any) => s.shared_with_team_id)
          .map((s: any) => s.shared_with_team_id)
      )
      setSelectedTeams(teamIds)

      // Fetch available teams (re-use the same authHeader captured above).
      const teamsResponse = await fetchWithTimeout(
        '/api/teams',
        {
          headers: {
            'Content-Type': 'application/json',
            ...authHeader,
          },
        },
        8000
      )

      if (teamsResponse.ok) {
        const teamsData = await teamsResponse.json()
        setAvailableTeams(teamsData.teams || [])
      }

    } catch (err: any) {
      logger.error('Error fetching sharing settings:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [integrationId])

  useEffect(() => {
    if (open && integrationId) {
      fetchSharingSettings()
    }
  }, [open, integrationId, fetchSharingSettings])

  // Handle save
  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      // PR-AUTH-5: cached auth header.
      const teamsToShare = Array.from(selectedTeams)

      const response = await fetchWithTimeout(
        '/api/integrations/share',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await getAuthHeader()),
          },
          body: JSON.stringify({
            integration_id: integrationId,
            sharing_scope: sharingScope,
            share_with_teams: sharingScope === 'team' ? teamsToShare : [],
            permission_level: 'use',
          }),
        },
        8000
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update sharing')
      }

      setSuccess(true)
      setOriginalScope(sharingScope)
      onShareUpdated?.()

      // Close dialog after short delay
      setTimeout(() => {
        onOpenChange(false)
      }, 1000)

    } catch (err: any) {
      logger.error('Error saving sharing settings:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Handle remove all sharing
  const handleMakePrivate = async () => {
    setSaving(true)
    setError(null)

    try {
      // PR-AUTH-5: cached auth header.
      const response = await fetchWithTimeout(
        '/api/integrations/share',
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(await getAuthHeader()),
          },
          body: JSON.stringify({
            integration_id: integrationId,
            remove_all: true,
          }),
        },
        8000
      )

      if (!response.ok) {
        throw new Error('Failed to remove sharing')
      }

      setSharingScope('private')
      setOriginalScope('private')
      setShares([])
      setSelectedTeams(new Set())
      onShareUpdated?.()

    } catch (err: any) {
      logger.error('Error removing sharing:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Toggle team selection
  const toggleTeam = (teamId: string) => {
    setSelectedTeams(prev => {
      const newSet = new Set(prev)
      if (newSet.has(teamId)) {
        newSet.delete(teamId)
      } else {
        newSet.add(teamId)
      }
      return newSet
    })
  }

  const hasChanges = sharingScope !== originalScope ||
    (sharingScope === 'team' && selectedTeams.size !== shares.filter(s => s.type === 'team').length)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5" />
            Share Connection
          </DialogTitle>
          <DialogDescription>
            Share this connection with your team members so they can use it in their workflows.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Connection info */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <StaticIntegrationLogo
                providerId={providerId}
                providerName={providerName}
                className="w-10 h-10"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {displayName || email || providerName}
                </div>
                {email && displayName && displayName !== email && (
                  <div className="text-sm text-muted-foreground truncate">
                    {email}
                  </div>
                )}
              </div>
              <Badge variant="outline" className="flex-shrink-0">
                {sharingScope === 'private' && <Lock className="w-3 h-3 mr-1" />}
                {sharingScope === 'team' && <Users className="w-3 h-3 mr-1" />}
                {sharingScope === 'organization' && <Globe className="w-3 h-3 mr-1" />}
                {sharingScope === 'private' ? 'Private' :
                 sharingScope === 'team' ? 'Shared' : 'Everyone'}
              </Badge>
            </div>

            {/* Sharing scope selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Who can use this connection?</Label>
              <RadioGroup
                value={sharingScope}
                onValueChange={(value) => setSharingScope(value as SharingScope)}
                className="space-y-2"
              >
                {/* Private */}
                <div className={cn(
                  "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  sharingScope === 'private'
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:bg-muted/50"
                )}>
                  <RadioGroupItem value="private" id="private" />
                  <Label htmlFor="private" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">Private</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Only you can use this connection
                    </p>
                  </Label>
                </div>

                {/* Share with specific teams */}
                <div className={cn(
                  "flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  sharingScope === 'team'
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:bg-muted/50"
                )}>
                  <RadioGroupItem value="team" id="team" className="mt-1" />
                  <Label htmlFor="team" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">Specific Teams</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Share with selected teams
                    </p>
                  </Label>
                </div>

                {/* Share with everyone */}
                <div className={cn(
                  "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  sharingScope === 'organization'
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:bg-muted/50"
                )}>
                  <RadioGroupItem value="organization" id="organization" />
                  <Label htmlFor="organization" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">Everyone</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      All members in your organization can use this
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Team selection (shown when sharing_scope is 'team') */}
            {sharingScope === 'team' && (
              <div className="space-y-3">
                <Separator />
                <Label className="text-sm font-medium">Select teams to share with</Label>
                {availableTeams.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-lg">
                    You are not a member of any teams yet. Create or join a team to share connections.
                  </div>
                ) : (
                  <ScrollArea className="h-[150px] border rounded-lg p-2">
                    <div className="space-y-2">
                      {availableTeams.map((team) => (
                        <div
                          key={team.id}
                          className={cn(
                            "flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors",
                            selectedTeams.has(team.id)
                              ? "bg-primary/10"
                              : "hover:bg-muted/50"
                          )}
                          onClick={() => toggleTeam(team.id)}
                        >
                          <Checkbox
                            checked={selectedTeams.has(team.id)}
                            onCheckedChange={() => toggleTeam(team.id)}
                          />
                          <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="flex-1 text-sm font-medium truncate">
                            {team.name}
                          </span>
                          {selectedTeams.has(team.id) && (
                            <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}

            {/* Current shares (for existing shares) */}
            {shares.length > 0 && sharingScope !== 'private' && (
              <div className="space-y-3">
                <Separator />
                <Label className="text-sm font-medium">Currently shared with</Label>
                <div className="space-y-2">
                  {shares.map((share) => (
                    <div
                      key={share.id}
                      className="flex items-center gap-2 p-2 bg-muted/50 rounded-md"
                    >
                      {share.type === 'team' ? (
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <User className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="flex-1 text-sm truncate">{share.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {share.permission_level}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warning for organization sharing */}
            {sharingScope === 'organization' && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Everyone in your organization will be able to use this connection in their workflows.
                  They won't see your login credentials.
                </AlertDescription>
              </Alert>
            )}

            {/* Error message */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Success message */}
            {success && (
              <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
                <Check className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-700 dark:text-green-400">
                  Sharing settings updated successfully!
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {originalScope !== 'private' && (
            <Button
              variant="outline"
              onClick={handleMakePrivate}
              disabled={saving || loading}
              className="text-destructive hover:text-destructive"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
              Make Private
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || !hasChanges}>
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Share2 className="w-4 h-4 mr-2" />
            )}
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
