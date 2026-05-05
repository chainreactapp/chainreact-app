'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'
import { getAuthHeader } from '@/lib/auth/getAuthHeader'
import { Loader2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface StripeAccountInfo {
  success: boolean
  account: {
    id: string
    business_name: string
    email: string
    country: string
    default_currency: string
  }
  mode: {
    isTestMode: boolean
    isLiveMode: boolean
    detected: string
  }
  customers: {
    count: number
    hasMore: boolean
    list: Array<{
      id: string
      email: string
      name: string
      created: string
      livemode: boolean
    }>
  }
  integration: {
    id: string
    status: string
    created_at: string
  }
  hint: string
}

export default function StripeAccountDebugPage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [accountInfo, setAccountInfo] = useState<StripeAccountInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return

    async function fetchAccountInfo() {
      try {
        setLoading(true)
        setError(null)

        // PR-AUTH-7: cached auth header. Missing token → 401 surfaces below.
        const response = await fetch('/api/debug/stripe-account', {
          headers: { ...(await getAuthHeader()) }
        })

        if (!response.ok) {
          const errorData = await response.json()
          setError(errorData.error || 'Failed to fetch account info')
          return
        }

        const data = await response.json()
        setAccountInfo(data)
      } catch (err: any) {
        setError(err.message || 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchAccountInfo()
  }, [user])

  if (!user) {
    return (
      <div className="container max-w-4xl mx-auto py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please log in to view Stripe account information.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="container max-w-4xl mx-auto py-8">
        <Card>
          <CardContent className="pt-6 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2">Loading Stripe account info...</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container max-w-4xl mx-auto py-8">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    )
  }

  if (!accountInfo) return null

  const modeColor = accountInfo.mode.detected === 'test' ? 'yellow' : accountInfo.mode.detected === 'live' ? 'green' : 'gray'
  const modeIcon = accountInfo.mode.detected === 'test' ? AlertCircle : accountInfo.mode.detected === 'live' ? CheckCircle2 : XCircle

  return (
    <div className="container max-w-4xl mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Stripe Account Debug</h1>
        <p className="text-muted-foreground">
          View which Stripe account mode is connected and available data
        </p>
      </div>

      {/* Account Mode Alert */}
      <Alert className={
        accountInfo.mode.detected === 'test'
          ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950'
          : 'border-green-500 bg-green-50 dark:bg-green-950'
      }>
        <AlertDescription className="flex items-start gap-2">
          {accountInfo.mode.detected === 'test' ? (
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
          )}
          <div>
            <p className="font-semibold mb-1">
              You are connected to <span className="uppercase">{accountInfo.mode.detected}</span> mode
            </p>
            <p className="text-sm">{accountInfo.hint}</p>
          </div>
        </AlertDescription>
      </Alert>

      {/* Account Details */}
      <Card>
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
          <CardDescription>Information about your connected Stripe account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Account ID</p>
              <p className="font-mono text-sm">{accountInfo.account.id}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Mode</p>
              <Badge variant="outline" className={
                accountInfo.mode.detected === 'test'
                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                  : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              }>
                {accountInfo.mode.detected.toUpperCase()}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Business Name</p>
              <p className="text-sm">{accountInfo.account.business_name || 'Not set'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="text-sm">{accountInfo.account.email}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Country</p>
              <p className="text-sm">{accountInfo.account.country}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Default Currency</p>
              <p className="text-sm uppercase">{accountInfo.account.default_currency}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Customers */}
      <Card>
        <CardHeader>
          <CardTitle>Customers ({accountInfo.customers.count})</CardTitle>
          <CardDescription>
            First 10 customers in this account
            {accountInfo.customers.hasMore && ' (showing 10 of many)'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accountInfo.customers.count === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No customers found in {accountInfo.mode.detected} mode.
                {accountInfo.mode.detected === 'test' && (
                  <div className="mt-2">
                    <p>To see your customers, either:</p>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>Create test customers in Stripe dashboard (Test Mode)</li>
                      <li>Reconnect your Stripe account in Live Mode</li>
                    </ul>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {accountInfo.customers.list.map((customer) => (
                <div
                  key={customer.id}
                  className="flex items-start justify-between p-3 border rounded-lg"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{customer.name || 'No name'}</p>
                      <Badge variant="outline" className="text-xs">
                        {customer.livemode ? 'Live' : 'Test'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{customer.email || 'No email'}</p>
                    <p className="text-xs font-mono text-muted-foreground">{customer.id}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">
                      Created: {new Date(customer.created).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Integration Status */}
      <Card>
        <CardHeader>
          <CardTitle>Integration Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Integration ID</span>
            <span className="font-mono text-sm">{accountInfo.integration.id}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge variant={accountInfo.integration.status === 'connected' ? 'default' : 'destructive'}>
              {accountInfo.integration.status}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Connected At</span>
            <span className="text-sm">
              {new Date(accountInfo.integration.created_at).toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              If you need to switch between test and live mode:
            </p>
            <Button onClick={() => window.location.href = '/integrations'}>
              Go to Integrations
            </Button>
          </div>
          {accountInfo.mode.detected === 'test' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Tip:</strong> You're in test mode. To see live customers:
                <ol className="list-decimal list-inside mt-2 space-y-1">
                  <li>Go to Integrations page</li>
                  <li>Disconnect Stripe</li>
                  <li>Reconnect and choose your live account</li>
                </ol>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
