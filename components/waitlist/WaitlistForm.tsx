"use client"

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, X, ChevronDown, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { integrations, getIntegrationsByCategory, type Integration } from '@/lib/waitlist/integrations'
import { toast } from 'sonner'

export interface WaitlistFormData {
  name: string
  email: string
  selectedIntegrations: string[]
  customIntegrations: string[]
  wantsAiAssistant: boolean
  wantsAiActions: boolean
  aiActionsImportance: 'not-important' | 'somewhat-important' | 'very-important' | 'critical'
}

export function WaitlistForm() {
  const router = useRouter()
  const [formData, setFormData] = useState<WaitlistFormData>({
    name: '',
    email: '',
    selectedIntegrations: [],
    customIntegrations: [],
    wantsAiAssistant: true,
    wantsAiActions: true,
    aiActionsImportance: 'very-important',
  })

  const [customIntegrationInput, setCustomIntegrationInput] = useState('')
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const integrationsByCategory = useMemo(() => getIntegrationsByCategory(), [])

  const handleAddCustomIntegration = () => {
    const trimmed = customIntegrationInput.trim()
    if (!trimmed) return

    // Check if it's already in the predefined list
    const exists = integrations.some(
      (i) => i.name.toLowerCase() === trimmed.toLowerCase()
    )

    if (exists) {
      toast.error('This integration is already in the list')
      return
    }

    // Check if already added as custom
    if (formData.customIntegrations.includes(trimmed)) {
      toast.error('You already added this integration')
      return
    }

    setFormData((prev) => ({
      ...prev,
      customIntegrations: [...prev.customIntegrations, trimmed],
    }))
    setCustomIntegrationInput('')
    toast.success('Custom integration added')
  }

  const handleToggleIntegration = (integrationId: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedIntegrations: prev.selectedIntegrations.includes(integrationId)
        ? prev.selectedIntegrations.filter((id) => id !== integrationId)
        : [...prev.selectedIntegrations, integrationId],
    }))
  }

  const handleRemoveCustomIntegration = (custom: string) => {
    setFormData((prev) => ({
      ...prev,
      customIntegrations: prev.customIntegrations.filter((c) => c !== custom),
    }))
  }

  const selectedIntegrationObjects = useMemo(
    () =>
      integrations.filter((i) => formData.selectedIntegrations.includes(i.id)),
    [formData.selectedIntegrations]
  )

  const totalSelectedCount =
    formData.selectedIntegrations.length + formData.customIntegrations.length

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast.error('Please enter your name')
      return
    }

    if (!formData.email.trim()) {
      toast.error('Please enter your email')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      toast.error('Please enter a valid email address')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join waitlist')
      }

      // Redirect to success page with name for personalization
      const params = new URLSearchParams()
      if (formData.name) {
        params.set('name', formData.name)
      }
      router.push(`/waitlist/success?${params.toString()}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to join waitlist'
      toast.error('Failed to join waitlist', {
        description: errorMessage,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto border-2 border-orange-200 dark:border-orange-800 shadow-2xl">
      <CardContent className="pt-8 pb-8 px-6 sm:px-10">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name Input */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base font-semibold">
              Full Name
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="John Doe"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              className="h-11 text-base"
              disabled={submitting}
            />
          </div>

          {/* Email Input */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-base font-semibold">
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="john@example.com"
              value={formData.email}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, email: e.target.value }))
              }
              className="h-11 text-base"
              disabled={submitting}
            />
          </div>

          {/* Integrations Multi-Select */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">
              Which integrations would you like to use?
            </Label>
            <p className="text-sm text-muted-foreground">
              Select all the tools you want to connect (you can add custom ones too)
            </p>

            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  aria-label="Select integrations you want to connect"
                  className="w-full justify-between h-11 text-base"
                  disabled={submitting}
                >
                  {totalSelectedCount > 0
                    ? `${totalSelectedCount} selected`
                    : 'Select integrations...'}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
                <Command>
                  <CommandInput placeholder="Search integrations..." />
                  <CommandList className="max-h-[300px] overflow-y-auto">
                    <CommandEmpty>No integration found.</CommandEmpty>
                    {Object.entries(integrationsByCategory).map(
                      ([category, categoryIntegrations]) => (
                        <CommandGroup key={category} heading={category}>
                          {categoryIntegrations.map((integration) => (
                            <CommandItem
                              key={integration.id}
                              value={integration.name}
                              onSelect={() =>
                                handleToggleIntegration(integration.id)
                              }
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  formData.selectedIntegrations.includes(
                                    integration.id
                                  )
                                    ? 'opacity-100'
                                    : 'opacity-0'
                                )}
                              />
                              <div className="flex-1">
                                <div className="font-medium">
                                  {integration.name}
                                </div>
                                {integration.description && (
                                  <div className="text-xs text-muted-foreground">
                                    {integration.description}
                                  </div>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Selected Integrations Display */}
            {totalSelectedCount > 0 && (
              <div className="flex flex-wrap gap-2 p-3 rounded-lg border bg-slate-50 dark:bg-slate-900">
                {selectedIntegrationObjects.map((integration) => (
                  <Badge
                    key={integration.id}
                    variant="secondary"
                    className="px-3 py-1.5 text-sm"
                  >
                    {integration.name}
                    <button
                      type="button"
                      onClick={() => handleToggleIntegration(integration.id)}
                      className="ml-1.5 hover:text-destructive"
                      disabled={submitting}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {formData.customIntegrations.map((custom) => (
                  <Badge
                    key={custom}
                    variant="outline"
                    className="px-3 py-1.5 text-sm border-orange-500 text-orange-700 dark:text-orange-300"
                  >
                    {custom}
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomIntegration(custom)}
                      className="ml-1.5 hover:text-destructive"
                      disabled={submitting}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Custom Integration Input */}
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Can't find it? Add custom integration..."
                value={customIntegrationInput}
                onChange={(e) => setCustomIntegrationInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddCustomIntegration()
                  }
                }}
                className="h-10"
                disabled={submitting}
              />
              <Button
                type="button"
                onClick={handleAddCustomIntegration}
                variant="outline"
                size="sm"
                disabled={submitting || !customIntegrationInput.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          {/* AI Features Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              <h3 className="text-lg font-semibold">AI Features</h3>
            </div>
            <p className="text-sm text-muted-foreground -mt-2 mb-4">
              Let us know what AI capabilities you'd like when the app launches
            </p>

            {/* AI Assistant Toggle */}
            <div className="p-4 rounded-lg border-2 border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Label htmlFor="ai-assistant-toggle" className="text-base font-semibold cursor-pointer flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    Assistant
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    A conversational assistant that helps you build workflows, provides suggestions, and optimizes your automation
                  </p>
                </div>
                <Switch
                  id="ai-assistant-toggle"
                  checked={formData.wantsAiAssistant}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, wantsAiAssistant: checked }))
                  }
                  disabled={submitting}
                  className="ml-4"
                />
              </div>
            </div>

            {/* AI Actions Toggle & Importance */}
            <div className="p-4 rounded-lg border-2 border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Label htmlFor="ai-actions-toggle" className="text-base font-semibold cursor-pointer flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    AI Actions
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Workflow nodes powered by AI (e.g., generate text, analyze sentiment, summarize content, classify data)
                  </p>
                </div>
                <Switch
                  id="ai-actions-toggle"
                  checked={formData.wantsAiActions}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, wantsAiActions: checked }))
                  }
                  disabled={submitting}
                  className="ml-4"
                />
              </div>

              {/* AI Actions Importance Selector */}
              {formData.wantsAiActions && (
                <div className="space-y-2 pt-2 border-t border-orange-200 dark:border-orange-700">
                  <Label className="text-sm font-medium">
                    How important are AI actions in your workflows?
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'not-important', label: 'Not Important', desc: 'Nice to have' },
                      { value: 'somewhat-important', label: 'Somewhat', desc: 'Use occasionally' },
                      { value: 'very-important', label: 'Very Important', desc: 'Use regularly' },
                      { value: 'critical', label: 'Critical', desc: 'Essential feature' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            aiActionsImportance: option.value as typeof formData.aiActionsImportance,
                          }))
                        }
                        disabled={submitting}
                        className={cn(
                          'p-3 rounded-lg border-2 text-left transition-all',
                          formData.aiActionsImportance === option.value
                            ? 'border-orange-500 bg-orange-100 dark:bg-orange-900/30 shadow-md'
                            : 'border-slate-200 dark:border-slate-700 hover:border-orange-300 dark:hover:border-orange-700'
                        )}
                      >
                        <div className="font-semibold text-sm">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            size="lg"
            className="w-full h-12 text-base font-semibold"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Joining Waitlist...
              </>
            ) : (
              'Join the Waitlist'
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            By joining, you agree to receive occasional updates about ChainReact.
            <br />
            We respect your privacy and you can unsubscribe anytime.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
