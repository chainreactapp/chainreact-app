/**
 * Production environment checks. Hits chainreact.app endpoints to verify
 * platform-level configuration vs dev.
 */

const PROD = 'https://chainreact.app'

type Check = { name: string; status: 'pass' | 'fail' | 'warn'; detail: string }
const results: Check[] = []

function record(name: string, status: Check['status'], detail: string) {
  results.push({ name, status, detail })
  const symbol = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '!'
  console.log(`  ${symbol} ${name}: ${detail}`)
}

console.log(`\nProduction env checks against ${PROD}\n`)

// 1. Site responds
try {
  const r = await fetch(`${PROD}/`, { redirect: 'follow' })
  record('site-reachable', r.ok ? 'pass' : 'fail', `${r.status} ${r.statusText}`)
} catch (e: any) {
  record('site-reachable', 'fail', e.message)
}

// 2. CSP header present
try {
  const r = await fetch(`${PROD}/`)
  const csp = r.headers.get('content-security-policy') ?? r.headers.get('content-security-policy-report-only')
  if (csp) {
    record('csp-header', 'pass', `len=${csp.length}, has-default-src=${csp.includes('default-src')}`)
  } else {
    record('csp-header', 'warn', 'no CSP header set')
  }
} catch (e: any) {
  record('csp-header', 'fail', e.message)
}

// 3. Security headers
try {
  const r = await fetch(`${PROD}/`)
  const xfo = r.headers.get('x-frame-options')
  const xcto = r.headers.get('x-content-type-options')
  const hsts = r.headers.get('strict-transport-security')
  record('x-frame-options', xfo ? 'pass' : 'warn', xfo ?? 'missing')
  record('x-content-type-options', xcto ? 'pass' : 'warn', xcto ?? 'missing')
  record('strict-transport-security', hsts ? 'pass' : 'warn', hsts ?? 'missing')
} catch (e: any) {
  record('security-headers', 'fail', e.message)
}

// 4. robots.txt
try {
  const r = await fetch(`${PROD}/robots.txt`)
  record('robots-txt', r.ok ? 'pass' : 'warn', `${r.status}`)
} catch (e: any) {
  record('robots-txt', 'fail', e.message)
}

// 5. sitemap
try {
  const r = await fetch(`${PROD}/sitemap.xml`)
  if (r.ok) {
    const text = await r.text()
    record('sitemap', 'pass', `${r.status}, has ${(text.match(/<url>/g) ?? []).length} entries`)
    // Verify deleted routes are NOT in sitemap
    if (text.includes('/community')) record('sitemap-no-community', 'warn', '/community still present in sitemap.xml')
    if (text.includes('/feedback')) record('sitemap-no-feedback', 'warn', '/feedback still present')
    if (text.includes('/learn')) record('sitemap-no-learn', 'warn', '/learn still present')
  } else {
    record('sitemap', 'warn', `${r.status}`)
  }
} catch (e: any) {
  record('sitemap', 'fail', e.message)
}

// 6. /api/plans endpoint reachable (used by app to load plan data)
try {
  const r = await fetch(`${PROD}/api/plans`)
  if (r.ok) {
    const data = await r.json()
    record('api-plans', 'pass', `${r.status}, ${data?.plans?.length ?? '?'} plans`)
  } else {
    record('api-plans', 'fail', `${r.status}`)
  }
} catch (e: any) {
  record('api-plans', 'fail', e.message)
}

// 7. Favicon and logo
for (const asset of ['/favicon.ico', '/logo_transparent.png']) {
  try {
    const r = await fetch(`${PROD}${asset}`)
    record(`asset:${asset}`, r.ok ? 'pass' : 'warn', `${r.status}`)
  } catch (e: any) {
    record(`asset:${asset}`, 'fail', e.message)
  }
}

// 8. Auth pages don't 500
for (const p of ['/auth/login', '/auth/register', '/auth/reset-password', '/pricing', '/about', '/contact']) {
  try {
    const r = await fetch(`${PROD}${p}`, { redirect: 'follow' })
    record(`page:${p}`, r.ok ? 'pass' : 'fail', `${r.status}`)
  } catch (e: any) {
    record(`page:${p}`, 'fail', e.message)
  }
}

// 9. Deleted routes return 404 (not 200)
for (const p of ['/community', '/feedback', '/learn', '/new']) {
  try {
    const r = await fetch(`${PROD}${p}`, { redirect: 'manual' })
    if (r.status === 404) {
      record(`deleted:${p}`, 'pass', '404 (expected)')
    } else if (r.status === 200) {
      record(`deleted:${p}`, 'warn', `200 — still deployed; redeploy needed`)
    } else {
      record(`deleted:${p}`, 'pass', `${r.status} (non-200 — likely already removed)`)
    }
  } catch (e: any) {
    record(`deleted:${p}`, 'fail', e.message)
  }
}

console.log()
const summary = results.reduce(
  (acc, r) => {
    acc[r.status]++
    return acc
  },
  { pass: 0, fail: 0, warn: 0 } as Record<string, number>,
)
console.log(`Summary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`)
