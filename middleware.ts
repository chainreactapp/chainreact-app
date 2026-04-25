import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

import { logger } from '@/lib/utils/logger'
import { buildAccessSubject } from '@/lib/access-policy/buildAccessSubject'
import { evaluateAccess } from '@/lib/access-policy/evaluateAccess'
import { isRecognizedPlan } from '@/lib/access-policy/normalize'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname

  // Security: Block potentially dangerous HTTP methods (TRACE, TRACK)
  // These methods can be used for XSS attacks and server fingerprinting
  const method = req.method.toUpperCase()
  if (method === 'TRACE' || method === 'TRACK') {
    return new NextResponse('Method Not Allowed', {
      status: 405,
      headers: {
        'Allow': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  // Skip middleware for auth pages, API routes, and static files
  if (pathname.startsWith('/auth/login') ||
      pathname.startsWith('/auth/register') ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/_next/') ||
      pathname === '/' ||
      pathname.includes('.')) {
    return NextResponse.next()
  }

  const res = NextResponse.next({
    request: {
      headers: req.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  try {
    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser()

    // If no user, redirect to login
    if (!user) {
      if (!pathname.startsWith('/auth/')) {
        return NextResponse.redirect(new URL('/auth/login', req.url))
      }
      return res
    }

    // Read access claims from JWT app_metadata (synced by DB trigger + syncAccessClaims)
    // No DB query needed — claims are embedded in the token.
    const appMeta = user.app_metadata || {}
    const plan = appMeta.plan || 'free'
    const adminCapabilities = appMeta.admin_capabilities || {}

    // Log unrecognized plan values for telemetry
    if (plan && !isRecognizedPlan(plan)) {
      logger.error('[Middleware] Unrecognized plan in JWT claims', {
        plan,
        userId: user.id,
        pathname,
      })
    }

    // Canonical access policy evaluation — pure function, no I/O
    const subject = buildAccessSubject(
      { plan, admin_capabilities: adminCapabilities },
      true,
    )
    const decision = evaluateAccess(subject, pathname)

    if (!decision.allowed) {
      // Upgrade-modal routes: let through — client AccessGuard handles UX
      if (decision.denial?.showUpgradeModal) {
        return res
      }

      // Hard denials: redirect
      if (decision.denial?.redirectTo) {
        logger.info('[Middleware] Access denied', {
          pathname,
          reason: decision.denial.reason,
          plan: subject.plan,
          isAdmin: subject.isAdmin,
          redirectTo: decision.denial.redirectTo,
        })
        return NextResponse.redirect(new URL(decision.denial.redirectTo, req.url))
      }
    }

    return res
  } catch (error) {
    // If there's an error (like cookie parsing), just continue without authentication
    console.debug("Middleware auth error (expected):", error)
    return res
  }
}

async function trackUsage(supabase: any, userId: string, resourceType: string, action: string) {
  try {
    // Log the usage
    await supabase.from("usage_logs").insert({
      user_id: userId,
      resource_type: resourceType,
      action,
      quantity: 1,
    })

    // Update monthly usage
    const currentDate = new Date()
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth() + 1

    const updateField = getUsageField(resourceType)
    if (updateField) {
      await supabase.rpc("increment_monthly_usage", {
        p_user_id: userId,
        p_year: year,
        p_month: month,
        p_field: updateField,
        p_increment: 1,
      })
    }
  } catch (error) {
    logger.error("Usage tracking error:", error)
  }
}

function getUsageField(resourceType: string): string | null {
  const fieldMap: Record<string, string> = {
    workflow: "workflow_count",
    execution: "execution_count",
    integration: "integration_count",
    storage: "storage_used_mb",
    team_member: "team_member_count",
  }
  return fieldMap[resourceType] || null
}

export const config = {
  matcher: [
    '/workflows/:path*',
    '/integrations/:path*',
    '/analytics/:path*',
    '/teams/:path*',
    '/organization/:path*',
    '/ai-assistant/:path*',
    '/admin/:path*',
    '/settings/:path*',
    '/subscription',
  ],
}
