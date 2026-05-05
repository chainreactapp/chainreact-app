"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, ShieldAlert, CheckCircle, MessageCircle } from "lucide-react"

import { createClient } from "@/utils/supabase/client"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { GenericSelectField } from "@/components/workflows/configuration/fields/shared/GenericSelectField"

type DropdownOption = { value: string; label: string }
type DiscordOption = DropdownOption

type RunResponse = {
  success: boolean
  message?: string
  error?: string
  output?: {
    conversationId?: string
    channelId?: string
    threadId?: string
    timeoutAt?: string | null
    timeoutMinutes?: number
  }
}

const DEFAULT_INITIAL_MESSAGE =
  "**Workflow Paused for Review**\n\nHere's the data from the previous step:\n{{*}}\n\nLet me know when you're ready to continue!"

const DEFAULT_SAMPLE_PAYLOAD = `{
  "email": {
    "from": "alex@example.com",
    "to": "support@example.com",
    "subject": "Payment failed",
    "body": "Hey team - my invoice is past due. Can you re-run the payment and confirm?"
  }
}`

export function HitlTestHarness() {
  const [userId, setUserId] = useState<string | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(true)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [discordIntegrationId, setDiscordIntegrationId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const [guilds, setGuilds] = useState<DiscordOption[]>([])
  const [channels, setChannels] = useState<DiscordOption[]>([])
  const [guildLoading, setGuildLoading] = useState(false)
  const [channelLoading, setChannelLoading] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)

  const [form, setForm] = useState({
    discordGuildId: "",
    discordChannelId: "",
    timeoutPreset: "60",
    customTimeout: 90,
    timeoutAction: "cancel",
    initialMessage: DEFAULT_INITIAL_MESSAGE,
    contextData: "{{*}}",
    continuationSignals: "continue,proceed,go ahead,looks good,approve",
    samplePayload: DEFAULT_SAMPLE_PAYLOAD,
  })
  const timeoutOptions = [
    { value: "0", label: "Never timeout" },
    { value: "15", label: "15 minutes" },
    { value: "30", label: "30 minutes" },
    { value: "60", label: "1 hour" },
    { value: "120", label: "2 hours" },
    { value: "240", label: "4 hours" },
    { value: "480", label: "8 hours" },
    { value: "1440", label: "24 hours" },
    { value: "custom", label: "Custom…" },
  ]

  const timeoutActionOptions = [
    { value: "cancel", label: "Cancel workflow" },
    { value: "proceed", label: "Auto-proceed" },
  ]


  const [autoDetectContext, setAutoDetectContext] = useState(false)

  const [runningTest, setRunningTest] = useState(false)
  const [runResult, setRunResult] = useState<RunResponse | null>(null)

  useEffect(() => {
    void refreshConnection()
  }, [])

  useEffect(() => {
    if (discordIntegrationId) {
      void loadGuilds()
    } else {
      setGuilds([])
      setChannels([])
    }
  }, [discordIntegrationId])

  useEffect(() => {
    if (discordIntegrationId && form.discordGuildId) {
      void loadChannels(form.discordGuildId)
    } else {
      setChannels([])
      setForm((prev) => ({ ...prev, discordChannelId: "" }))
    }
  }, [discordIntegrationId, form.discordGuildId])

  const hasDiscordConnected = Boolean(discordIntegrationId)

  const canRunTest =
    hasDiscordConnected &&
    form.discordGuildId &&
    form.discordChannelId &&
    (!autoDetectContext || Boolean(form.contextData || form.initialMessage))

  async function refreshConnection() {
    setCheckingConnection(true)
    setConnectError(null)
    try {
      // PR-AUTH-7: cached user id from auth store.
      const { useAuthStore } = await import("@/stores/authStore")
      const user = useAuthStore.getState().user

      if (!user) {
        setConnectError("You must be signed in to run HITL tests.")
        setDiscordIntegrationId(null)
        return
      }

      setUserId(user.id)

      const supabase = createClient()
      const { data, error } = await supabase
        .from("integrations")
        .select("id, provider, status")
        .eq("provider", "discord")
        .eq("user_id", user.id)
        .maybeSingle()

      if (error) {
        throw error
      }

      if (!data || data.status !== "connected") {
        setDiscordIntegrationId(null)
        setConnectError("Discord is not connected.")
      } else {
        setDiscordIntegrationId(data.id)
        setConnectError(null)
      }
    } catch (error: any) {
      setConnectError(error?.message || "Failed to check Discord connection.")
      setDiscordIntegrationId(null)
    } finally {
      setCheckingConnection(false)
    }
  }

  async function handleConnectDiscord() {
    if (!userId) {
      await refreshConnection()
      return
    }

    setConnecting(true)
    try {
      const response = await fetch("/api/integrations/auth/generate-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "discord",
          userId,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || "Failed to start Discord OAuth.")
      }

      const { authUrl } = await response.json()

      const width = 600
      const height = 700
      const left = window.screen.width / 2 - width / 2
      const top = window.screen.height / 2 - height / 2

      const popup = window.open(
        authUrl,
        "discord-oauth",
        `width=${width},height=${height},left=${left},top=${top}`
      )

      if (!popup) {
        throw new Error("Unable to open OAuth popup (blocked by browser).")
      }

      const handleFocus = async () => {
        window.removeEventListener("focus", handleFocus)
        await new Promise((resolve) => setTimeout(resolve, 1200))
        await refreshConnection()
        setConnecting(false)
      }

      window.addEventListener("focus", handleFocus)
    } catch (error: any) {
      setConnectError(error?.message || "Failed to connect Discord.")
      setConnecting(false)
    }
  }

  async function loadGuilds() {
    if (!discordIntegrationId) return
    setGuildLoading(true)
    setOptionsError(null)
    try {
      const response = await fetch("/api/integrations/discord/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationId: discordIntegrationId,
          dataType: "discord_guilds",
          options: {
            requireBotAccess: true,
          },
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to load Discord servers.")
      }

      const payload = await response.json()
      const options: DiscordOption[] = (payload.data || []).map((guild: any) => ({
        value: guild.id || guild.value,
        label: guild.name || guild.label || guild.id,
      }))

      setGuilds(options)

      if (options.length > 0 && !options.find((g) => g.value === form.discordGuildId)) {
        setForm((prev) => ({ ...prev, discordGuildId: options[0].value, discordChannelId: "" }))
      }
    } catch (error: any) {
      setOptionsError(error?.message || "Failed to load Discord servers.")
    } finally {
      setGuildLoading(false)
    }
  }

  async function loadChannels(guildId: string) {
    if (!discordIntegrationId || !guildId) return
    setChannelLoading(true)
    setOptionsError(null)
    try {
      const response = await fetch("/api/integrations/discord/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationId: discordIntegrationId,
          dataType: "discord_channels",
          options: { guildId },
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to load channels.")
      }

      const payload = await response.json()
      const channelOptions: DiscordOption[] = (payload.data || [])
        .filter((channel: any) => {
          const channelType =
            typeof channel.type === "string" ? parseInt(channel.type, 10) : Number(channel.type)
          return [0, 5, 15].includes(channelType)
        })
        .map((channel: any) => ({
          value: channel.id || channel.value,
          label: channel.name || channel.label || channel.id,
        }))

      setChannels(channelOptions)

      if (channelOptions.length > 0 && !channelOptions.find((c) => c.value === form.discordChannelId)) {
        setForm((prev) => ({ ...prev, discordChannelId: channelOptions[0].value }))
      }
    } catch (error: any) {
      setOptionsError(error?.message || "Failed to load channels.")
    } finally {
      setChannelLoading(false)
    }
  }

  const continuationArray = useMemo(
    () =>
      form.continuationSignals
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [form.continuationSignals]
  )

  async function handleRunTest() {
    setRunningTest(true)
    setRunResult(null)
    try {
      const response = await fetch("/api/test/hitl/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            channel: "discord",
            discordGuildId: form.discordGuildId,
            discordChannelId: form.discordChannelId,
            timeoutPreset: form.timeoutPreset,
            timeout: form.timeoutPreset === "custom" ? form.customTimeout : undefined,
            timeoutAction: form.timeoutAction,
            initialMessage: autoDetectContext ? undefined : form.initialMessage,
            contextData: form.contextData,
            autoDetectContext,
            continuationSignals: continuationArray,
            extractVariables: {
              decision: "Human decision (approved / rejected / modified)",
              notes: "Any additional notes provided",
            },
          },
          samplePayload: form.samplePayload,
        }),
      })

      const payload: RunResponse = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || payload.message || "Failed to start HITL test.")
      }

      setRunResult(payload)
    } catch (error: any) {
      setRunResult({ success: false, error: error?.message || "Failed to start test." })
    } finally {
      setRunningTest(false)
    }
  }

  return (
    <section className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Discord Connection</CardTitle>
          <CardDescription>Ensure the Discord integration is connected for this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {checkingConnection ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking…
              </div>
            ) : hasDiscordConnected ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle className="h-4 w-4" />
                Discord connected
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-rose-600">
                <ShieldAlert className="h-4 w-4" />
                Discord not connected
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refreshConnection()}
                disabled={checkingConnection || connecting}
              >
                <RefreshCw className={cn("mr-2 h-4 w-4", checkingConnection && "animate-spin")} />
                Refresh
              </Button>
              {!hasDiscordConnected && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleConnectDiscord()}
                  disabled={connecting}
                >
                  {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect Discord
                </Button>
              )}
            </div>
          </div>
          {connectError && <p className="text-sm text-rose-600">{connectError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configure & Launch HITL Test</CardTitle>
          <CardDescription>
            This mirrors the Ask Human via Chat node. Pick a Discord channel, tweak the prompt, then
            click <strong>Start HITL Test</strong> to open a live thread.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <DropdownField
              label="Discord Server"
              fieldName="discordGuildId"
              placeholder={hasDiscordConnected ? "Select server" : "Connect Discord first"}
              value={form.discordGuildId}
              onChange={(value) => setForm((prev) => ({ ...prev, discordGuildId: value, discordChannelId: "" }))}
              options={guilds}
              disabled={!hasDiscordConnected || guildLoading}
              isLoading={guildLoading}
            />
            <DropdownField
              label="Discord Channel"
              fieldName="discordChannelId"
              placeholder={form.discordGuildId ? "Select channel" : "Select a server first"}
              value={form.discordChannelId}
              onChange={(value) => setForm((prev) => ({ ...prev, discordChannelId: value }))}
              options={channels}
              disabled={!form.discordGuildId || channelLoading}
              isLoading={channelLoading}
            />
          </div>

          {optionsError && <p className="text-sm text-rose-600">{optionsError}</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <DropdownField
              label="Timeout Preset"
              fieldName="timeoutPreset"
              placeholder="Select timeout"
              value={form.timeoutPreset}
              onChange={(value) => setForm((prev) => ({ ...prev, timeoutPreset: value }))}
              options={timeoutOptions}
            />
            {form.timeoutPreset === "custom" && (
              <div className="space-y-2">
                <Label>Custom Timeout (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.customTimeout}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, customTimeout: Number(event.target.value || 1) }))
                  }
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <DropdownField
              label="If no response"
              fieldName="timeoutAction"
              placeholder="Select action"
              value={form.timeoutAction}
              onChange={(value) => setForm((prev) => ({ ...prev, timeoutAction: value }))}
              options={timeoutActionOptions}
            />
            <div className="space-y-2">
              <Label>Continuation Signals</Label>
              <Input
                value={form.continuationSignals}
                onChange={(event) => setForm((prev) => ({ ...prev, continuationSignals: event.target.value }))}
                placeholder="continue, proceed, go ahead…"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border p-4">
            <div className="flex-1">
              <p className="text-sm font-medium">AI drafts the plan automatically</p>
              <p className="text-xs text-muted-foreground">
                When enabled, we auto-detect context from the previous step and let the AI craft the opening message.
              </p>
            </div>
            <Switch checked={autoDetectContext} onCheckedChange={setAutoDetectContext} />
          </div>

          {!autoDetectContext && (
            <div className="space-y-2">
              <Label>Initial Message</Label>
              <Textarea
                rows={5}
                value={form.initialMessage}
                onChange={(event) => setForm((prev) => ({ ...prev, initialMessage: event.target.value }))}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Context Data (passed to the assistant)</Label>
            <Textarea
              rows={3}
              value={form.contextData}
              onChange={(event) => setForm((prev) => ({ ...prev, contextData: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Use <code>{"{{*}}"}</code> to reference the entire payload, or insert any manual context you want humans to see.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Sample Payload (JSON)</Label>
            <Textarea
              rows={6}
              value={form.samplePayload}
              onChange={(event) => setForm((prev) => ({ ...prev, samplePayload: event.target.value }))}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => handleRunTest()} disabled={!canRunTest || runningTest}>
              {runningTest && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Start HITL Test
            </Button>
            <p className="text-sm text-muted-foreground">
              We’ll create a dedicated workflow execution named <strong>HITL Debug Harness</strong> for these tests.
            </p>
          </div>

          {runResult && (
            <div
              className={cn(
                "rounded-lg border p-4",
                runResult.success ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
              )}
            >
              {runResult.success ? (
                <div className="space-y-2 text-sm text-emerald-800">
                  <p className="flex items-center gap-2 font-medium">
                    <MessageCircle className="h-4 w-4" />
                    HITL conversation started!
                  </p>
                  {runResult.output?.conversationId && (
                    <p>
                      Conversation ID:{" "}
                      <code className="rounded bg-white px-1 py-0.5 text-xs">
                        {runResult.output.conversationId}
                      </code>
                    </p>
                  )}
                  {runResult.output?.threadId && (
                    <p>
                      Discord Thread ID:{" "}
                      <code className="rounded bg-white px-1 py-0.5 text-xs">
                        {runResult.output.threadId}
                      </code>
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Open Discord to review the thread, respond, and watch the dashboard below update automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-rose-700">
                  <p className="flex items-center gap-2 font-medium">
                    <ShieldAlert className="h-4 w-4" />
                    Failed to start HITL test
                  </p>
                  <p>{runResult.error || runResult.message}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

interface DropdownFieldProps {
  label: string
  fieldName: string
  value: string
  onChange: (value: string) => void
  options: DropdownOption[]
  placeholder?: string
  disabled?: boolean
  isLoading?: boolean
}

function DropdownField({
  label,
  fieldName,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  isLoading,
}: DropdownFieldProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <GenericSelectField
        field={{
          name: fieldName,
          label,
          placeholder,
          type: "select",
          disabled,
          disableSearch: options.length < 5,
        }}
        value={value}
        onChange={(val) => onChange(typeof val === "string" ? val : "")}
        options={options}
        isLoading={isLoading}
        nodeInfo={{ providerId: "hitl_debug", type: "hitl_test", integrationId: "hitl_debug" }}
        parentValues={{}}
        workflowNodes={[]}
      />
    </div>
  )
}
