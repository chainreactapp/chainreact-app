"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, MessageSquare, Clock, Check } from 'lucide-react'
import { PublicPageHeader } from '@/components/layout/PublicPageHeader'
import { TempFooter } from '@/components/temp-landing/TempFooter'
import { ForceTheme } from '@/components/theme/ForceTheme'

export default function ContactPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
  }

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }))

  return (
    <div className="min-h-screen bg-white">
      <ForceTheme theme="light" />
      <PublicPageHeader breadcrumb="Contact" />

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <p className="text-sm font-medium text-orange-500 mb-2">Contact</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Get in touch</h1>
          <p className="text-lg text-gray-600">
            Have a question, feedback, or want to partner with us? We&apos;d love to hear from you.
          </p>
        </div>

        {/* Quick info */}
        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <Mail className="w-4 h-4 text-orange-500 mb-2" />
            <p className="text-xs font-medium text-gray-700">Email</p>
            <p className="text-xs text-gray-500">support<span>@</span>chainreact.app</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <MessageSquare className="w-4 h-4 text-orange-500 mb-2" />
            <p className="text-xs font-medium text-gray-700">Support Tickets</p>
            <button
              onClick={() => router.push('/support')}
              className="text-xs text-orange-600 hover:text-orange-700 transition-colors"
            >
              Open a ticket →
            </button>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <Clock className="w-4 h-4 text-orange-500 mb-2" />
            <p className="text-xs font-medium text-gray-700">Response Time</p>
            <p className="text-xs text-gray-500">Within 24 hours</p>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          {submitted ? (
            <div className="text-center py-8">
              <div className="w-10 h-10 bg-green-50 border border-green-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-5 h-5 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Message sent</h2>
              <p className="text-sm text-gray-600 mb-6">Thank you for reaching out. We&apos;ll get back to you soon.</p>
              <button
                onClick={() => router.push('/')}
                className="text-sm text-orange-600 hover:text-orange-700 transition-colors"
              >
                ← Back to home
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="name" className="block text-xs font-medium text-gray-700 mb-1.5">Name</label>
                  <input
                    id="name"
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-xs font-medium text-gray-700 mb-1.5">Email</label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="subject" className="block text-xs font-medium text-gray-700 mb-1.5">Subject</label>
                <input
                  id="subject"
                  type="text"
                  required
                  value={form.subject}
                  onChange={(e) => update('subject', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                  placeholder="What's this about?"
                />
              </div>
              <div>
                <label htmlFor="message" className="block text-xs font-medium text-gray-700 mb-1.5">Message</label>
                <textarea
                  id="message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => update('message', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 resize-none"
                  placeholder="Tell us more..."
                />
              </div>
              <button
                type="submit"
                className="w-full px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Send Message
              </button>
            </form>
          )}
        </div>
      </main>

      <TempFooter />
    </div>
  )
}
