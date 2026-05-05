'use client'

import React, { useState, useEffect } from 'react'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useAuthStore } from '@/stores/authStore'
import { User, Users, Building2, Check } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { toast } from 'sonner'

interface WorkspaceSelectorProps {
  className?: string
  showSetAsDefault?: boolean
  onWorkspaceChange?: (workspaceType: string, workspaceId: string | null) => void
}

export function WorkspaceSelector({
  className,
  showSetAsDefault = true,
  onWorkspaceChange
}: WorkspaceSelectorProps) {
  const { workspaces, loading } = useWorkspaces()
  const { workspaceType, workspaceId } = useWorkflowStore()
  const { profile, updateProfile } = useAuthStore()
  const [setAsDefault, setSetAsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  // Check if current workspace matches user's default
  useEffect(() => {
    if (profile?.default_workspace_type && profile.default_workspace_type === workspaceType) {
      if (workspaceType === 'personal' || profile.default_workspace_id === workspaceId) {
        setSetAsDefault(true)
      }
    }
  }, [profile, workspaceType, workspaceId])

  // Find current workspace details
  const currentWorkspace = workspaces.find(ws => {
    if (workspaceType === 'personal') return ws.type === 'personal'
    return ws.type === workspaceType && ws.id === workspaceId
  })

  const getWorkspaceIcon = (type: string) => {
    switch (type) {
      case 'personal':
        return <User className="w-4 h-4 text-blue-600" />
      case 'team':
        return <Users className="w-4 h-4 text-green-600" />
      case 'organization':
        return <Building2 className="w-4 h-4 text-purple-600" />
      default:
        return <User className="w-4 h-4" />
    }
  }

  const handleSetAsDefaultChange = async (checked: boolean) => {
    setSetAsDefault(checked)

    if (checked) {
      try {
        setSaving(true)
        await updateProfile({
          default_workspace_type: workspaceType as 'personal' | 'team' | 'organization',
          default_workspace_id: workspaceId || null,
        })
        logger.info('[WorkspaceSelector] Set as default workspace:', { workspaceType, workspaceId })
        toast.success(`Default workspace set to ${currentWorkspace?.name || 'Personal'}`)
      } catch (error: any) {
        logger.error('[WorkspaceSelector] Failed to set default workspace:', error)
        toast.error('Failed to set default workspace')
        setSetAsDefault(false)
      } finally {
        setSaving(false)
      }
    }
  }

  if (loading) {
    return (
      <div className={cn("p-4 bg-slate-50 dark:bg-slate-800 rounded-lg", className)}>
        <div className="animate-pulse flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="flex-1">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-32 mb-2" />
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-48" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Current Workspace Display */}
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            {getWorkspaceIcon(workspaceType)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Creating in: {currentWorkspace?.name || 'Personal Workspace'}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-200">
              {workspaceType === 'personal'
                ? 'Your private workspace'
                : workspaceType === 'team'
                ? 'Shared with team members'
                : 'Shared with organization members'}
            </p>
          </div>
          <Check className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
      </div>

      {/* Set as Default Checkbox */}
      {showSetAsDefault && (
        <div className="flex items-start space-x-2">
          <Checkbox
            id="set-default-workspace"
            checked={setAsDefault}
            onCheckedChange={handleSetAsDefaultChange}
            disabled={saving}
          />
          <div className="grid gap-1.5 leading-none">
            <Label
              htmlFor="set-default-workspace"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Set as my default workspace
            </Label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              New workflows will be created here by default. You can change this in Settings.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
