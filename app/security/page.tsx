"use client"

import { Shield, Lock, Key, Eye, Server, RefreshCw } from 'lucide-react'
import { PublicPageHeader } from '@/components/layout/PublicPageHeader'
import { TempFooter } from '@/components/temp-landing/TempFooter'
import { ForceTheme } from '@/components/theme/ForceTheme'

const securityPractices = [
  {
    icon: Lock,
    title: 'Encryption at Rest & In Transit',
    description:
      'All data is encrypted using AES-256 at rest and TLS 1.3 in transit. Your credentials and workflow data are never stored in plaintext.',
  },
  {
    icon: Key,
    title: 'OAuth 2.0 Authentication',
    description:
      'We use industry-standard OAuth 2.0 for all third-party integrations. ChainReact never sees or stores your integration passwords.',
  },
  {
    icon: Eye,
    title: 'No Token Logging',
    description:
      'Access tokens, refresh tokens, and API keys are never written to logs. Our logging infrastructure is designed to redact sensitive data automatically.',
  },
  {
    icon: Server,
    title: 'Row-Level Security',
    description:
      'Our database enforces row-level security policies, ensuring users can only access their own data - even if application-level checks fail.',
  },
  {
    icon: RefreshCw,
    title: 'Proactive Token Management',
    description:
      'Integration tokens are automatically refreshed before they expire. Health checks run continuously to detect and resolve connectivity issues before they affect your workflows.',
  },
  {
    icon: Shield,
    title: 'CORS & CSP Protection',
    description:
      'Strict CORS policies prevent unauthorized cross-origin requests. Content Security Policy headers protect against XSS and injection attacks.',
  },
]

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white">
      <ForceTheme theme="light" />
      <PublicPageHeader breadcrumb="Security" />

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <p className="text-sm font-medium text-orange-500 mb-2">Security</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Security</h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            Your data and integrations are protected by enterprise-grade security practices at every layer.
          </p>
        </div>

        {/* Security practices grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {securityPractices.map((practice) => (
            <div
              key={practice.title}
              className="bg-white rounded-lg border border-gray-200 p-6"
            >
              <practice.icon className="w-6 h-6 text-orange-500 mb-4" />
              <h3 className="text-sm font-semibold text-gray-900 mb-2">{practice.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{practice.description}</p>
            </div>
          ))}
        </div>

        {/* Report vulnerability */}
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Report a Vulnerability</h2>
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            If you discover a security vulnerability, please report it responsibly.
            Contact us at{' '}
            <a
              href="mailto:security@chainreact.app"
              className="text-orange-600 underline hover:text-orange-700 transition-colors"
            >
              security<span>@</span>chainreact.app
            </a>
            . We take all reports seriously and will respond promptly.
          </p>
          <p className="text-sm text-gray-500">
            We appreciate responsible disclosure and will acknowledge researchers who help us keep ChainReact secure.
          </p>
        </div>
      </main>

      <TempFooter />
    </div>
  )
}
