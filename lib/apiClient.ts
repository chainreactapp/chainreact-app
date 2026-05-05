import { getApiBaseUrl } from "./utils/getBaseUrl"
import { getAuthHeader } from "@/lib/auth/getAuthHeader"

import { logger } from '@/lib/utils/logger'

interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

class ApiClient {
  constructor() {
    // No longer store baseUrl at initialization
  }

  private getBaseUrl(): string {
    // For client-side requests in development, always use window.location
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return `${window.location.protocol}//${window.location.host}`
      }
    }
    return getApiBaseUrl()
  }

  // PR-AUTH-4: read the Authorization header from the cached-token helper.
  // Hot path is synchronous (no supabase.auth.getSession() / navigator-lock
  // contention). Refreshes only when the cached token is stale, with
  // intra-tab single-flight so concurrent API calls share one round-trip.
  // Never throws — failures resolve to {} so the request gets a normal 401.
  private async getAuthHeaders(): Promise<Record<string, string>> {
    return getAuthHeader()
  }

  private async request<T = any>(
    endpoint: string,
    options: RequestInit = {},
    // PR-AUTH-FOLLOWUP-2: internal recursion guard. When `true`, the call
    // is already a retry after a 401; do NOT recurse again.
    _isAuthRetry: boolean = false,
  ): Promise<ApiResponse<T>> {
    try {
      // Get base URL dynamically for each request
      const baseUrl = this.getBaseUrl()
      // Ensure we're using the same domain to avoid CORS issues
      const url = `${baseUrl}${endpoint}`

      const defaultHeaders = {
        "Content-Type": "application/json",
      }

      // On a 401-retry pass we force-refresh the cached token. The cached
      // token may have been valid by expiry but revoked / rotated on the
      // server side — only a fresh refresh can rescue the request.
      const authHeaders = _isAuthRetry
        ? await getAuthHeader({ mode: "force-refresh" })
        : await this.getAuthHeaders()

      const config: RequestInit = {
        ...options,
        headers: {
          ...defaultHeaders,
          ...authHeaders,
          ...options.headers,
        },
        credentials: "include", // Include cookies for authentication
      }

      // Per-request logs at debug level — info-level was producing 5+ lines
      // of noise per request and made real signal hard to find.
      logger.debug(`[apiClient] ${config.method || "GET"} ${url}`, {
        hasAuthHeader: !!authHeaders.Authorization,
      })

      let response: Response;
      try {
        response = await fetch(url, config)
      } catch (fetchError: any) {
        logger.error(`❌ Fetch failed for ${endpoint}:`, fetchError)
        logger.error(`❌ URL was: ${url}`)
        logger.error(`❌ Base URL: ${baseUrl}`)
        throw new Error(`Network error: ${fetchError.message || 'Failed to fetch'}`)
      }

      // PR-AUTH-FOLLOWUP-2: auto-recover from 401 by force-refreshing the
      // cached auth token and retrying once. Handles the case where the
      // cached token is valid by expiry but revoked / rotated server-side
      // (sign-out elsewhere, key rotation, password change). On success
      // the user never sees the 401. On second 401 (auth genuinely dead)
      // the request returns a normal failed response.
      if (response.status === 401 && !_isAuthRetry) {
        logger.warn(`[apiClient] 401 for ${endpoint} — forcing refresh and retrying once`)
        return this.request<T>(endpoint, options, true)
      }

      // Auto-recover from 431 (Request Header Fields Too Large) by clearing stale cookies
      if (response.status === 431) {
        logger.warn(`[ApiClient] 431 header too large for ${endpoint}, clearing stale auth data and retrying`)
        try {
          // Clear stale auth cookies that may have accumulated
          document.cookie.split(';').forEach(cookie => {
            const name = cookie.split('=')[0].trim()
            if (name.startsWith('sb-') || name.includes('supabase')) {
              document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
            }
          })
          localStorage.removeItem('chainreact-auth')

          // Retry the request once after clearing
          const retryResponse = await fetch(url, config)
          if (retryResponse.ok) {
            const data = await retryResponse.json().catch(() => ({}))
            return { success: true, data }
          }
        } catch (e) {
          // Fall through to normal error handling
        }
      }

      if (!response.ok) {
        // Try to get error details from response body
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        let errorDetails: any = undefined

        logger.error(`❌ API Error Response: ${endpoint}`, {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          url: url
        })

        try {
          const responseText = await response.text()
          logger.error(`❌ API Error Response Body length: ${endpoint}`, responseText.length)
          
          if (responseText.trim()) {
            const errorData = JSON.parse(responseText)
            if (errorData.error) {
              errorMessage = errorData.error
            } else if (errorData.message) {
              errorMessage = errorData.message
            }
            errorDetails = errorData
          } else {
            // If response body is empty, create a more descriptive error message
            if (response.status === 403) {
              errorMessage = "Access denied. Please check your permissions and try again."
            } else if (response.status === 401) {
              errorMessage = "Authentication failed. Please reconnect your account."
            } else {
              errorMessage = `HTTP ${response.status}: ${response.statusText}`
            }
          }
        } catch (e) {
          // If response is not JSON, create a descriptive error message
          logger.warn("Failed to parse error response as JSON:", e)
          if (response.status === 403) {
            errorMessage = "Access denied. Please check your permissions and try again."
          } else if (response.status === 401) {
            errorMessage = "Authentication failed. Please reconnect your account."
          } else {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`
          }
        }

        logger.error(`❌ API Error: ${endpoint}`, { status: response.status, message: errorMessage })

        return {
          success: false,
          error: errorMessage,
          data: undefined,
          ...(errorDetails && { details: errorDetails })
        }
      }

      let data: any
      try {
        data = await response.json()
      } catch (e) {
        logger.warn("Failed to parse response as JSON, returning empty data")
        data = {}
      }

      // Log successful API responses without sensitive data
      if (endpoint.includes('gmail') || endpoint.includes('recipients') || endpoint.includes('contacts')) {
        logger.info(`✅ API Response: ${endpoint} - ${Array.isArray(data.data) ? data.data.length : 'Unknown'} items`)
      } else {
        logger.info(`✅ API Response: ${endpoint}`)
      }

      return {
        success: true,
        data: data.data || data,
        message: data.message,
      }
    } catch (error: any) {
      const baseUrl = this.getBaseUrl()
      logger.error(`❌ API Network Error: ${endpoint}`, error)
      logger.error(`❌ Error details:`, {
        message: error.message,
        endpoint,
        baseUrl: baseUrl,
        url: `${baseUrl}${endpoint}`,
        stack: error.stack
      })

      // Return a structured error response for network errors
      return {
        success: false,
        error: error.message || "Network error occurred",
        data: undefined,
      }
    }
  }

  async get<T = any>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: "GET" })
  }

  async post<T = any>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T = any>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async delete<T = any>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: "DELETE" })
  }

  async patch<T = any>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    })
  }
}

// Export singleton instance
export const apiClient = new ApiClient()
export default apiClient
