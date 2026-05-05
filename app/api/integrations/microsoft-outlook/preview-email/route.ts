import { NextRequest } from "next/server"
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { decryptToken } from "@/lib/integrations/tokenUtils"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

function sanitizeSearchQuery(query?: string): string | null {
  if (!query || typeof query !== "string") {
    return null
  }
  const trimmed = query.trim()
  if (!trimmed) {
    return null
  }
  return trimmed.replace(/"/g, '\\"')
}

async function requestMessages(
  baseUrl: string,
  params: URLSearchParams,
  accessToken: string,
  includeSearchHeaders: boolean
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  }

  if (includeSearchHeaders) {
    headers["ConsistencyLevel"] = "eventual"
  }

  const url = `${baseUrl}?${params.toString()}`
  const response = await fetch(url, { headers })
  return { response, url }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { folderId, query, startDate, endDate, includeDeleted } = body || {}

    const supabase = await createSupabaseRouteHandlerClient()
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse("Unauthorized" , 401)
    }

    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("provider", "microsoft-outlook")
      .eq("user_id", user.id)
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      return errorResponse("No connected Microsoft Outlook integration found" , 404)
    }

    if (!integration.access_token) {
      return errorResponse("No access token available for Microsoft Outlook integration" , 401)
    }

    const accessToken = await decryptToken(integration.access_token)

    if (!accessToken) {
      return errorResponse("Failed to decrypt Microsoft Outlook access token" , 401)
    }

    // Build the base URL for the messages endpoint
    // folderId can be either a well-known name (inbox, sentitems) or an actual folder ID (AAMkAGI2...)
    let baseUrl = "https://graph.microsoft.com/v1.0/me/"

    if (folderId && typeof folderId === "string" && folderId.trim()) {
      // Use the folder ID directly - don't lowercase as folder IDs are case-sensitive
      baseUrl += `mailFolders/${folderId}/messages`
    } else {
      // Default to all messages (inbox)
      baseUrl += "messages"
    }

    const sanitizedQuery = sanitizeSearchQuery(query)
    const maxPreviewResults = 1 // Always fetch just 1 email for preview

    const baseParams = new URLSearchParams()
    baseParams.append("$top", maxPreviewResults.toString())
    baseParams.append("$select", "id,subject,from,receivedDateTime,bodyPreview,hasAttachments")
    baseParams.append("$orderby", "receivedDateTime desc")

    const filters: string[] = []

    if (startDate) {
      const start = new Date(startDate)
      if (!isNaN(start.valueOf())) {
        filters.push(`receivedDateTime ge ${start.toISOString()}`)
      }
    }

    if (endDate) {
      const end = new Date(endDate)
      if (!isNaN(end.valueOf())) {
        const inclusiveEnd = new Date(end)
        inclusiveEnd.setDate(inclusiveEnd.getDate() + 1)
        filters.push(`receivedDateTime lt ${inclusiveEnd.toISOString()}`)
      }
    }

    // Note: Microsoft Graph API doesn't support filtering by deletedDateTime on messages
    // Deleted items are automatically excluded unless specifically querying the deleteditems folder

    if (filters.length > 0) {
      baseParams.append("$filter", filters.join(" and "))
    }

    const searchParams = new URLSearchParams(baseParams.toString())

    let usedSearch = false
    if (sanitizedQuery) {
      searchParams.append("$search", `\"${sanitizedQuery}\"`)
      usedSearch = true
    }

    let graphResponse: Response
    let lastUrl = ""
    let fallbackReason: string | null = null

    if (usedSearch) {
      const searchResult = await requestMessages(baseUrl, searchParams, accessToken, true)
      graphResponse = searchResult.response
      lastUrl = searchResult.url

      if (!graphResponse.ok && (graphResponse.status === 400 || graphResponse.status === 403)) {
        fallbackReason = await graphResponse.text()
        const fallbackResult = await requestMessages(baseUrl, baseParams, accessToken, false)
        graphResponse = fallbackResult.response
        lastUrl = fallbackResult.url
        usedSearch = false
      }
    } else {
      const result = await requestMessages(baseUrl, baseParams, accessToken, false)
      graphResponse = result.response
      lastUrl = result.url
    }

    if (!graphResponse.ok) {
      const errorText = await graphResponse.text()
      logger.error("[Outlook Preview] API Error:", { status: graphResponse.status, errorText, url: lastUrl })

      if (graphResponse.status === 401) {
        return errorResponse("Microsoft Outlook authentication failed. Please reconnect your account." , 401)
      }

      return jsonResponse(
        { error: "Failed to fetch email preview" },
        { status: graphResponse.status }
      )
    }

    const data = await graphResponse.json()
    const messages = Array.isArray(data?.value) ? data.value : []

    if (!messages.length) {
      return jsonResponse({
        error: usedSearch ? "No emails found matching criteria" : "No emails found",
        searchApplied: usedSearch,
        query: sanitizedQuery,
        fallbackReason
      })
    }

    const formattedEmails = messages.map((email: any) => ({
      id: email.id,
      subject: email.subject,
      from: email.from?.emailAddress?.address || "Unknown",
      receivedDateTime: email.receivedDateTime,
      bodyPreview: email.bodyPreview,
      hasAttachments: email.hasAttachments
    }))

    return jsonResponse({
      email: formattedEmails[0],
      emails: formattedEmails,
      searchApplied: usedSearch,
      query: sanitizedQuery,
      fallbackReason
    })
  } catch (error: any) {
    logger.error("[Outlook Preview] Error:", error)
    return errorResponse(error.message || "Failed to fetch email preview" , 500)
  }
}
