"use client"

import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy, ExternalLink, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { getWebhookUrl, getEnvironmentName, isDevelopment, isProduction } from '@/lib/utils/getBaseUrl'
import { ALL_NODE_COMPONENTS } from '@/lib/workflows/nodes'
import { INTEGRATION_CONFIGS } from '@/lib/integrations/availableIntegrations'

import { logger } from '@/lib/utils/logger'

interface WebhookConfigurationPanelProps {
  className?: string
}

export default function WebhookConfigurationPanel({ className }: WebhookConfigurationPanelProps) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  // Get all integrations that have webhook triggers
  const integrationsWithWebhooks = Object.values(INTEGRATION_CONFIGS).filter(integration => {
    // Check if this integration has any trigger nodes
    const hasTriggers = ALL_NODE_COMPONENTS.some(node => 
      node.providerId === integration.id && node.isTrigger === true
    )
    return hasTriggers
  })

  // Sort integrations by category and name
  const sortedIntegrations = integrationsWithWebhooks.sort((a, b) => {
    // Sort by category first, then by name
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category)
    }
    return a.name.localeCompare(b.name)
  })

  const copyToClipboard = async (text: string, url: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedUrl(url)
      setTimeout(() => setCopiedUrl(null), 2000)
    } catch (err) {
      logger.error('Failed to copy:', err)
    }
  }

  const environmentName = getEnvironmentName()
  const isDev = isDevelopment()
  const isProd = isProduction()

  // Group integrations by category
  const groupedIntegrations = sortedIntegrations.reduce((groups, integration) => {
    const category = integration.category
    if (!groups[category]) {
      groups[category] = []
    }
    groups[category].push(integration)
    return groups
  }, {} as Record<string, typeof sortedIntegrations>)

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="w-5 h-5" />
            Webhook Configuration
          </CardTitle>
          <CardDescription>
            Configure webhook URLs for external services. URLs are automatically adjusted based on your environment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Badge variant={isDev ? "secondary" : "default"}>
                {environmentName}
              </Badge>
              {isDev && (
                <AlertCircle className="w-4 h-4 text-amber-500" />
              )}
              {isProd && (
                <CheckCircle className="w-4 h-4 text-green-500" />
              )}
            </div>
            
            {isDev && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-amber-800 mb-2">Development Mode</h4>
                <p className="text-sm text-amber-700 mb-3">
                  You're running in development mode. For testing webhooks locally, consider using:
                </p>
                <ul className="text-sm text-amber-700 space-y-1">
                  <li>• <strong>ngrok</strong>: Expose localhost to the internet</li>
                  <li>• <strong>Webhook testing tools</strong>: Postman, webhook.site</li>
                  <li>• <strong>Environment variables</strong>: Set NEXT_PUBLIC_WEBHOOK_BASE_URL for custom testing URLs</li>
                </ul>
              </div>
            )}
          </div>

          <Tabs defaultValue="production" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="production">Production URLs</TabsTrigger>
              <TabsTrigger value="development">Development URLs</TabsTrigger>
            </TabsList>
            
            <TabsContent value="production" className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-semibold text-green-800 mb-2">Production Configuration</h4>
                <p className="text-sm text-green-700">
                  Use these URLs in your production environment. They point to your live application.
                </p>
              </div>
              
              <div className="space-y-6">
                {Object.entries(groupedIntegrations).map(([category, integrations]) => (
                  <div key={category} className="space-y-3">
                    <h3 className="font-semibold text-lg capitalize text-gray-800 border-b pb-2">
                      {category}
                    </h3>
                    <div className="space-y-3">
                      {integrations.map((integration) => {
                        const webhookUrl = `https://chainreact.app/api/workflow/${integration.id}`
                        
                        return (
                          <div key={integration.id} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex-1">
                              <h4 className="font-medium">{integration.name}</h4>
                              <p className="text-sm text-gray-600">{integration.description}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="text-sm px-2 py-1">
                                {webhookUrl}
                              </code>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => copyToClipboard(webhookUrl, webhookUrl)}
                                aria-label={copiedUrl === webhookUrl ? "Copied to clipboard" : "Copy webhook URL to clipboard"}
                              >
                                {copiedUrl === webhookUrl ? (
                                  <CheckCircle className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="development" className="space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h4 className="font-semibold text-orange-800 mb-2">Development Configuration</h4>
                <p className="text-sm text-orange-700">
                  Use these URLs for local development and testing. They automatically detect your environment.
                </p>
              </div>
              
              <div className="space-y-6">
                {Object.entries(groupedIntegrations).map(([category, integrations]) => (
                  <div key={category} className="space-y-3">
                    <h3 className="font-semibold text-lg capitalize text-gray-800 border-b pb-2">
                      {category}
                    </h3>
                    <div className="space-y-3">
                      {integrations.map((integration) => {
                        const webhookUrl = getWebhookUrl(integration.id)
                        
                        return (
                          <div key={integration.id} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex-1">
                              <h4 className="font-medium">{integration.name}</h4>
                              <p className="text-sm text-gray-600">{integration.description}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="text-sm px-2 py-1">
                                {webhookUrl}
                              </code>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => copyToClipboard(webhookUrl, webhookUrl)}
                                aria-label={copiedUrl === webhookUrl ? "Copied to clipboard" : "Copy webhook URL to clipboard"}
                              >
                                {copiedUrl === webhookUrl ? (
                                  <CheckCircle className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-semibold mb-2">Environment Variables</h4>
            <p className="text-sm text-gray-600 mb-3">
              Configure these environment variables to customize webhook URLs:
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <code className="bg-white px-2 py-1 rounded border">NEXT_PUBLIC_WEBHOOK_BASE_URL</code>
                <span className="text-gray-500">- Override webhook base URL (highest priority)</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="bg-white px-2 py-1 rounded border">NEXT_PUBLIC_BASE_URL</code>
                <span className="text-gray-500">- General base URL override</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="bg-white px-2 py-1 rounded border">NEXT_PUBLIC_APP_URL</code>
                <span className="text-gray-500">- Default app URL (current: {process.env.NEXT_PUBLIC_APP_URL || 'not set'})</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
