import type { RouteRule } from './types'

/**
 * Single source of truth for route-level access requirements.
 *
 * Routes not listed here are accessible to any authenticated user.
 * Only routes with specific plan/admin requirements
 * need entries.
 */
export const ROUTE_ACCESS: Record<string, RouteRule> = {
  '/ai-assistant': { minPlan: 'pro', upgradeModal: true },
  '/analytics': { minPlan: 'pro', upgradeModal: true },
  '/teams': { minPlan: 'team', upgradeModal: true },
  '/org': { minPlan: 'business', upgradeModal: true },
  // allowedPlansExact (not minPlan) because /enterprise is gated to the enterprise
  // billing tier specifically - admin bypasses via isAdmin, not via plan hierarchy
  '/enterprise': { allowedPlansExact: ['enterprise'] },
  '/admin': { adminOnly: true },
}

/**
 * Look up the access rule for a pathname.
 * Uses longest matching prefix to prevent collisions if more specific routes are added.
 *
 * Examples:
 *   '/teams/my-team/members' → matches '/teams' rule
 *   '/workflows/builder/123' → no match (no rule for /workflows)
 */
export function getRouteRule(pathname: string): RouteRule | null {
  // Try exact match first
  if (ROUTE_ACCESS[pathname]) {
    return ROUTE_ACCESS[pathname]
  }

  // Find longest matching prefix
  let bestMatch: string | null = null
  let bestLength = 0

  for (const route of Object.keys(ROUTE_ACCESS)) {
    if (pathname.startsWith(route + '/') && route.length > bestLength) {
      bestMatch = route
      bestLength = route.length
    }
  }

  return bestMatch ? ROUTE_ACCESS[bestMatch] : null
}
