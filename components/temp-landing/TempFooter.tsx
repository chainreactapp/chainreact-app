"use client"

import React from 'react'
import Image from 'next/image'
import Link from 'next/link'

interface FooterLink {
  label: string
  href: string
  scrollTo?: string
}

const footerLinks: Record<string, FooterLink[]> = {
  Product: [
    { label: "Features", href: "/#features", scrollTo: "features" },
    { label: "Integrations", href: "/#integrations", scrollTo: "integrations" },
    { label: "Templates", href: "/templates/showcase" },
    { label: "Pricing", href: "/pricing" },
    { label: "Enterprise", href: "/enterprise" },
  ],
  Resources: [
    { label: "Documentation", href: "/docs" },
    { label: "Support", href: "/support" },
  ],
  Company: [
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Security", href: "/security" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ],
}

export function TempFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="max-w-6xl mx-auto px-6 pt-12 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">
          <div>
            <div className="flex items-center gap-2">
              <Image
                src="/logo_transparent.png"
                alt="ChainReact"
                width={24}
                height={24}
                className="brightness-0 invert"
              />
              <span className="text-sm font-semibold text-white">
                ChainReact
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              AI-native workflow automation
            </p>
          </div>

          {Object.entries(footerLinks).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="text-sm font-semibold text-slate-300 mb-3">
                {heading}
              </h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    {link.scrollTo ? (
                      <button
                        onClick={() => {
                          document.getElementById(link.scrollTo!)?.scrollIntoView({ behavior: 'smooth' })
                        }}
                        className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {link.label}
                      </button>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-800 pt-6">
          <p className="text-sm text-slate-600">
            &copy; 2025 ChainReact. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
