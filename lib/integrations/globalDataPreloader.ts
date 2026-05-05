import { createClient } from "@/utils/supabaseClient"
import { apiClient } from "@/lib/apiClient"

import { logger } from '@/lib/utils/logger'

interface PreloadConfig {
  provider: string
  dataTypes: string[]
  priority: number
  batchSize?: number
}

interface PreloadResult {
  provider: string
  dataType: string
  success: boolean
  count: number
  error?: string
}

class GlobalDataPreloader {
  private isPreloading = false
  private preloadQueue: PreloadConfig[] = []
  private results: PreloadResult[] = []
  private progressCallback?: (progress: { [key: string]: boolean }) => void

  // Configuration for each provider
  private readonly PRELOAD_CONFIGS: PreloadConfig[] = [
    {
      provider: "notion",
      dataTypes: ["notion_pages", "notion_databases"],
      priority: 1,
      batchSize: 50,
    },
    {
      provider: "slack",
      dataTypes: ["slack_channels", "slack_users"],
      priority: 2,
      batchSize: 100,
    },
    {
      provider: "google-sheets",
      dataTypes: ["google-sheets_spreadsheets"],
      priority: 2,
      batchSize: 50,
    },
    {
      provider: "google-docs",
      dataTypes: ["google-docs_documents", "google-docs_templates"],
      priority: 2,
      batchSize: 50,
    },
    {
      provider: "google-calendar",
      dataTypes: ["google-calendar_calendars"],
      priority: 3,
      batchSize: 20,
    },
    {
      provider: "airtable",
      dataTypes: ["airtable_workspaces", "airtable_bases", "airtable_tables"],
      priority: 2,
      batchSize: 30,
    },
    {
      provider: "trello",
      dataTypes: ["trello_boards"],
      priority: 3,
      batchSize: 50,
    },
    {
      provider: "github",
      dataTypes: ["github_repositories"],
      priority: 2,
      batchSize: 100,
    },
    {
      provider: "gmail",
      dataTypes: ["gmail_labels"],
      priority: 4,
      batchSize: 50,
    },
  ]

  async startPreloading(
    connectedProviders: string[],
    progressCallback?: (progress: { [key: string]: boolean }) => void,
  ): Promise<PreloadResult[]> {
    if (this.isPreloading) {
      logger.info("Preloading already in progress")
      return this.results
    }

    this.isPreloading = true
    this.results = []
    this.progressCallback = progressCallback

    try {
      // Filter and sort configs by connected providers and priority
      this.preloadQueue = this.PRELOAD_CONFIGS.filter((config) => connectedProviders.includes(config.provider)).sort(
        (a, b) => a.priority - b.priority,
      )

      logger.info(`Starting preload for ${this.preloadQueue.length} provider configurations`)

      // Initialize progress
      const initialProgress: { [key: string]: boolean } = {}
      this.preloadQueue.forEach((config) => {
        initialProgress[config.provider] = false
      })
      this.progressCallback?.(initialProgress)

      // Process each provider configuration
      for (const config of this.preloadQueue) {
        await this.preloadProvider(config)
      }

      logger.info("Global preloading completed", this.results)
      return this.results
    } catch (error) {
      logger.error("Global preloading failed:", error)
      throw error
    } finally {
      this.isPreloading = false
    }
  }

  private async preloadProvider(config: PreloadConfig): Promise<void> {
    logger.info(`Preloading ${config.provider} with data types:`, config.dataTypes)

    try {
      // Process each data type for this provider
      const promises = config.dataTypes.map((dataType) =>
        this.preloadDataType(config.provider, dataType, config.batchSize),
      )

      await Promise.allSettled(promises)

      // Update progress
      const currentProgress = { ...this.getCurrentProgress() }
      currentProgress[config.provider] = true
      this.progressCallback?.(currentProgress)

      logger.info(`Completed preloading for ${config.provider}`)
    } catch (error) {
      logger.error(`Failed to preload ${config.provider}:`, error)
    }
  }

