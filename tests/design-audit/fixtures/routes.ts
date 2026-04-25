export type RouteCategory = 'marketing' | 'auth' | 'app' | 'invite'
export type AuthState = 'public' | 'required' | 'either'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export type RouteEntry = {
  slug: string
  path: string
  category: RouteCategory
  auth: AuthState
  priority: Priority
  needsSeed?: boolean
  notes?: string
}

export const ROUTES: RouteEntry[] = [
  { slug: 'landing', path: '/', category: 'marketing', auth: 'either', priority: 'P0' },
  { slug: 'pricing', path: '/pricing', category: 'marketing', auth: 'either', priority: 'P0' },
  { slug: 'about', path: '/about', category: 'marketing', auth: 'either', priority: 'P1' },
  { slug: 'enterprise', path: '/enterprise', category: 'marketing', auth: 'either', priority: 'P1' },
  { slug: 'docs', path: '/docs', category: 'marketing', auth: 'either', priority: 'P1' },
  { slug: 'support', path: '/support', category: 'marketing', auth: 'either', priority: 'P1' },
  { slug: 'support-ticket', path: '/support/tickets/__TICKET_ID__', category: 'marketing', auth: 'required', priority: 'P2', needsSeed: true },
  { slug: 'contact', path: '/contact', category: 'marketing', auth: 'either', priority: 'P2' },
  { slug: 'request-integration', path: '/request-integration', category: 'marketing', auth: 'either', priority: 'P2' },
  { slug: 'terms', path: '/terms', category: 'marketing', auth: 'either', priority: 'P2', notes: 'legal; do not rewrite copy' },
  { slug: 'privacy', path: '/privacy', category: 'marketing', auth: 'either', priority: 'P2', notes: 'legal; do not rewrite copy' },
  { slug: 'security', path: '/security', category: 'marketing', auth: 'either', priority: 'P2' },
  { slug: 'sub-processors', path: '/sub-processors', category: 'marketing', auth: 'either', priority: 'P3' },
  { slug: 'waitlist', path: '/waitlist', category: 'marketing', auth: 'either', priority: 'P2' },
  { slug: 'waitlist-success', path: '/waitlist/success', category: 'marketing', auth: 'either', priority: 'P3' },

  { slug: 'auth-login', path: '/auth/login', category: 'auth', auth: 'public', priority: 'P0' },
  { slug: 'auth-register', path: '/auth/register', category: 'auth', auth: 'public', priority: 'P0' },
  { slug: 'auth-reset-password', path: '/auth/reset-password', category: 'auth', auth: 'public', priority: 'P1' },
  { slug: 'auth-confirm', path: '/auth/confirm', category: 'auth', auth: 'public', priority: 'P1' },
  { slug: 'auth-confirmation-success', path: '/auth/confirmation-success', category: 'auth', auth: 'public', priority: 'P2' },
  { slug: 'auth-email-confirmed', path: '/auth/email-confirmed', category: 'auth', auth: 'public', priority: 'P2' },
  { slug: 'auth-waiting-confirmation', path: '/auth/waiting-confirmation', category: 'auth', auth: 'public', priority: 'P1' },
  { slug: 'auth-beta-signup', path: '/auth/beta-signup', category: 'auth', auth: 'public', priority: 'P2' },
  { slug: 'auth-sso-session', path: '/auth/sso-session', category: 'auth', auth: 'public', priority: 'P3' },
  { slug: 'auth-sso-signup', path: '/auth/sso-signup', category: 'auth', auth: 'public', priority: 'P3' },
  { slug: 'auth-sso-error', path: '/auth/sso-error', category: 'auth', auth: 'public', priority: 'P3' },
  { slug: 'auth-code-error', path: '/auth/auth-code-error', category: 'auth', auth: 'public', priority: 'P3' },
  { slug: 'auth-error', path: '/auth/error', category: 'auth', auth: 'public', priority: 'P3' },

  { slug: 'workflows', path: '/workflows', category: 'app', auth: 'required', priority: 'P0' },
  { slug: 'workflows-newly', path: '/workflows/newly', category: 'app', auth: 'required', priority: 'P2' },
  { slug: 'workflows-templates', path: '/workflows/templates', category: 'app', auth: 'required', priority: 'P1' },
  { slug: 'templates', path: '/templates', category: 'app', auth: 'required', priority: 'P1' },
  { slug: 'templates-showcase', path: '/templates/showcase', category: 'app', auth: 'required', priority: 'P2' },
  { slug: 'ai-assistant', path: '/ai-assistant', category: 'app', auth: 'required', priority: 'P0', notes: 'real OpenAI cost; budget 3 turns' },
  { slug: 'analytics', path: '/analytics', category: 'app', auth: 'required', priority: 'P1' },
  { slug: 'connections', path: '/connections', category: 'app', auth: 'required', priority: 'P0', notes: 'canonical Apps page' },
  { slug: 'connections-trello-auth', path: '/connections/trello-auth', category: 'app', auth: 'required', priority: 'P3' },
  { slug: 'webhooks', path: '/webhooks', category: 'app', auth: 'required', priority: 'P2' },
  { slug: 'settings', path: '/settings', category: 'app', auth: 'required', priority: 'P0' },
  { slug: 'settings-ai-usage', path: '/settings/ai-usage', category: 'app', auth: 'required', priority: 'P1' },
  { slug: 'subscription', path: '/subscription', category: 'app', auth: 'required', priority: 'P1', notes: 'visual only; no Stripe clicks' },
  { slug: 'payments', path: '/payments', category: 'app', auth: 'required', priority: 'P2', notes: 'visual only' },
  { slug: 'teams', path: '/teams', category: 'app', auth: 'required', priority: 'P1' },
  { slug: 'team-detail', path: '/teams/__TEAM_SLUG__', category: 'app', auth: 'required', priority: 'P2', needsSeed: true },
  { slug: 'team-members', path: '/teams/__TEAM_SLUG__/members', category: 'app', auth: 'required', priority: 'P2', needsSeed: true },
  { slug: 'team-settings', path: '/team-settings', category: 'app', auth: 'required', priority: 'P2' },
  { slug: 'org', path: '/org', category: 'app', auth: 'required', priority: 'P2' },
  { slug: 'org-settings', path: '/org/__ORG_SLUG__/settings', category: 'app', auth: 'required', priority: 'P2', needsSeed: true },

  { slug: 'invite', path: '/invite', category: 'invite', auth: 'either', priority: 'P1' },
  { slug: 'invite-signup', path: '/invite/signup', category: 'invite', auth: 'public', priority: 'P1' },
]

export const IN_SCOPE_COUNT = ROUTES.length

export function routesByPriority(p: Priority) {
  return ROUTES.filter((r) => r.priority === p)
}

export function publicRoutes() {
  return ROUTES.filter((r) => r.auth === 'public' || r.auth === 'either')
}

export function appRoutes() {
  return ROUTES.filter((r) => r.auth === 'required')
}
