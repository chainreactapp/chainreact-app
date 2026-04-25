"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  MessageSquare, Mail, Book, Zap, ArrowRight, LogIn,
  ChevronDown, ChevronRight, CheckCircle, HelpCircle
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { PublicPageHeader } from '@/components/layout/PublicPageHeader'
import { TempFooter } from '@/components/temp-landing/TempFooter'
import { ForceTheme } from '@/components/theme/ForceTheme'

const faqs = [
  {
    q: 'How do I connect an integration?',
    a: 'Go to Integrations in your dashboard, find the service, and click "Connect". You\'ll be redirected to authorize with OAuth. ChainReact never stores your passwords.',
  },
  {
    q: 'What happens when a workflow fails?',
    a: 'Every execution step is logged. View the execution history to see exactly which node failed and why. Enable notifications in workflow settings to get alerted.',
  },
  {
    q: 'How are tasks counted?',
    a: 'Each action and AI node execution = 1 task (AI nodes may cost 1-5). Triggers and logic nodes are free. Loop iterations multiply inner node costs.',
  },
  {
    q: 'Can I share workflows with my team?',
    a: 'Yes. Create a team, invite members, and share workflows. Members can view, edit, or manage based on their assigned role (Admin, Member, Viewer).',
  },
  {
    q: 'Is my data secure?',
    a: 'All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We use OAuth for integrations, enforce row-level security, and never log tokens.',
  },
  {
    q: 'How do I report a bug?',
    a: 'Sign in and create a support ticket with the "Bug Report" category. Include steps to reproduce, expected vs actual behavior, and screenshots if possible.',
  },
]

export default function SupportPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen bg-white">
      <ForceTheme theme="light" />
      <PublicPageHeader breadcrumb="Support" />

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <p className="text-sm font-medium text-orange-500 mb-2">Support</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">How can we help?</h1>
          <p className="text-base text-gray-600">
            Browse our resources, ask the community, or reach out directly.
          </p>
        </div>

        {/* Contact options */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <button
            onClick={() => {
              if (!user) { router.push('/auth/login'); return }
              router.push('/support/tickets')
            }}
            className="bg-white border border-gray-200 rounded-lg p-5 text-left hover:border-orange-300 hover:shadow-sm transition-all group"
          >
            <MessageSquare className="w-5 h-5 text-orange-500 mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 mb-1 group-hover:text-orange-600 transition-colors">Submit a Ticket</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Create a support ticket. We respond within 24 hours.</p>
            {!user && (
              <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 mt-2">
                <LogIn className="w-2.5 h-2.5" /> Sign in required
              </span>
            )}
          </button>

          <button
            onClick={() => window.location.href = 'mailto:support@chainreact.app'}
            className="bg-white border border-gray-200 rounded-lg p-5 text-left hover:border-orange-300 hover:shadow-sm transition-all group"
          >
            <Mail className="w-5 h-5 text-orange-500 mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 mb-1 group-hover:text-orange-600 transition-colors">Email Us</h3>
            <p className="text-xs text-gray-500 leading-relaxed">General inquiries and partnership opportunities.</p>
          </button>

          <button
            onClick={() => router.push('/contact')}
            className="bg-white border border-gray-200 rounded-lg p-5 text-left hover:border-orange-300 hover:shadow-sm transition-all group"
          >
            <MessageSquare className="w-5 h-5 text-orange-500 mb-3" />
            <h3 className="text-sm font-semibold text-gray-900 mb-1 group-hover:text-orange-600 transition-colors">Send Feedback</h3>
            <p className="text-xs text-gray-500 leading-relaxed">Tell us what's working, what's not, or what to build next.</p>
          </button>
        </div>

        {/* Quick links */}
        <div className="mb-10">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Resources</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: Book, title: 'Documentation', desc: 'Guides and references', href: '/docs' },
              { icon: Zap, title: 'Templates', desc: 'Pre-built workflows', href: '/templates/showcase' },
              { icon: HelpCircle, title: 'Changelog', desc: "What's new", href: '/docs' },
            ].map((link) => (
              <button
                key={link.title}
                onClick={() => router.push(link.href)}
                className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-orange-300 transition-colors group text-left"
              >
                <link.icon className="w-4 h-4 text-gray-400 group-hover:text-orange-500 transition-colors shrink-0" />
                <div>
                  <p className="text-xs font-medium text-gray-700">{link.title}</p>
                  <p className="text-[11px] text-gray-400">{link.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-10">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Frequently Asked Questions</h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
            {faqs.map((faq, i) => (
              <div key={i}>
                <button
                  onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm text-gray-900 pr-4">{faq.q}</span>
                  {expandedFaq === i
                    ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  }
                </button>
                {expandedFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm text-gray-900 font-medium">All Systems Operational</span>
          </div>
          <span className="text-xs text-gray-400">Response time: &lt; 24h</span>
        </div>
      </main>

      <TempFooter />
    </div>
  )
}