  private async preloadDataType(provider: string, dataType: string, batchSize = 50): Promise<void> {
    try {
      logger.info(`Fetching ${dataType} for ${provider}`)

      const response = await apiClient.post("/api/integrations/fetch-user-data", {
          provider,
          dataType,
          batchSize,
          preload: true,
      })

      if (response.success && response.data) {
        this.results.push({
          provider,
          dataType,
          success: true,
          count: response.data.length || 0,
        })

        logger.info(`Successfully preloaded ${response.data.length || 0} ${dataType} for ${provider}`)
      } else {
        throw new Error(response.error || `Failed to fetch ${dataType}`)
      }
    } catch (error: any) {
      logger.error(`Failed to preload ${dataType} for ${provider}:`, error)

      this.results.push({
        provider,
        dataType,
        success: false,
        count: 0,
        error: error.message,
      })
    }
  }

  private getCurrentProgress(): { [key: string]: boolean } {
    const progress: { [key: string]: boolean } = {}
    this.preloadQueue.forEach((config) => {
      const providerResults = this.results.filter((r) => r.provider === config.provider)
      const expectedCount = config.dataTypes.length
      const completedCount = providerResults.length

      progress[config.provider] = completedCount >= expectedCount
    })
    return progress
  }

  async refreshProviderData(provider: string): Promise<PreloadResult[]> {
    const config = this.PRELOAD_CONFIGS.find((c) => c.provider === provider)
    if (!config) {
      throw new Error(`No preload configuration found for provider: ${provider}`)
    }

    logger.info(`Refreshing data for ${provider}`)

    const refreshResults: PreloadResult[] = []

    for (const dataType of config.dataTypes) {
      try {
        await this.preloadDataType(provider, dataType, config.batchSize)
        const result = this.results.find((r) => r.provider === provider && r.dataType === dataType)
        if (result) {
          refreshResults.push(result)
        }
      } catch (error: any) {
        refreshResults.push({
          provider,
          dataType,
          success: false,
          count: 0,
          error: error.message,
        })
      }
    }

    return refreshResults
  }

  getPreloadResults(): PreloadResult[] {
    return this.results
  }

  isCurrentlyPreloading(): boolean {
    return this.isPreloading
  }

  getProviderProgress(provider: string): boolean {
    const config = this.PRELOAD_CONFIGS.find((c) => c.provider === provider)
    if (!config) return false

    const providerResults = this.results.filter((r) => r.provider === provider && r.success)
    return providerResults.length >= config.dataTypes.length
  }

  async validateUserAccess(): Promise<boolean> {
    try {
      // PR-AUTH-7: cached user id from auth store (no lock contention).
      const { useAuthStore } = await import("@/stores/authStore")
      return !!useAuthStore.getState().user
    } catch (error) {
      logger.error("Failed to validate user access:", error)
      return false
    }
  }

  // Method to get estimated preload time
  getEstimatedPreloadTime(connectedProviders: string[]): number {
    const relevantConfigs = this.PRELOAD_CONFIGS.filter((config) => connectedProviders.includes(config.provider))

    // Estimate based on priority and data types (rough calculation)
    let estimatedSeconds = 0
    relevantConfigs.forEach((config) => {
      estimatedSeconds += config.dataTypes.length * 2 // 2 seconds per data type
    })

    return Math.min(estimatedSeconds, 30) // Cap at 30 seconds
  }
}

// Export singleton instance
export const globalDataPreloader = new GlobalDataPreloader()

// Helper functions for integration with the store
export async function initializePreloadingForUser(
  connectedProviders: string[],
  progressCallback?: (progress: { [key: string]: boolean }) => void,
): Promise<PreloadResult[]> {
  const hasAccess = await globalDataPreloader.validateUserAccess()
  if (!hasAccess) {
    throw new Error("User not authenticated")
  }

  return globalDataPreloader.startPreloading(connectedProviders, progressCallback)
}

export async function refreshProviderResources(provider: string): Promise<PreloadResult[]> {
  return globalDataPreloader.refreshProviderData(provider)
}

export function getPreloadingStatus(): {
  isPreloading: boolean
  results: PreloadResult[]
} {
  return {
    isPreloading: globalDataPreloader.isCurrentlyPreloading(),
    results: globalDataPreloader.getPreloadResults(),
  }
}

export function getEstimatedPreloadTime(connectedProviders: string[]): number {
  return globalDataPreloader.getEstimatedPreloadTime(connectedProviders)
}
