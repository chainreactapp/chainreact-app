"use client"

import { useState, useEffect } from 'react'
import { logger } from '@/lib/utils/logger'

export interface WorkspaceOption {
  type: 'personal' | 'team' | 'organization'
  id: string | null // null for personal workspace
  name: string
  description?: string
  user_role?: string // User's role in this workspace (e.g., 'owner', 'admin', 'member')
}

/**
 * Hook to fetch available workspaces for the current user
 * Returns personal workspace + teams + organizations
 */
export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchWorkspaces()
  }, [])

  const fetchWorkspaces = async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch teams and organizations in parallel
      const [teamsResponse, orgsResponse] = await Promise.all([
        fetch('/api/teams/my-teams'),
        fetch('/api/organizations')
      ])

      if (!teamsResponse.ok) {
        throw new Error('Failed to fetch teams')
      }

      if (!orgsResponse.ok) {
        throw new Error('Failed to fetch organizations')
      }

      const teamsData = await teamsResponse.json()
      const orgsData = await orgsResponse.json()

      const teams = teamsData.teams || []
      // Organizations API returns { organizations: [...] } directly, not wrapped in data
      // Filter out personal workspaces (is_workspace: true) and standalone teams (is_team: true)
      // since we add personal workspace manually and teams come from /api/teams/my-teams
      const allOrgs = orgsData.organizations || orgsData.data?.organizations || []
      const organizations = allOrgs.filter((org: any) => !org.is_workspace && !org.is_team)

      // Build workspace options
      const options: WorkspaceOption[] = [
        // Personal workspace (always first)
        {
          type: 'personal',
          id: null,
          name: 'Personal Workspace',
          description: 'Your private workspace'
        }
      ]

      // Add teams (with user role)
      teams.forEach((team: any) => {
        options.push({
          type: 'team',
          id: team.id,
          name: team.name,
          description: team.description || `Team workspace`,
          user_role: team.user_role
        })
      })

      // Add organizations (with user role)
      organizations.forEach((org: any) => {
        options.push({
          type: 'organization',
          id: org.id,
          name: org.name,
          description: org.description || 'Organization workspace',
          user_role: org.user_role
        })
      })

      setWorkspaces(options)
      logger.info('[useWorkspaces] Fetched workspaces:', {
        total: options.length,
        teams: teams.length,
        orgs: organizations.length
      })

    } catch (err: any) {
      const isAbort =
        err?.name === 'AbortError' ||
        (err?.name === 'TypeError' && /failed to fetch|load failed|network/i.test(err?.message ?? ''))
      if (isAbort) {
        logger.debug('[useWorkspaces] Fetch aborted (likely navigation)', {
          message: err?.message ?? String(err),
        })
      } else {
        logger.error('[useWorkspaces] Error fetching workspaces:', {
          message: err?.message ?? String(err),
          name: err?.name,
        })
      }
      setError(err?.message || 'Failed to fetch workspaces')
      // On error, at least show personal workspace
      setWorkspaces([
        {
          type: 'personal',
          id: null,
          name: 'Personal Workspace',
          description: 'Your private workspace'
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  // Helper to get teams and organizations separately
  const teams = workspaces.filter(w => w.type === 'team')
  const organizations = workspaces.filter(w => w.type === 'organization')

  return {
    workspaces,
    teams,
    organizations,
    loading,
    error,
    refetch: fetchWorkspaces
  }
}
