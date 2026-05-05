/**
 * Business Context Store
 *
 * Domain state only — no transport logic.
 * Standalone exported functions handle API calls (matching workflowPreferencesStore pattern).
 */

import { create } from 'zustand'
import { supabase } from '@/utils/supabaseClient'

export interface BusinessContextEntry {
  id: string
  user_id: string
  organization_id: string | null
  key: string
  value: string
  category: 'company_info' | 'preferences' | 'rules' | 'mappings' | 'style' | 'defaults'
  scope: 'user' | 'organization'
  locked: boolean
  source: 'manual' | 'learned'
  usage_count: number
  relevance_tags: string[]
  last_used_at: string | null
  created_at: string
  updated_at: string
}

interface BusinessContextStore {
  entries: BusinessContextEntry[]
  loading: boolean
  error: string | null
  setEntries: (entries: BusinessContextEntry[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  getByCategory: (category: string) => BusinessContextEntry[]
}

export const useBusinessContextStore = create<BusinessContextStore>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  setEntries: (entries) => set({ entries }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  getByCategory: (category: string) => {
    return get().entries.filter(e => e.category === category)
  },
}))

// --- Standalone exported functions (service layer) ---

export async function loadBusinessContext(): Promise<BusinessContextEntry[]> {
  const store = useBusinessContextStore.getState()
  try {
    store.setLoading(true)
    store.setError(null)

    // PR-AUTH-5: cached user id; no getUser() lock contention.
    const { useAuthStore } = await import('./authStore')
    const user = useAuthStore.getState().user
    if (!user) throw new Error('No authenticated user')

    // Cast: business_context table not yet in generated Supabase types
    const { data, error } = await (supabase as any)
      .from('business_context')
      .select('*')
      .eq('user_id', user.id)
      .order('usage_count', { ascending: false })

    if (error) throw error

    const entries = (data ?? []) as BusinessContextEntry[]
    store.setEntries(entries)
    return entries
  } catch (error: any) {
    store.setError(error.message || 'Failed to load business context')
    return []
  } finally {
    store.setLoading(false)
  }
}

export async function addBusinessContextEntry(entry: {
  key: string
  value: string
  category: BusinessContextEntry['category']
  locked?: boolean
  relevance_tags?: string[]
}): Promise<BusinessContextEntry | null> {
  const store = useBusinessContextStore.getState()
  try {
    store.setError(null)

    // PR-AUTH-5: cached user id; no getUser() lock contention.
    const { useAuthStore } = await import('./authStore')
    const user = useAuthStore.getState().user
    if (!user) throw new Error('No authenticated user')

    const { data, error } = await (supabase as any)
      .from('business_context')
      .insert({
        user_id: user.id,
        key: entry.key,
        value: entry.value,
        category: entry.category,
        scope: 'user',
        source: 'manual',
        locked: entry.locked ?? false,
        relevance_tags: entry.relevance_tags ?? [],
      })
      .select()
      .single()

    if (error) throw error

    const newEntry = data as BusinessContextEntry
    store.setEntries([newEntry, ...store.entries])
    return newEntry
  } catch (error: any) {
    store.setError(error.message || 'Failed to add entry')
    return null
  }
}

export async function updateBusinessContextEntry(
  id: string,
  updates: Partial<Pick<BusinessContextEntry, 'value' | 'category' | 'locked' | 'relevance_tags'>>
): Promise<boolean> {
  const store = useBusinessContextStore.getState()
  try {
    store.setError(null)

    const { data, error } = await (supabase as any)
      .from('business_context')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    const updated = data as BusinessContextEntry
    store.setEntries(store.entries.map(e => e.id === id ? updated : e))
    return true
  } catch (error: any) {
    store.setError(error.message || 'Failed to update entry')
    return false
  }
}

export async function deleteBusinessContextEntry(id: string): Promise<boolean> {
  const store = useBusinessContextStore.getState()
  try {
    store.setError(null)

    const { error } = await (supabase as any)
      .from('business_context')
      .delete()
      .eq('id', id)

    if (error) throw error

    store.setEntries(store.entries.filter(e => e.id !== id))
    return true
  } catch (error: any) {
    store.setError(error.message || 'Failed to delete entry')
    return false
  }
}
