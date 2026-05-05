import { create } from 'zustand'
import { supabase } from "@/utils/supabaseClient"

// Define the workflow preferences type
export interface WorkflowPreferences {
  id: string
  user_id: string
  default_email_provider?: string
  default_calendar_provider?: string
  default_storage_provider?: string
  default_notification_provider?: string
  default_crm_provider?: string
  default_spreadsheet_provider?: string
  default_database_provider?: string
  default_channels: Record<string, string> // { "slack": "C123456", "discord": "789012" }
  node_config_defaults: Record<string, Record<string, any>> // { "gmail_trigger": { "filter": "all" } }
  created_at?: string
  updated_at?: string
}

// Category to column name mapping
const CATEGORY_COLUMN_MAP: Record<string, keyof WorkflowPreferences> = {
  email: 'default_email_provider',
  calendar: 'default_calendar_provider',
  storage: 'default_storage_provider',
  notification: 'default_notification_provider',
  crm: 'default_crm_provider',
  spreadsheet: 'default_spreadsheet_provider',
  database: 'default_database_provider',
}

interface WorkflowPreferencesStore {
  preferences: WorkflowPreferences | null
  loading: boolean
  error: string | null
  setPreferences: (preferences: WorkflowPreferences | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  getDefaultProvider: (category: string) => string | undefined
  getDefaultChannel: (providerId: string) => string | undefined
  getNodeConfigDefault: (nodeType: string) => Record<string, any> | undefined
}

// Create store for workflow preferences
export const useWorkflowPreferencesStore = create<WorkflowPreferencesStore>((set, get) => ({
  preferences: null,
  loading: false,
  error: null,
  setPreferences: (preferences) => set({ preferences }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  getDefaultProvider: (category: string) => {
    const { preferences } = get()
    if (!preferences) return undefined
    const column = CATEGORY_COLUMN_MAP[category]
    if (!column) return undefined
    return preferences[column] as string | undefined
  },

  getDefaultChannel: (providerId: string) => {
    const { preferences } = get()
    if (!preferences || !preferences.default_channels) return undefined
    return preferences.default_channels[providerId]
  },

  getNodeConfigDefault: (nodeType: string) => {
    const { preferences } = get()
    if (!preferences || !preferences.node_config_defaults) return undefined
    return preferences.node_config_defaults[nodeType]
  },
}))

// Load workflow preferences from Supabase
export async function loadWorkflowPreferences(): Promise<WorkflowPreferences | null> {
  try {
    const store = useWorkflowPreferencesStore.getState()
    store.setLoading(true)
    store.setError(null)

    // PR-AUTH-5: cached user id.
    const { useAuthStore } = await import('./authStore')
    const user = useAuthStore.getState().user
    if (!user) {
      throw new Error("No authenticated user")
    }

    // Fetch workflow preferences
    const { data, error } = await supabase
      .from("workflow_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()

    if (error) {
      throw error
    }

    // If no preferences exist yet, create default preferences object
    const preferences: WorkflowPreferences = data || {
      id: '',
      user_id: user.id,
      default_channels: {},
      node_config_defaults: {},
    }

    store.setPreferences(preferences)
    return preferences
  } catch (error: any) {
    const store = useWorkflowPreferencesStore.getState()
    store.setError(error.message || "Failed to load workflow preferences")
    return null
  } finally {
    const store = useWorkflowPreferencesStore.getState()
    store.setLoading(false)
  }
}

// Update workflow preferences
export async function updateWorkflowPreferences(
  updates: Partial<Omit<WorkflowPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<WorkflowPreferences | null> {
  try {
    const store = useWorkflowPreferencesStore.getState()
    store.setLoading(true)
    store.setError(null)

    // PR-AUTH-5: cached user id.
    const { useAuthStore } = await import('./authStore')
    const user = useAuthStore.getState().user
    if (!user) {
      throw new Error("No authenticated user")
    }

    // Upsert preferences (insert if not exists, update if exists)
    const { data, error } = await supabase
      .from("workflow_preferences")
      .upsert({
        user_id: user.id,
        ...updates,
      }, {
        onConflict: 'user_id',
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    store.setPreferences(data)
    return data
  } catch (error: any) {
    const store = useWorkflowPreferencesStore.getState()
    store.setError(error.message || "Failed to update workflow preferences")
    return null
  } finally {
    const store = useWorkflowPreferencesStore.getState()
    store.setLoading(false)
  }
}

// Set default provider for a category
export async function setDefaultProvider(
  category: string,
  providerId: string
): Promise<boolean> {
  const column = CATEGORY_COLUMN_MAP[category]
  if (!column) {
    console.error(`Unknown category: ${category}`)
    return false
  }

  const result = await updateWorkflowPreferences({
    [column]: providerId,
  } as any)

  return result !== null
}

// Set default channel for a provider
export async function setDefaultChannel(
  providerId: string,
  channelId: string
): Promise<boolean> {
  const store = useWorkflowPreferencesStore.getState()
  const currentChannels = store.preferences?.default_channels || {}

  const result = await updateWorkflowPreferences({
    default_channels: {
      ...currentChannels,
      [providerId]: channelId,
    },
  })

  return result !== null
}

// Set node configuration default
export async function setNodeConfigDefault(
  nodeType: string,
  config: Record<string, any>
): Promise<boolean> {
  const store = useWorkflowPreferencesStore.getState()
  const currentConfigs = store.preferences?.node_config_defaults || {}

  const result = await updateWorkflowPreferences({
    node_config_defaults: {
      ...currentConfigs,
      [nodeType]: config,
    },
  })

  return result !== null
}

// Save multiple preferences at once (used at end of workflow)
export async function saveSelectedPreferences(selections: {
  category?: string
  provider?: string
  channel?: { providerId: string; channelId: string }
  nodeConfig?: { nodeType: string; config: Record<string, any> }
}[]): Promise<boolean> {
  const store = useWorkflowPreferencesStore.getState()
  const updates: Partial<WorkflowPreferences> = {}

  let currentChannels = { ...(store.preferences?.default_channels || {}) }
  let currentConfigs = { ...(store.preferences?.node_config_defaults || {}) }

  for (const selection of selections) {
    // Provider defaults
    if (selection.category && selection.provider) {
      const column = CATEGORY_COLUMN_MAP[selection.category]
      if (column) {
        (updates as any)[column] = selection.provider
      }
    }

    // Channel defaults
    if (selection.channel) {
      currentChannels[selection.channel.providerId] = selection.channel.channelId
    }

    // Node config defaults
    if (selection.nodeConfig) {
      currentConfigs[selection.nodeConfig.nodeType] = selection.nodeConfig.config
    }
  }

  // Only add these if they were modified
  if (Object.keys(currentChannels).length > 0) {
    updates.default_channels = currentChannels
  }
  if (Object.keys(currentConfigs).length > 0) {
    updates.node_config_defaults = currentConfigs
  }

  const result = await updateWorkflowPreferences(updates)
  return result !== null
}
