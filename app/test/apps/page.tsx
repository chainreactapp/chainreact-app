"use client"

/**
 * Integration Testing UI
 *
 * Beautiful UI for testing integrations without CLI.
 * Auto-discovers all integrations from availableNodes.
 * Select provider → Input test credentials → Press Test → See results → Export.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Combobox } from '@/components/ui/combobox'
import { Switch } from '@/components/ui/switch'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { OAuthConnectionFlow } from '@/lib/oauth/connection-flow'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GenericSelectField } from '@/components/workflows/configuration/fields/shared/GenericSelectField'
import {
  PlayCircle,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Download,
  Zap,
  Target,
  Activity,
  Loader2,
  Link2,
  Link2Off,
  ChevronDown,
  Edit3,
  CheckSquare,
  Square,
  Filter,
  RotateCcw,
  Save,
  FolderOpen,
  Trash2,
  Eye,
  Bug,
  Database
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface TestResult {
  type: 'action' | 'trigger'
  name: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  error?: string
  duration?: number
  logs?: string[]
  message?: string
  output?: any
}

interface TestSession {
  provider: string
  providerName: string
  status: 'idle' | 'running' | 'completed' | 'error'
  startTime?: number
  endTime?: number
  results: TestResult[]
}

interface ProviderConfig {
  provider: string
  displayName: string
  actions: Array<{ nodeType: string; actionName: string }>
  triggers: Array<{ nodeType: string; triggerName: string }>
}

interface Integration {
  id: string
  provider: string
  status: string
  email?: string
  account_name?: string
  username?: string
}

export default function IntegrationTestsPage() {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [testData, setTestData] = useState<Record<string, string>>({})
  const [session, setSession] = useState<TestSession | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [connectedIntegrations, setConnectedIntegrations] = useState<Integration[]>([])
  const [isLoadingConnection, setIsLoadingConnection] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [showMissingFieldsDialog, setShowMissingFieldsDialog] = useState(false)
  const [missingFieldsData, setMissingFieldsData] = useState<{
    nodeType: string
    nodeName: string
    fields: Array<{ name: string; label: string; type: string; dynamic?: string; dependsOn?: string | string[] }>
  } | null>(null)
  const [manualFieldValues, setManualFieldValues] = useState<Record<string, string>>({})
  const [manualFieldOptions, setManualFieldOptions] = useState<Record<string, Array<{ value: string; label: string }>>>({})
  const [manualFieldLoading, setManualFieldLoading] = useState<Record<string, boolean>>({})
  const [manualFieldErrors, setManualFieldErrors] = useState<Record<string, string>>({})
  const { toast } = useToast()
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const isAirtableProvider = selectedProvider === 'airtable'
  const [isAirtableModalOpen, setIsAirtableModalOpen] = useState(false)
  const [airtableBases, setAirtableBases] = useState<Array<{ id: string; name: string }>>([])
  const [airtableTables, setAirtableTables] = useState<Array<{ id: string; name: string }>>([])
  const [airtableFields, setAirtableFields] = useState<Array<{ id: string; name: string; type?: string }>>([])
  const [airtableRecords, setAirtableRecords] = useState<Array<{ id: string; label: string }>>([])
  const [airtableFilterValues, setAirtableFilterValues] = useState<string[]>([])
  const [airtableLoading, setAirtableLoading] = useState({
    bases: false,
    tables: false,
    fields: false,
    records: false,
    filterValues: false,
  })
  const [airtableSelection, setAirtableSelection] = useState({
    baseId: '',
    tableId: '',
    tableName: '',
    filterField: '',
    filterValue: '',
    searchField: '',
    searchValue: '',
    attachmentField: '',
    watchedFieldIds: [] as string[],
    recordId: '',
    recordIds: [] as string[],
  })

  // Selective testing
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set())
  const [testMode, setTestMode] = useState<'all' | 'selected' | 'failed'>('all')
  const [failedTests, setFailedTests] = useState<Set<string>>(new Set())

  // Test presets
  const [savedPresets, setSavedPresets] = useState<Record<string, Record<string, string>>>({})
  const [presetName, setPresetName] = useState('')
  const [showPresetsDialog, setShowPresetsDialog] = useState(false)

  // Dry run mode
  const [isDryRun, setIsDryRun] = useState(false)
  const [dryRunResults, setDryRunResults] = useState<Array<{ test: string; valid: boolean; issues: string[] }> | null>(null)

  // Load providers on mount
  useEffect(() => {
    loadProviders()
    loadConnectedIntegrations()
  }, [])

  // Reload integrations when provider changes
  useEffect(() => {
    if (selectedProvider) {
      loadConnectedIntegrations()
    }
  }, [selectedProvider])

  useEffect(() => {
    setConnectionError(null)
  }, [selectedProvider])

  const loadProviders = async () => {
    try {
      const response = await fetch('/api/admin/integration-providers')
      if (!response.ok) throw new Error('Failed to load providers')

      const data = await response.json()
      setProviders(data.providers)
    } catch (error) {
      console.error('Failed to load providers:', error)
    } finally {
      setIsLoadingProviders(false)
    }
  }

  const loadConnectedIntegrations = async () => {
    setIsLoadingConnection(true)
    try {
      const response = await fetch('/api/integrations', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`Failed to load integrations: ${response.status}`)
      }

      const payload = await response.json()
      const integrations = Array.isArray(payload?.data) ? payload.data : []

      const normalized: Integration[] = integrations.map((integration: any) => ({
        id: integration.id,
        provider: integration.provider,
        status: integration.status,
        email: integration.email ||
          integration.metadata?.email ||
          integration.metadata?.userEmail ||
          integration.provider_email,
        account_name: integration.account_name ||
          integration.metadata?.account_name ||
          integration.metadata?.accountName ||
          integration.provider_account_name,
        username: integration.username ||
          integration.metadata?.username ||
          integration.metadata?.name ||
          integration.provider_user_id,
      }))

      setConnectedIntegrations(normalized)
    } catch (error) {
      console.error('Failed to load integrations:', error)
      setConnectedIntegrations([])
    } finally {
      setIsLoadingConnection(false)
    }
  }

  const handleConnect = async (providerOverride?: string | React.MouseEvent<HTMLButtonElement>) => {
    const providerId = typeof providerOverride === 'string' ? providerOverride : selectedProvider
    if (!providerId) return

    setIsConnecting(true)
    setConnectionError(null)

    try {
      const result = await OAuthConnectionFlow.startConnection({
        providerId,
      })

      if (result.success) {
        await loadConnectedIntegrations()
        const providerName = providers.find(p => p.provider === providerId)?.displayName || providerId
        toast({
          title: 'Integration connected',
          description: `${providerName} is now connected.`,
        })
      } else if (result.message) {
        const isCancelled = result.message.toLowerCase().includes('cancel')
        if (!isCancelled) {
          setConnectionError(result.message)
          toast({
            title: 'Connection failed',
            description: result.message,
            variant: 'destructive',
          })
        }
      }
    } catch (error: any) {
      console.error('Connection error:', error)
      const message = error?.message || 'Failed to connect integration'
      setConnectionError(message)
      toast({
        title: 'Connection error',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setIsConnecting(false)
    }
  }

  const handleMissingFields = async (nodeType: string, nodeName: string) => {
    try {
      const response = await fetch(`/api/admin/test-fields?nodeType=${nodeType}`)
      if (!response.ok) {
        console.error('Failed to fetch field requirements')
        return
      }

      const data = await response.json()
      setMissingFieldsData({
        nodeType: data.nodeType,
        nodeName: data.nodeName,
        fields: data.requiredFields.filter((f: any) => f.dynamic), // Only show dynamic fields
      })
      setShowMissingFieldsDialog(true)
    } catch (error) {
      console.error('Failed to fetch field requirements:', error)
    }
  }

  const handleManualFieldSubmit = () => {
    // Merge manual values into testData
    setTestData(prev => ({ ...prev, ...manualFieldValues }))
    setShowMissingFieldsDialog(false)
    setManualFieldValues({})

    // Retry the test with the new field values
    runTests()
  }

  // Get provider config and integration data
  const providerConfig = selectedProvider
    ? providers.find(c => c.provider === selectedProvider)
    : undefined

  const providerIntegration = selectedProvider
    ? connectedIntegrations.find(i => i.provider === selectedProvider)
    : undefined

  const isConnected = providerIntegration?.status === 'connected'
  const reconnectableStatuses = ['disconnected', 'expired', 'error', 'needs_reauthorization', 'needs_reauth', 'pending_reconnect']
  const needsReconnection = providerIntegration
    ? reconnectableStatuses.includes(providerIntegration.status)
    : false

  useEffect(() => {
    if (isConnected) {
      setConnectionError(null)
    }
  }, [isConnected])

  const loadManualFieldOptions = useCallback(async (
    field: { name: string; dynamic?: string; dependsOn?: string | string[] },
    dependencyOverrides?: Record<string, string>
  ) => {
    if (!field.dynamic) return

    if (!providerIntegration?.id) {
      setManualFieldErrors(prev => ({
        ...prev,
        [field.name]: `Connect ${providerConfig?.displayName || selectedProvider} to load options.`,
      }))
      return
    }

    const dependencies = Array.isArray(field.dependsOn)
      ? field.dependsOn
      : field.dependsOn
        ? [field.dependsOn]
        : []

    const dependencyValuesSource = dependencyOverrides
      ? { ...manualFieldValues, ...dependencyOverrides }
      : manualFieldValues

    if (dependencies.length && dependencies.some(dep => !dependencyValuesSource[dep])) {
      setManualFieldOptions(prev => ({
        ...prev,
        [field.name]: [],
      }))
      return
    }

    setManualFieldLoading(prev => ({ ...prev, [field.name]: true }))
    setManualFieldErrors(prev => {
      if (!prev[field.name]) return prev
      const updated = { ...prev }
      delete updated[field.name]
      return updated
    })

    try {
      const dependencyOptions: Record<string, any> = {}
      dependencies.forEach(dep => {
        dependencyOptions[dep] = dependencyValuesSource[dep]
      })

      const response = await fetch('/api/integrations/fetch-user-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          integrationId: providerIntegration.id,
          dataType: field.dynamic,
          options: dependencyOptions,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Failed to load options for ${field.name}`)
      }

      const payload = await response.json()
      const rawOptions = Array.isArray(payload?.data) ? payload.data : payload
      const normalized = (Array.isArray(rawOptions) ? rawOptions : [])
        .map((option: any) => {
          const value =
            option?.value ??
            option?.id ??
            option?.key ??
            option?.tableId ??
            option?.name
          if (!value) return null
          const label =
            option?.label ??
            option?.name ??
            option?.title ??
            option?.displayName ??
            `${value}`
          return {
            value: typeof value === 'string' ? value : `${value}`,
            label: typeof label === 'string' ? label : `${label}`,
          }
        })
        .filter(Boolean) as Array<{ value: string; label: string }>

      setManualFieldOptions(prev => ({
        ...prev,
        [field.name]: normalized,
      }))
    } catch (error: any) {
      setManualFieldErrors(prev => ({
        ...prev,
        [field.name]: error?.message || 'Failed to load options',
      }))
    } finally {
      setManualFieldLoading(prev => ({ ...prev, [field.name]: false }))
    }
  }, [manualFieldValues, providerConfig?.displayName, providerIntegration?.id, selectedProvider])

  const normalizeAirtableBase = (item: any, fallbackLabel = 'Untitled Base') => ({
    id: item?.id || item?.base_id || item?.value || item?.key || '',
    name: item?.name || item?.label || item?.baseName || item?.title || fallbackLabel,
  })

  const normalizeAirtableTable = (item: any, fallbackLabel = 'Untitled Table') => ({
    id: item?.id || item?.tableId || item?.value || item?.key || '',
    name: item?.name || item?.label || item?.tableName || item?.title || fallbackLabel,
  })

  const normalizeAirtableField = (item: any) => ({
    id: item?.id || item?.value || item?.key || item?.name || '',
    name: item?.name || item?.label || item?.value || 'Untitled Field',
    type: item?.type,
  })

  const normalizeAirtableRecord = (item: any) => {
    const fallback = item?.id || 'record'
    if (!item || typeof item !== 'object') {
      return { id: fallback, label: fallback }
    }
    const fields = item.fields || {}
    const preferredKeys = ['Name', 'Title', 'Record Name']
    let label = preferredKeys
      .map(key => fields[key])
      .find(Boolean) as string | undefined
    if (!label) {
      const firstValue = Object.values(fields)[0]
      label = typeof firstValue === 'string' ? firstValue : fallback
    }
    return {
      id: item.id || fallback,
      label: label || fallback,
    }
  }

  const fetchAirtableData = useCallback(async (dataType: string, options: Record<string, any> = {}) => {
    if (!providerIntegration?.id) {
      throw new Error('Connect the Airtable integration to load data.')
    }
    const response = await fetch('/api/integrations/fetch-user-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        integrationId: providerIntegration.id,
        dataType,
        options,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(errorText || `Failed to load ${dataType}`)
    }

    const payload = await response.json()
    return Array.isArray(payload?.data) ? payload.data : payload
  }, [providerIntegration?.id])

  const handleOpenAirtableModal = useCallback(async () => {
    if (!providerIntegration?.id) {
      toast({
        title: 'Connect Airtable',
        description: 'Please connect your Airtable account before selecting data.',
        variant: 'destructive',
      })
      return
    }
    setIsAirtableModalOpen(true)
    if (airtableBases.length === 0) {
      try {
        setAirtableLoading(prev => ({ ...prev, bases: true }))
        const data = await fetchAirtableData('airtable_bases')
        const normalized = (Array.isArray(data) ? data : []).map((item: any, index: number) =>
          normalizeAirtableBase(item, `Base ${index + 1}`)
        ).filter(base => base.id)
        setAirtableBases(normalized)
      } catch (error: any) {
        toast({
          title: 'Failed to load bases',
          description: error?.message || 'Unknown error while loading Airtable bases.',
          variant: 'destructive',
        })
      } finally {
        setAirtableLoading(prev => ({ ...prev, bases: false }))
      }
    }
  }, [airtableBases.length, fetchAirtableData, providerIntegration?.id, toast])

  const handleSelectAirtableBase = useCallback(async (baseId: string) => {
    setAirtableSelection(prev => ({
      ...prev,
      baseId,
      tableId: '',
      tableName: '',
      filterField: '',
      filterValue: '',
      searchField: '',
      searchValue: '',
      attachmentField: '',
      watchedFieldIds: [],
      recordId: '',
      recordIds: [],
    }))
    setAirtableTables([])
    setAirtableFields([])
    setAirtableRecords([])
    setAirtableFilterValues([])
    if (!baseId) return
    try {
      setAirtableLoading(prev => ({ ...prev, tables: true }))
      const data = await fetchAirtableData('airtable_tables', { baseId })
      const normalized = (Array.isArray(data) ? data : []).map((item: any, index: number) =>
        normalizeAirtableTable(item, `Table ${index + 1}`)
      ).filter(table => table.id)
      setAirtableTables(normalized)
    } catch (error: any) {
      toast({
        title: 'Failed to load tables',
        description: error?.message || 'Unknown error while loading Airtable tables.',
        variant: 'destructive',
      })
    } finally {
      setAirtableLoading(prev => ({ ...prev, tables: false }))
    }
  }, [fetchAirtableData, toast])

  const handleSelectAirtableTable = useCallback(async (tableId: string) => {
    const table = airtableTables.find(t => t.id === tableId)
    setAirtableSelection(prev => ({
      ...prev,
      tableId,
      tableName: table?.name || tableId,
      filterField: '',
      filterValue: '',
      searchField: '',
      searchValue: '',
      attachmentField: '',
      watchedFieldIds: [],
      recordId: '',
      recordIds: [],
    }))
    setAirtableFields([])
    setAirtableRecords([])
    setAirtableFilterValues([])
    if (!tableId || !airtableSelection.baseId) return
    try {
      setAirtableLoading(prev => ({ ...prev, fields: true }))
      const data = await fetchAirtableData('airtable_fields', {
        baseId: airtableSelection.baseId,
        tableName: tableId,
      })
      const normalized = (Array.isArray(data) ? data : []).map((item: any) => normalizeAirtableField(item)).filter(field => field.id)
      setAirtableFields(normalized)
    } catch (error: any) {
      toast({
        title: 'Failed to load fields',
        description: error?.message || 'Unknown error while loading Airtable fields.',
        variant: 'destructive',
      })
    } finally {
      setAirtableLoading(prev => ({ ...prev, fields: false }))
    }
  }, [airtableSelection.baseId, airtableTables, fetchAirtableData, toast])

  const loadAirtableFilterValues = useCallback(async (fieldId: string) => {
    if (!fieldId || !airtableSelection.baseId || (!airtableSelection.tableId && !airtableSelection.tableName)) {
      setAirtableFilterValues([])
      return
    }
    try {
      setAirtableLoading(prev => ({ ...prev, filterValues: true }))
      const data = await fetchAirtableData('airtable_field_values', {
        baseId: airtableSelection.baseId,
        tableName: airtableSelection.tableId || airtableSelection.tableName,
        filterField: fieldId,
      })
      const normalized = (Array.isArray(data?.data) ? data.data : data || [])
        .map((value: any) => value?.value ?? value?.label ?? value)
        .filter(Boolean)
        .map((value: any) => (typeof value === 'string' ? value : JSON.stringify(value)))
      setAirtableFilterValues(normalized as string[])
    } catch (error: any) {
      setAirtableFilterValues([])
      toast({
        title: 'Failed to load field values',
        description: error?.message || 'Unknown error while loading Airtable field values.',
        variant: 'destructive',
      })
    } finally {
      setAirtableLoading(prev => ({ ...prev, filterValues: false }))
    }
  }, [airtableSelection.baseId, airtableSelection.tableId, airtableSelection.tableName, fetchAirtableData, toast])

  const handleLoadAirtableRecords = useCallback(async () => {
    if (!airtableSelection.baseId || (!airtableSelection.tableId && !airtableSelection.tableName)) {
      toast({
        title: 'Select a base and table',
        description: 'Choose a base and table before loading records.',
        variant: 'destructive',
      })
      return
    }
    try {
      setAirtableLoading(prev => ({ ...prev, records: true }))
      const data = await fetchAirtableData('airtable_records', {
        baseId: airtableSelection.baseId,
        tableName: airtableSelection.tableId || airtableSelection.tableName,
        maxRecords: 25,
      })
      const normalized = (Array.isArray(data?.records) ? data.records : data || [])
        .map((record: any) => normalizeAirtableRecord(record))
      setAirtableRecords(normalized)
    } catch (error: any) {
      toast({
        title: 'Failed to load records',
        description: error?.message || 'Unknown error while loading Airtable records.',
        variant: 'destructive',
      })
    } finally {
      setAirtableLoading(prev => ({ ...prev, records: false }))
    }
  }, [airtableSelection.baseId, airtableSelection.tableId, airtableSelection.tableName, fetchAirtableData, toast])

  const handleApplyAirtableSelection = useCallback(() => {
    if (!airtableSelection.baseId || !airtableSelection.tableName) {
      toast({
        title: 'Missing base or table',
        description: 'Please select a base and a table before applying.',
        variant: 'destructive',
      })
      return
    }

    const nextValues: Record<string, any> = {
      baseId: airtableSelection.baseId,
      tableName: airtableSelection.tableName,
    }

    if (airtableSelection.tableId) {
      nextValues.tableId = airtableSelection.tableId
    }
    if (airtableSelection.filterField) {
      nextValues.filterField = airtableSelection.filterField
    }
    if (airtableSelection.filterValue) {
      nextValues.filterValue = airtableSelection.filterValue
    }
    if (airtableSelection.searchField) {
      nextValues.searchField = airtableSelection.searchField
    }
    if (airtableSelection.searchValue) {
      nextValues.searchValue = airtableSelection.searchValue
    }
    if (airtableSelection.attachmentField) {
      nextValues.attachmentField = airtableSelection.attachmentField
    }
    if (airtableSelection.watchedFieldIds.length > 0) {
      nextValues.watchedFieldIds = airtableSelection.watchedFieldIds
    }
    if (airtableSelection.recordId) {
      nextValues.recordId = airtableSelection.recordId
    }
    if (airtableSelection.recordIds.length > 0) {
      nextValues.recordIds = airtableSelection.recordIds.join(',')
    }

    setTestData(prev => ({ ...prev, ...nextValues }))
    setIsAirtableModalOpen(false)
    toast({
      title: 'Airtable data selected',
      description: 'Values saved for upcoming tests.',
    })
  }, [airtableSelection, toast])

  const handleFieldTargetChange = useCallback((key: 'filterField' | 'searchField' | 'attachmentField', value: string) => {
    setAirtableSelection(prev => ({
      ...prev,
      [key]: value,
    }))
    if (key === 'filterField') {
      setAirtableSelection(prev => ({ ...prev, filterValue: '' }))
      if (value) {
        loadAirtableFilterValues(value)
      } else {
        setAirtableFilterValues([])
      }
    }
  }, [loadAirtableFilterValues])

  const toggleWatchedField = useCallback((fieldId: string) => {
    setAirtableSelection(prev => {
      const exists = prev.watchedFieldIds.includes(fieldId)
      return {
        ...prev,
        watchedFieldIds: exists
          ? prev.watchedFieldIds.filter(id => id !== fieldId)
          : [...prev.watchedFieldIds, fieldId],
      }
    })
  }, [])

  const toggleSelectedRecord = useCallback((recordId: string) => {
    setAirtableSelection(prev => ({
      ...prev,
      recordId,
    }))
  }, [])

  const toggleSelectedRecordIds = useCallback((recordId: string) => {
    setAirtableSelection(prev => {
      const exists = prev.recordIds.includes(recordId)
      return {
        ...prev,
        recordIds: exists
          ? prev.recordIds.filter(id => id !== recordId)
          : [...prev.recordIds, recordId],
      }
    })
  }, [])

  const handleManualFieldValueChange = (fieldName: string, value: string) => {
    const dependentFields =
      missingFieldsData?.fields.filter(field => {
        if (!field.dependsOn) return false
        const deps = Array.isArray(field.dependsOn) ? field.dependsOn : [field.dependsOn]
        return deps.includes(fieldName)
      }) || []

    setManualFieldValues(prev => {
      const updated = { ...prev, [fieldName]: value }
      dependentFields.forEach(dep => {
        delete updated[dep.name]
      })
      return updated
    })

    if (dependentFields.length) {
      setManualFieldOptions(prev => {
        const updated = { ...prev }
        dependentFields.forEach(dep => {
          delete updated[dep.name]
        })
        return updated
      })
      setManualFieldErrors(prev => {
        const updated = { ...prev }
        dependentFields.forEach(dep => {
          delete updated[dep.name]
        })
        return updated
      })
      setManualFieldLoading(prev => {
        const updated = { ...prev }
        dependentFields.forEach(dep => {
          delete updated[dep.name]
        })
        return updated
      })
    }

    dependentFields.forEach(dep => {
      loadManualFieldOptions(dep, { [fieldName]: value })
    })
  }

  useEffect(() => {
    if (!showMissingFieldsDialog) {
      setManualFieldValues({})
      setManualFieldOptions({})
      setManualFieldErrors({})
      setManualFieldLoading({})
    }
  }, [showMissingFieldsDialog])

  useEffect(() => {
    if (!showMissingFieldsDialog || !missingFieldsData) return

    missingFieldsData.fields
      .filter(field => field.dynamic && !field.dependsOn)
      .forEach(field => loadManualFieldOptions(field))
  }, [showMissingFieldsDialog, missingFieldsData, loadManualFieldOptions])

  // Selective testing helpers
  const getTestId = (type: 'action' | 'trigger', name: string) => `${type}:${name}`

  const toggleTestSelection = (type: 'action' | 'trigger', name: string) => {
    const testId = getTestId(type, name)
    setSelectedTests(prev => {
      const newSet = new Set(prev)
      if (newSet.has(testId)) {
        newSet.delete(testId)
      } else {
        newSet.add(testId)
      }
      return newSet
    })
  }

  const selectAllTests = () => {
    if (!providerConfig) return
    const allTestIds = new Set([
      ...providerConfig.actions.map(a => getTestId('action', a.actionName)),
      ...providerConfig.triggers.map(t => getTestId('trigger', t.triggerName)),
    ])
    setSelectedTests(allTestIds)
  }

  const deselectAllTests = () => {
    setSelectedTests(new Set())
  }

  const getTestsToRun = (): Array<{ type: 'action' | 'trigger'; name: string; nodeType: string }> => {
    if (!providerConfig) return []

    const allTests = [
      ...providerConfig.actions.map(a => ({ type: 'action' as const, name: a.actionName, nodeType: a.nodeType })),
      ...providerConfig.triggers.map(t => ({ type: 'trigger' as const, name: t.triggerName, nodeType: t.nodeType })),
    ]

    if (testMode === 'all') {
      return allTests
    } else if (testMode === 'selected') {
      return allTests.filter(test => selectedTests.has(getTestId(test.type, test.name)))
    } else if (testMode === 'failed') {
      return allTests.filter(test => failedTests.has(getTestId(test.type, test.name)))
    }

    return allTests
  }

  // Test preset helpers
  const loadPresetsFromStorage = () => {
    try {
      const stored = localStorage.getItem('integration-test-presets')
      if (stored) {
        setSavedPresets(JSON.parse(stored))
      }
    } catch (error) {
      console.error('Failed to load presets:', error)
    }
  }

  const savePreset = () => {
    if (!presetName.trim()) return

    const newPresets = {
      ...savedPresets,
      [presetName]: { ...testData },
    }

    setSavedPresets(newPresets)
    localStorage.setItem('integration-test-presets', JSON.stringify(newPresets))
    setPresetName('')
    setShowPresetsDialog(false)
  }

  const loadPreset = (name: string) => {
    const preset = savedPresets[name]
    if (preset) {
      setTestData(preset)
      setShowPresetsDialog(false)
    }
  }

  const deletePreset = (name: string) => {
    const newPresets = { ...savedPresets }
    delete newPresets[name]
    setSavedPresets(newPresets)
    localStorage.setItem('integration-test-presets', JSON.stringify(newPresets))
  }

  // Load presets on mount
  useEffect(() => {
    loadPresetsFromStorage()
  }, [])

  // Dry run validation
  const runDryRun = async () => {
    if (!providerConfig) return

    setIsRunning(true)
    setDryRunResults([])

    const testsToRun = getTestsToRun()
    const results: Array<{ test: string; valid: boolean; issues: string[] }> = []

    for (const test of testsToRun) {
      const nodeDefinition = ALL_NODE_COMPONENTS.find(n => n.type === test.nodeType)
      if (!nodeDefinition) {
        results.push({
          test: test.name,
          valid: false,
          issues: ['Node definition not found']
        })
        continue
      }

      const issues: string[] = []

      // Check required fields
      if (nodeDefinition.configSchema) {
        for (const field of nodeDefinition.configSchema) {
          if (field.required) {
            const hasValue = testData[field.name]
            if (!hasValue && !field.dynamic) {
              issues.push(`Missing required field: ${field.label || field.name}`)
            }
          }
        }
      }

      // Check integration connection
      if (!isConnected) {
        issues.push('Integration not connected')
      }

      results.push({
        test: test.name,
        valid: issues.length === 0,
        issues
      })
    }

    setDryRunResults(results)
    setIsRunning(false)
  }

  // Provider options for combobox
  const providerOptions = providers.map(config => ({
    value: config.provider,
    label: `${config.displayName} (${config.actions.length + config.triggers.length} tests)`,
  }))

  // Handle test data input
  const handleInputChange = (field: string, value: string) => {
    setTestData(prev => ({ ...prev, [field]: value }))
  }

  // Run tests
  const runTests = async () => {
    if (!providerConfig) return

    setIsRunning(true)

    // Get tests to run based on test mode
    const testsToRun = getTestsToRun()

    // Initialize session with only the tests we're running
    const newSession: TestSession = {
      provider: selectedProvider,
      providerName: providerConfig.displayName,
      status: 'running',
      startTime: Date.now(),
      results: testsToRun.map(test => ({
        type: test.type,
        name: test.name,
        status: 'pending' as const,
        logs: [],
        message: undefined,
        output: undefined,
      })),
    }

    setSession(newSession)

    try {
      // PR-AUTH-7: cached auth header.
      const { getAuthHeader } = await import('@/lib/auth/getAuthHeader')
      const authHeader = await getAuthHeader()
      if (!authHeader.Authorization) {
        throw new Error('Not authenticated')
      }

      // Call API to run tests
      const response = await fetch('/api/admin/test-integration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          provider: selectedProvider,
          testData,
          runActions: testsToRun.some(t => t.type === 'action'),
          runTriggers: testsToRun.some(t => t.type === 'trigger'),
          selectedTests: testMode !== 'all' ? testsToRun.map(t => t.nodeType) : undefined,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to run tests')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response stream')
      }

      // Read streaming results
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(line => line.trim())

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))

            // Check if error indicates missing fields
            if (data.error && data.error.includes('Missing required fields:')) {
              // Extract node type from the error context
              const nodeType = data.type === 'action'
                ? providerConfig?.actions.find(a => a.actionName === data.name)?.nodeType
                : providerConfig?.triggers.find(t => t.triggerName === data.name)?.nodeType

              if (nodeType) {
                // Fetch field requirements
                handleMissingFields(nodeType, data.name)
              }
            }

            // Track failed tests
            if (data.status === 'failed') {
              setFailedTests(prev => {
                const newSet = new Set(prev)
                newSet.add(getTestId(data.type, data.name))
                return newSet
              })
            }

            // Update session with new result
            setSession(prev => {
              if (!prev) return prev

              const updatedResults = prev.results.map(r => {
                if (r.type === data.type && r.name === data.name) {
                  return {
                    ...r,
                    status: data.status,
                    error: data.error,
                    duration: data.duration,
                    logs: data.logs ?? r.logs,
                    message: data.message ?? r.message,
                    output: data.output ?? r.output,
                  }
                }
                return r
              })

              return {
                ...prev,
                results: updatedResults,
                status: data.completed ? 'completed' : 'running',
                endTime: data.completed ? Date.now() : prev.endTime,
              }
            })
          }
        }
      }
    } catch (error: any) {
      console.error('Test execution error:', error)
      setSession(prev => prev ? {
        ...prev,
        status: 'error',
        endTime: Date.now(),
      } : null)
    } finally {
      setIsRunning(false)
    }
  }

  // Export results as HTML
  const exportResults = () => {
    if (!session) return

    const html = generateHtmlReport(session)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `integration-test-${session.provider}-${Date.now()}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Calculate stats
  const stats = session ? {
    total: session.results.length,
    passed: session.results.filter(r => r.status === 'passed').length,
    failed: session.results.filter(r => r.status === 'failed').length,
    running: session.results.filter(r => r.status === 'running').length,
    pending: session.results.filter(r => r.status === 'pending').length,
    skipped: session.results.filter(r => r.status === 'skipped').length,
  } : null

  const progress = stats
    ? Math.round(((stats.passed + stats.failed + stats.skipped) / stats.total) * 100)
    : 0

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Integration Testing</h1>
        <p className="text-muted-foreground">
          Automatically test all actions and triggers for any integration. Auto-discovers integrations from your codebase.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Configuration */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Test Configuration</CardTitle>
              <CardDescription>
                Select integration and configure test parameters
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Provider Selection */}
              <div className="space-y-2">
                <Label>Integration</Label>
                {isLoadingProviders ? (
                  <div className="flex items-center gap-2 p-2 border rounded">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Loading integrations...</span>
                  </div>
                ) : (
                  <Combobox
                    value={selectedProvider}
                    onChange={setSelectedProvider}
                    options={providerOptions}
                    placeholder="Select integration..."
                    searchPlaceholder="Search integrations..."
                  />
                )}
              </div>

              {/* Connection Status */}
              {providerConfig && (
                <div className="space-y-4">
                  {/* Connection Status Alert */}
                  {isLoadingConnection ? (
                    <Alert>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <AlertDescription>
                        Checking connection status...
                      </AlertDescription>
                    </Alert>
                  ) : isConnected ? (
                    <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                      <Link2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <AlertDescription className="text-green-900 dark:text-green-100">
                        <div className="space-y-1">
                          <div className="font-medium">Connected</div>
                          {providerIntegration?.email && (
                            <div className="text-xs opacity-80">{providerIntegration.email}</div>
                          )}
                          {providerIntegration?.account_name && (
                            <div className="text-xs opacity-80">{providerIntegration.account_name}</div>
                          )}
                          {providerIntegration?.username && (
                            <div className="text-xs opacity-80">@{providerIntegration.username}</div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  ) : needsReconnection ? (
                    <Alert className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                      <Link2Off className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <AlertDescription className="text-amber-900 dark:text-amber-100">
                        <div className="space-y-2">
                          <div className="font-medium">Connection expired</div>
                          <div className="text-xs">Please reconnect this integration to run tests</div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleConnect}
                            disabled={isConnecting}
                            className="mt-2 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                          >
                            {isConnecting ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Reconnecting...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="mr-2 h-3 w-3" />
                                Reconnect
                              </>
                            )}
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                      <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <AlertDescription className="text-blue-900 dark:text-blue-100">
                        <div className="space-y-2">
                          <div className="font-medium">Not connected</div>
                          <div className="text-xs">Connect this integration before running tests</div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleConnect}
                            disabled={isConnecting}
                            className="mt-2 border-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                          >
                            {isConnecting ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Connecting...
                              </>
                            ) : (
                              <>
                                <Link2 className="mr-2 h-3 w-3" />
                                Connect {providerConfig.displayName}
                              </>
                            )}
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {connectionError && (
                    <Alert className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
                      <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                      <AlertDescription className="text-red-900 dark:text-red-100">
                        {connectionError}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Provider Info */}
                  <Alert>
                    <Activity className="h-4 w-4" />
                    <AlertDescription>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span>Actions:</span>
                          <Badge variant="outline">{providerConfig.actions.length}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Triggers:</span>
                          <Badge variant="outline">{providerConfig.triggers.length}</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Tests:</span>
                          <Badge variant="outline">
                            {providerConfig.actions.length + providerConfig.triggers.length}
                          </Badge>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                </div>
              )}

              {/* Test Data Inputs */}
              {providerConfig && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="test-email">Test Email</Label>
                    <Input
                      id="test-email"
                      type="email"
                      placeholder="test@example.com"
                      value={testData.email || ''}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Used for actions that require an email address
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="test-message">Test Message</Label>
                    <Input
                      id="test-message"
                      placeholder="Test message from ChainReact"
                      value={testData.message || ''}
                      onChange={(e) => handleInputChange('message', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Used for messaging/communication actions
                    </p>
                  </div>

                  <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                    <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <AlertDescription className="text-xs text-blue-900 dark:text-blue-100">
                      Other fields will be auto-filled with test values. You can customize them as needed.
                    </AlertDescription>
                  </Alert>

                  {isAirtableProvider && (
                    <div className="flex items-center justify-between gap-3 border rounded-md p-3 bg-muted/40">
                      <div className="text-sm text-muted-foreground">
                        Need a specific Airtable base, table, or field?
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenAirtableModal}
                        disabled={!providerIntegration?.id || isConnecting}
                      >
                        <Database className="mr-2 h-3 w-3" />
                        Select Airtable Data
                      </Button>
                    </div>
                  )}

                  {/* Test Presets */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPresetsDialog(true)}
                      className="flex-1"
                    >
                      <FolderOpen className="mr-2 h-3 w-3" />
                      Load Preset
                      {Object.keys(savedPresets).length > 0 && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {Object.keys(savedPresets).length}
                        </Badge>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPresetsDialog(true)}
                      disabled={!testData.email && !testData.message}
                    >
                      <Save className="mr-2 h-3 w-3" />
                      Save
                    </Button>
                  </div>
                </div>
              )}

              {/* Selective Testing */}
              {providerConfig && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      Test Selection
                    </Label>
                    {failedTests.size > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {failedTests.size} failed
                      </Badge>
                    )}
                  </div>

                  {/* Test Mode Selector */}
                  <div className="flex gap-2">
                    <Button
                      variant={testMode === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTestMode('all')}
                      className="flex-1"
                    >
                      All Tests
                    </Button>
                    <Button
                      variant={testMode === 'selected' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTestMode('selected')}
                      className="flex-1"
                      disabled={selectedTests.size === 0}
                    >
                      Selected ({selectedTests.size})
                    </Button>
                    <Button
                      variant={testMode === 'failed' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTestMode('failed')}
                      className="flex-1"
                      disabled={failedTests.size === 0}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Failed ({failedTests.size})
                    </Button>
                  </div>

                  {/* Select/Deselect All */}
                  {testMode === 'selected' && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={selectAllTests}
                        className="flex-1 text-xs"
                      >
                        <CheckSquare className="mr-1 h-3 w-3" />
                        Select All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={deselectAllTests}
                        className="flex-1 text-xs"
                      >
                        <Square className="mr-1 h-3 w-3" />
                        Deselect All
                      </Button>
                    </div>
                  )}

                  {/* Test List for Selection */}
                  {testMode === 'selected' && (
                    <ScrollArea className="h-[200px] border rounded-lg p-2">
                      <div className="space-y-1">
                        {/* Actions */}
                        {providerConfig.actions.length > 0 && (
                          <>
                            <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                              Actions
                            </div>
                            {providerConfig.actions.map(action => {
                              const testId = getTestId('action', action.actionName)
                              const isSelected = selectedTests.has(testId)
                              return (
                                <div
                                  key={testId}
                                  onClick={() => toggleTestSelection('action', action.actionName)}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
                                >
                                  {isSelected ? (
                                    <CheckSquare className="h-4 w-4 text-primary" />
                                  ) : (
                                    <Square className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <span className={cn(
                                    "flex-1 truncate",
                                    isSelected && "font-medium"
                                  )}>
                                    {action.actionName}
                                  </span>
                                  <Zap className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                </div>
                              )
                            })}
                          </>
                        )}

                        {/* Triggers */}
                        {providerConfig.triggers.length > 0 && (
                          <>
                            <div className="text-xs font-medium text-muted-foreground px-2 py-1 mt-2">
                              Triggers
                            </div>
                            {providerConfig.triggers.map(trigger => {
                              const testId = getTestId('trigger', trigger.triggerName)
                              const isSelected = selectedTests.has(testId)
                              return (
                                <div
                                  key={testId}
                                  onClick={() => toggleTestSelection('trigger', trigger.triggerName)}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
                                >
                                  {isSelected ? (
                                    <CheckSquare className="h-4 w-4 text-primary" />
                                  ) : (
                                    <Square className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <span className={cn(
                                    "flex-1 truncate",
                                    isSelected && "font-medium"
                                  )}>
                                    {trigger.triggerName}
                                  </span>
                                  <Target className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                </div>
                              )
                            })}
                          </>
                        )}
                      </div>
                    </ScrollArea>
                  )}

                  {/* Info Alert */}
                  <Alert className="text-xs">
                    <AlertCircle className="h-3 w-3" />
                    <AlertDescription>
                      {testMode === 'all' && 'All tests will run'}
                      {testMode === 'selected' && selectedTests.size === 0 && 'Select tests above to run specific tests'}
                      {testMode === 'selected' && selectedTests.size > 0 && `${selectedTests.size} test${selectedTests.size === 1 ? '' : 's'} will run`}
                      {testMode === 'failed' && failedTests.size === 0 && 'No failed tests to retry'}
                      {testMode === 'failed' && failedTests.size > 0 && `${failedTests.size} failed test${failedTests.size === 1 ? '' : 's'} will be retried`}
                    </AlertDescription>
                  </Alert>
                </div>
              )}

              {/* Dry Run Mode */}
              {providerConfig && (
                <div className="flex items-center justify-between space-x-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="dry-run"
                      checked={isDryRun}
                      onCheckedChange={setIsDryRun}
                    />
                    <Label htmlFor="dry-run" className="flex items-center gap-2 cursor-pointer">
                      <Bug className="h-4 w-4" />
                      Dry Run (Validate Only)
                    </Label>
                  </div>
                </div>
              )}

              {/* Run Button */}
              <Button
                onClick={isDryRun ? runDryRun : runTests}
                disabled={
                  !selectedProvider ||
                  isRunning ||
                  (!isDryRun && !isConnected) ||
                  (testMode === 'selected' && selectedTests.size === 0) ||
                  (testMode === 'failed' && failedTests.size === 0)
                }
                className="w-full"
                size="lg"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {isDryRun ? 'Validating...' : 'Running Tests...'}
                  </>
                ) : (
                  <>
                    {isDryRun ? (
                      <>
                        <Eye className="mr-2 h-4 w-4" />
                        Validate Configuration
                      </>
                    ) : testMode === 'failed' ? (
                      <>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Retry {failedTests.size} Failed Test{failedTests.size === 1 ? '' : 's'}
                      </>
                    ) : testMode === 'selected' ? (
                      <>
                        <PlayCircle className="mr-2 h-4 w-4" />
                        Run {selectedTests.size} Selected Test{selectedTests.size === 1 ? '' : 's'}
                      </>
                    ) : (
                      <>
                        <PlayCircle className="mr-2 h-4 w-4" />
                        Run All Tests
                      </>
                    )}
                  </>
                )}
              </Button>
              {!isConnected && selectedProvider && (
                <p className="text-xs text-center text-muted-foreground">
                  Connect the integration above to enable testing
                </p>
              )}
              {testMode === 'selected' && selectedTests.size === 0 && (
                <p className="text-xs text-center text-muted-foreground">
                  Select at least one test to run
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Results */}
        <div className="lg:col-span-2">
          {dryRunResults ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bug className="h-5 w-5" />
                      Dry Run Results
                    </CardTitle>
                    <CardDescription>
                      Configuration validation (no tests executed)
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDryRunResults(null)}
                  >
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 gap-4 pb-4 border-b">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{dryRunResults.length}</div>
                      <div className="text-xs text-muted-foreground">Total</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {dryRunResults.filter(r => r.valid).length}
                      </div>
                      <div className="text-xs text-muted-foreground">Valid</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">
                        {dryRunResults.filter(r => !r.valid).length}
                      </div>
                      <div className="text-xs text-muted-foreground">Issues</div>
                    </div>
                  </div>

                  {/* Results List */}
                  <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-2">
                      {dryRunResults.map((result, index) => (
                        <div
                          key={index}
                          className={cn(
                            "border rounded-lg p-4 transition-colors",
                            result.valid
                              ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20"
                              : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {result.valid ? (
                              <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
                            )}
                            <div className="flex-1">
                              <div className="font-medium">{result.test}</div>
                              {!result.valid && result.issues.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                  {result.issues.map((issue, i) => (
                                    <li key={i} className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                                      <span className="text-xs">•</span>
                                      <span>{issue}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {result.valid && (
                                <div className="text-sm text-green-600 dark:text-green-400 mt-1">
                                  Ready to run
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  {/* Ready to Run Message */}
                  {dryRunResults.every(r => r.valid) && (
                    <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <AlertDescription className="text-green-900 dark:text-green-100">
                        <div className="font-medium">All tests are ready to run!</div>
                        <div className="text-xs mt-1">
                          Turn off Dry Run mode and click the run button to execute tests
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : !session ? (
            <Card className="h-full flex items-center justify-center">
              <CardContent className="text-center py-12">
                <Target className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Tests Running</h3>
                <p className="text-muted-foreground mb-4">
                  Select an integration and click "Run All Tests" to begin
                </p>
                {!isLoadingProviders && (
                  <p className="text-sm text-muted-foreground">
                    {providers.length} integrations available with{' '}
                    {providers.reduce((sum, p) => sum + p.actions.length + p.triggers.length, 0)} total tests
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Progress Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Test Progress</CardTitle>
                      <CardDescription>
                        {session.providerName}
                      </CardDescription>
                    </div>
                    {session.status === 'completed' && (
                      <Button variant="outline" size="sm" onClick={exportResults}>
                        <Download className="mr-2 h-4 w-4" />
                        Export Report
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <Progress value={progress} className="h-2" />

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{stats?.total}</div>
                        <div className="text-xs text-muted-foreground">Total</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{stats?.passed}</div>
                        <div className="text-xs text-muted-foreground">Passed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">{stats?.failed}</div>
                        <div className="text-xs text-muted-foreground">Failed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{stats?.running}</div>
                        <div className="text-xs text-muted-foreground">Running</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-amber-600">{stats?.skipped}</div>
                        <div className="text-xs text-muted-foreground">Skipped</div>
                      </div>
                    </div>

                    {session.endTime && session.startTime && (
                      <div className="text-center text-sm text-muted-foreground">
                        Completed in {((session.endTime - session.startTime) / 1000).toFixed(2)}s
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Results Tabs */}
              <Card>
                <Tabs defaultValue="all" className="w-full">
                  <CardHeader>
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="all">
                        All ({session.results.length})
                      </TabsTrigger>
                      <TabsTrigger value="actions">
                        <Zap className="h-4 w-4 mr-1" />
                        Actions ({session.results.filter(r => r.type === 'action').length})
                      </TabsTrigger>
                      <TabsTrigger value="triggers">
                        <Target className="h-4 w-4 mr-1" />
                        Triggers ({session.results.filter(r => r.type === 'trigger').length})
                      </TabsTrigger>
                    </TabsList>
                  </CardHeader>

                  <CardContent>
                    <TabsContent value="all" className="mt-0">
                      <TestResultsList results={session.results} />
                    </TabsContent>

                    <TabsContent value="actions" className="mt-0">
                      <TestResultsList
                        results={session.results.filter(r => r.type === 'action')}
                      />
                    </TabsContent>

                    <TabsContent value="triggers" className="mt-0">
                      <TestResultsList
                        results={session.results.filter(r => r.type === 'trigger')}
                      />
                    </TabsContent>
                  </CardContent>
                </Tabs>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Airtable Selector Dialog */}
      {isAirtableProvider && (
        <Dialog open={isAirtableModalOpen} onOpenChange={setIsAirtableModalOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Select Airtable Data</DialogTitle>
              <DialogDescription>
                Choose the base, table, fields, and records to use for automated tests.
              </DialogDescription>
            </DialogHeader>
            {!providerIntegration?.id ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Connect your Airtable account in the section above to load data.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Base</Label>
                    <GenericSelectField
                      field={{
                        name: 'airtable_base',
                        label: 'Base',
                        type: 'select',
                        placeholder: 'Select a base',
                      }}
                      value={airtableSelection.baseId}
                      onChange={(value) => handleSelectAirtableBase(value as string)}
                      options={airtableBases.map(base => ({
                        value: base.id,
                        label: base.name,
                      }))}
                      isLoading={airtableLoading.bases}
                      nodeInfo={{ providerId: 'airtable' }}
                      parentValues={{}}
                      workflowNodes={[]}
                    />
                    {airtableLoading.bases && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading bases...
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Table</Label>
                    <GenericSelectField
                      field={{
                        name: 'airtable_table',
                        label: 'Table',
                        type: 'select',
                        placeholder: airtableSelection.baseId ? 'Select a table' : 'Choose a base first',
                      }}
                      value={airtableSelection.tableId}
                      onChange={(value) => handleSelectAirtableTable(value as string)}
                      options={airtableTables.map(table => ({
                        value: table.id,
                        label: table.name,
                      }))}
                      isLoading={airtableLoading.tables}
                      nodeInfo={{ providerId: 'airtable' }}
                      parentValues={{}}
                      workflowNodes={[]}
                    />
                    {airtableLoading.tables && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading tables...
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Filter Field</Label>
                    <GenericSelectField
                      field={{
                        name: 'airtable_filter_field',
                        label: 'Filter Field',
                        type: 'select',
                        placeholder: airtableFields.length ? 'Select field' : 'Select a table first',
                      }}
                      value={airtableSelection.filterField}
                      onChange={(value) => handleFieldTargetChange('filterField', value as string)}
                      options={airtableFields.map(field => ({
                        value: field.id,
                        label: field.name,
                      }))}
                      isLoading={airtableLoading.fields}
                      nodeInfo={{ providerId: 'airtable' }}
                      parentValues={{}}
                      workflowNodes={[]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Filter Value</Label>
                    {airtableFilterValues.length > 0 ? (
                      <GenericSelectField
                        field={{
                          name: 'airtable_filter_value',
                          label: 'Filter Value',
                          type: 'select',
                          placeholder: 'Select a value',
                        }}
                        value={airtableSelection.filterValue}
                        onChange={(value) => setAirtableSelection(prev => ({ ...prev, filterValue: value as string }))}
                        options={airtableFilterValues.map(value => ({
                          value,
                          label: value,
                        }))}
                        isLoading={airtableLoading.filterValues}
                        nodeInfo={{ providerId: 'airtable' }}
                        parentValues={{}}
                        workflowNodes={[]}
                      />
                    ) : (
                      <Input
                        value={airtableSelection.filterValue}
                        onChange={(event) => setAirtableSelection(prev => ({ ...prev, filterValue: event.target.value }))}
                        placeholder="Type a value"
                        disabled={!airtableSelection.filterField}
                      />
                    )}
                    {airtableLoading.filterValues && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading field values...
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Search Field</Label>
                    <GenericSelectField
                      field={{
                        name: 'airtable_search_field',
                        label: 'Search Field',
                        type: 'select',
                        placeholder: airtableFields.length ? 'Select field' : 'Select a table first',
                      }}
                      value={airtableSelection.searchField}
                      onChange={(value) => handleFieldTargetChange('searchField', value as string)}
                      options={airtableFields.map(field => ({
                        value: field.id,
                        label: field.name,
                      }))}
                      isLoading={airtableLoading.fields}
                      nodeInfo={{ providerId: 'airtable' }}
                      parentValues={{}}
                      workflowNodes={[]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Search Value</Label>
                    <Input
                      value={airtableSelection.searchValue}
                      onChange={(event) => setAirtableSelection(prev => ({ ...prev, searchValue: event.target.value }))}
                      placeholder="Type keywords"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Attachment Field</Label>
                    <GenericSelectField
                      field={{
                        name: 'airtable_attachment_field',
                        label: 'Attachment Field',
                        type: 'select',
                        placeholder: airtableFields.length ? 'Select field' : 'Select a table first',
                      }}
                      value={airtableSelection.attachmentField}
                      onChange={(value) => handleFieldTargetChange('attachmentField', value as string)}
                      options={airtableFields.map(field => ({
                        value: field.id,
                        label: field.name,
                      }))}
                      isLoading={airtableLoading.fields}
                      nodeInfo={{ providerId: 'airtable' }}
                      parentValues={{}}
                      workflowNodes={[]}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Watched Fields (multi-select)</Label>
                  <div className="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                    {airtableFields.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Select a table to load fields.</p>
                    ) : (
                      airtableFields.map(field => (
                        <label key={field.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={airtableSelection.watchedFieldIds.includes(field.id)}
                            onChange={() => toggleWatchedField(field.id)}
                          />
                          <span>{field.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="mb-0">Records</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleLoadAirtableRecords}
                      disabled={
                        !airtableSelection.baseId ||
                        (!airtableSelection.tableId && !airtableSelection.tableName) ||
                        airtableLoading.records
                      }
                    >
                      {airtableLoading.records ? (
                        <>
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          Loading
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-2 h-3 w-3" />
                          Load Records
                        </>
                      )}
                    </Button>
                  </div>
                  {airtableRecords.length === 0 ? (
                    <p className="text-xs text-muted-foreground border rounded-md p-3">
                      Load records to pick IDs for update/delete actions.
                    </p>
                  ) : (
                    <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                      {airtableRecords.map(record => (
                        <div key={record.id} className="p-3 space-y-2">
                          <label className="flex items-center gap-2 text-sm font-medium">
                            <input
                              type="radio"
                              name="airtable-record"
                              checked={airtableSelection.recordId === record.id}
                              onChange={() => toggleSelectedRecord(record.id)}
                            />
                            <span>{record.label}</span>
                            <span className="text-xs text-muted-foreground">({record.id})</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground pl-6">
                            <input
                              type="checkbox"
                              checked={airtableSelection.recordIds.includes(record.id)}
                              onChange={() => toggleSelectedRecordIds(record.id)}
                            />
                            <span>Select for multi-update</span>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <Button variant="outline" onClick={() => setIsAirtableModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleApplyAirtableSelection}
                    disabled={!airtableSelection.baseId || !airtableSelection.tableName}
                  >
                    Use Selection
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Test Presets Dialog */}
      <Dialog open={showPresetsDialog} onOpenChange={setShowPresetsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                Test Data Presets
              </div>
            </DialogTitle>
            <DialogDescription>
              Save and load test data configurations for quick testing
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Save New Preset */}
            <div className="space-y-2 pb-4 border-b">
              <Label>Save Current Data as Preset</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Preset name..."
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      savePreset()
                    }
                  }}
                />
                <Button
                  onClick={savePreset}
                  disabled={!presetName.trim()}
                  size="sm"
                >
                  <Save className="h-4 w-4" />
                </Button>
              </div>
              {Object.keys(testData).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Enter test data first before saving a preset
                </p>
              )}
            </div>

            {/* Saved Presets List */}
            <div className="space-y-2">
              <Label>Saved Presets ({Object.keys(savedPresets).length})</Label>
              {Object.keys(savedPresets).length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No presets saved yet
                </div>
              ) : (
                <ScrollArea className="h-[200px] border rounded-lg p-2">
                  <div className="space-y-1">
                    {Object.entries(savedPresets).map(([name, data]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between p-2 rounded hover:bg-accent group"
                      >
                        <button
                          onClick={() => loadPreset(name)}
                          className="flex-1 text-left text-sm font-medium truncate"
                        >
                          {name}
                        </button>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-xs">
                            {Object.keys(data).length} fields
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              deletePreset(name)
                            }}
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPresetsDialog(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Missing Fields Dialog */}
      <Dialog open={showMissingFieldsDialog} onOpenChange={setShowMissingFieldsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <Edit3 className="h-5 w-5" />
                Manual Field Input Required
              </div>
            </DialogTitle>
            <DialogDescription>
              Some fields couldn't be auto-loaded from your connected account.
              Please provide values manually for: <strong>{missingFieldsData?.nodeName}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {missingFieldsData?.fields.map(field => {
              const options = manualFieldOptions[field.name] || []
              const loading = manualFieldLoading[field.name]
              const selectedValue = manualFieldValues[field.name] || ''
              const dependencies = Array.isArray(field.dependsOn)
                ? field.dependsOn
                : field.dependsOn
                  ? [field.dependsOn]
                  : []
              const requiresDependency = dependencies.length > 0 && dependencies.some(dep => !manualFieldValues[dep])

              return (
                <div key={field.name} className="space-y-2">
                  <Label htmlFor={`manual-${field.name}`}>
                    {field.label}
                    {field.dynamic && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {field.dynamic}
                      </Badge>
                    )}
                  </Label>
                  {field.dynamic ? (
                    <>
                      <Select
                        value={selectedValue}
                        onValueChange={(value) => handleManualFieldValueChange(field.name, value)}
                        disabled={requiresDependency || loading || (options.length === 0 && !loading)}
                      >
                        <SelectTrigger id={`manual-${field.name}`}>
                          <SelectValue
                            placeholder={
                              loading
                                ? 'Loading options...'
                                : requiresDependency
                                  ? `Select ${dependencies.join(', ')} first`
                                  : options.length > 0
                                    ? `Select ${field.label.toLowerCase()}`
                                    : 'No options available'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {manualFieldErrors[field.name] && (
                        <p className="text-xs text-destructive">{manualFieldErrors[field.name]}</p>
                      )}
                      {loading && (
                        <p className="text-xs text-muted-foreground">Loading options…</p>
                      )}
                      {!loading && options.length === 0 && !requiresDependency && (
                        <p className="text-xs text-muted-foreground">
                          No options available from your {selectedProvider} account.
                        </p>
                      )}
                      {requiresDependency && (
                        <p className="text-xs text-muted-foreground">
                          Select {dependencies.join(', ')} first.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <Input
                        id={`manual-${field.name}`}
                        type={field.type === 'number' ? 'number' : 'text'}
                        placeholder={`Enter ${field.label.toLowerCase()}...`}
                        value={selectedValue}
                        onChange={(e) => handleManualFieldValueChange(field.name, e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        This field requires a value from your {selectedProvider} account
                      </p>
                    </>
                  )}
                </div>
              )
            })}

            {missingFieldsData?.fields.length === 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No dynamic fields found. This error might be caused by other validation issues.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowMissingFieldsDialog(false)
                setManualFieldValues({})
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleManualFieldSubmit}
              disabled={
                missingFieldsData?.fields.some(f => !manualFieldValues[f.name])
              }
            >
              Retry Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Test Results List Component
function TestResultsList({ results }: { results: TestResult[] }) {
  return (
    <ScrollArea className="h-[500px] pr-4">
      <div className="space-y-2">
        {results.map((result, index) => (
          <TestResultItem key={`${result.type}-${result.name}-${index}`} result={result} />
        ))}
      </div>
    </ScrollArea>
  )
}

// Test Result Item Component
function TestResultItem({ result }: { result: TestResult }) {
  const [isOpen, setIsOpen] = useState(false)

  const statusConfig = {
    pending: {
      icon: <Clock className="h-4 w-4 text-gray-400" />,
      container: 'border-gray-200 dark:border-gray-800',
      badge: 'bg-gray-100 text-gray-600 dark:bg-gray-900/50 dark:text-gray-100',
      label: 'Waiting to start',
    },
    running: {
      icon: <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />,
      container: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20',
      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
      label: 'Running now',
    },
    passed: {
      icon: <CheckCircle className="h-4 w-4 text-green-600" />,
      container: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20',
      badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
      label: 'Completed successfully',
    },
    failed: {
      icon: <XCircle className="h-4 w-4 text-red-600" />,
      container: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20',
      badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
      label: 'Execution failed',
    },
    skipped: {
      icon: <AlertCircle className="h-4 w-4 text-amber-600" />,
      container: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
      label: 'Skipped',
    },
  }[result.status]

  const formattedOutput = (() => {
    if (result.output == null || result.output === '') return ''
    if (typeof result.output === 'string') return result.output
    try {
      return JSON.stringify(result.output, null, 2)
    } catch {
      return String(result.output)
    }
  })()

  return (
    <div className={cn("border rounded-xl transition-colors", statusConfig.container)}>
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-full", statusConfig.badge)}>
            {statusConfig.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{result.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {result.message || statusConfig.label}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result.duration && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">{result.duration}ms</span>
          )}
          <Badge variant="outline" className="text-xs capitalize">
            {result.type}
          </Badge>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </div>
      </button>

      {isOpen && (
        <div className="border-t px-4 py-3 space-y-3 text-sm">
          {result.error && (
            <Alert className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <AlertDescription className="text-red-900 dark:text-red-100">
                {result.error}
              </AlertDescription>
            </Alert>
          )}

          {result.message && !result.error && (
            <div className="text-green-700 dark:text-green-300 font-medium">
              {result.message}
            </div>
          )}

          {formattedOutput && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Output
              </div>
              <pre className="bg-muted/60 rounded-md p-3 text-xs whitespace-pre-wrap break-all font-mono">
                {formattedOutput}
              </pre>
            </div>
          )}

          {result.logs && result.logs.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Logs
              </div>
              <div className="space-y-1">
                {result.logs.slice(0, 5).map((log, index) => (
                  <div key={index} className="text-xs font-mono text-muted-foreground bg-muted/40 rounded px-2 py-1">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Generate HTML report
function generateHtmlReport(session: TestSession): string {
  const passRate = session.results.filter(r => r.status === 'passed').length / session.results.length * 100
  const duration = session.endTime && session.startTime
    ? ((session.endTime - session.startTime) / 1000).toFixed(2)
    : '0'

  return `<!DOCTYPE html>
<html>
<head>
  <title>Integration Test Report - ${session.providerName}</title>
  <style>
    body { font-family: system-ui; padding: 20px; max-width: 1200px; margin: 0 auto; }
    h1 { color: #333; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
    .stat { background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 32px; font-weight: bold; }
    .stat-label { color: #666; font-size: 14px; }
    .result { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 6px; }
    .passed { background: #f0fdf4; border-color: #86efac; }
    .failed { background: #fef2f2; border-color: #fca5a5; }
    .error { color: #dc2626; margin-top: 10px; font-family: monospace; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Integration Test Report</h1>
  <h2>${session.providerName}</h2>
  <p>Generated: ${new Date().toLocaleString()}</p>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${session.results.length}</div>
      <div class="stat-label">Total Tests</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #16a34a;">${session.results.filter(r => r.status === 'passed').length}</div>
      <div class="stat-label">Passed</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #dc2626;">${session.results.filter(r => r.status === 'failed').length}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat">
      <div class="stat-value">${duration}s</div>
      <div class="stat-label">Duration</div>
    </div>
  </div>

  <h3>Test Results</h3>
  ${session.results.map(r => `
    <div class="result ${r.status}">
      <strong>${r.status === 'passed' ? '✅' : '❌'} ${r.name}</strong>
      <span style="background: #e5e7eb; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 10px;">${r.type}</span>
      ${r.duration ? `<span style="color: #666; margin-left: 10px;">${r.duration}ms</span>` : ''}
      ${r.error ? `<div class="error">${r.error}</div>` : ''}
    </div>
  `).join('')}
</body>
</html>`
}
