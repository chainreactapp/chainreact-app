import { create } from 'zustand'
import { supabase } from "@/utils/supabaseClient"

// Define the user profile type
export interface UserProfile {
  id: string
  full_name?: string
  first_name?: string
  last_name?: string
  avatar_url?: string
  company?: string
  job_title?: string
  role?: string
  updated_at?: string
}

interface UserProfileStore {
  data: UserProfile | null
  loading: boolean
  error: string | null
  setData: (data: UserProfile | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

// Create store for user profiles
export const useUserProfileStore = create<UserProfileStore>((set) => ({
  data: null,
  loading: false,
  error: null,
  setData: (data) => set({ data }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}))

// Load user profile from Supabase
export async function loadUserProfile(userId?: string): Promise<UserProfile | null> {
  try {
    const store = useUserProfileStore.getState()
    store.setLoading(true)
    store.setError(null)

    // PR-AUTH-5: cached user id from auth store.
    if (!userId) {
      const { useAuthStore } = await import('./authStore')
      const user = useAuthStore.getState().user
      if (!user) {
        throw new Error("No authenticated user")
      }
      userId = user.id
    }

    // Fetch user profile from profiles table
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single()

    if (error) {
      throw error
    }

    store.setData(data)
    return data
  } catch (error: any) {
    const store = useUserProfileStore.getState()
    store.setError(error.message || "Failed to load user profile")
    return null
  } finally {
    const store = useUserProfileStore.getState()
    store.setLoading(false)
  }
}

// Update user profile
export async function updateUserProfile(updates: Partial<UserProfile>): Promise<UserProfile | null> {
  try {
    const store = useUserProfileStore.getState()
    store.setLoading(true)
    store.setError(null)

    // PR-AUTH-5: cached user id.
    const { useAuthStore } = await import('./authStore')
    const user = useAuthStore.getState().user
    if (!user) {
      throw new Error("No authenticated user")
    }

    // Update profile
    const { data, error } = await supabase
      .from("user_profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .single()

    if (error) {
      throw error
    }

    store.setData(data)
    return data
  } catch (error: any) {
    const store = useUserProfileStore.getState()
    store.setError(error.message || "Failed to update user profile")
    return null
  } finally {
    const store = useUserProfileStore.getState()
    store.setLoading(false)
  }
}
