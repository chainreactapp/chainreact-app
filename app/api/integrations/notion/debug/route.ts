import { type NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { cookies } from "next/headers"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function GET(request: NextRequest) {
  try {
    cookies()
    const supabase = await createSupabaseRouteHandlerClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse("Not authenticated" , 401)
    }

    // Get Notion integration for this user
    const { data: integrations, error: integrationsError } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "notion")
      .in("status", CONNECTED_STATUSES_LIST)

    if (integrationsError) {
      return errorResponse(integrationsError.message , 500)
    }

    if (!integrations || integrations.length === 0) {
      return errorResponse("No Notion integration found" , 404)
    }

    const notionIntegration = integrations[0]
    const { decrypt } = await import("@/lib/security/encryption")
    const accessToken = decrypt(notionIntegration.access_token, process.env.ENCRYPTION_KEY!)

    // Fetch all top-level pages
    const pagesResponse = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { value: "page", property: "object" },
        page_size: 100,
        sort: { direction: "descending", timestamp: "last_edited_time" }
      }),
    })

    if (!pagesResponse.ok) {
      return jsonResponse({ error: `Notion API error: ${pagesResponse.status}`, details: await pagesResponse.text() }, { status: pagesResponse.status })
    }

    const pagesData = await pagesResponse.json()
    const mainPages = []

    for (const page of pagesData.results || []) {
      // Get page title
      let pageTitle = "Untitled Page"
      if (page.title && page.title.length > 0) {
        pageTitle = page.title[0].plain_text
      } else if (page.properties) {
        for (const [key, prop] of Object.entries(page.properties)) {
          const typedProp = prop as any
          if (typedProp.title && typedProp.title.length > 0) {
            pageTitle = typedProp.title[0].plain_text
            break
          } else if (typedProp.rich_text && typedProp.rich_text.length > 0) {
            pageTitle = typedProp.rich_text[0].plain_text
            break
          }
        }
      }

      // Fetch subpages (children)
      const childrenResponse = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2022-06-28",
        },
      })
      let subpages = []
      if (childrenResponse.ok) {
        const childrenData = await childrenResponse.json()
        subpages = (childrenData.results || [])
          .filter((block: any) => block.type === 'child_page')
          .map((block: any) => ({
            id: block.id,
            title: block.child_page?.title || "Untitled Subpage",
            url: `https://notion.so/${block.id.replace(/-/g, '')}`
          }))
      }

      mainPages.push({
        id: page.id,
        title: pageTitle,
        url: page.url,
        subpages
      })
    }

    return jsonResponse({
      pages: mainPages
    })
  } catch (error: any) {
    logger.error("Notion debug endpoint error:", error)
    return errorResponse(error.message , 500)
  }
}
