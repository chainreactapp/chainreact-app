import { ActionResult } from './core/executeWait'
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken'
import { resolveValue } from './core/resolveValue'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Create a new Notion database
 */
export async function createNotionDatabase(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      workspace,
      title,
      template,
      parentPageId,
      properties = {}
    } = resolvedConfig

    if (!title) {
      throw new Error("Database title is required")
    }

    // Get Notion integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "notion")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error("Notion integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "notion")

    // Prepare database properties based on template
    let databaseProperties = {}
    
    if (template) {
      // Define template properties
      const templates: Record<string, any> = {
        "Project Tracker": {
          "Name": { title: {} },
          "Status": { 
            select: { 
              options: [
                { name: "Not Started", color: "gray" },
                { name: "In Progress", color: "yellow" },
                { name: "Completed", color: "green" }
              ]
            }
          },
          "Priority": { 
            select: { 
              options: [
                { name: "Low", color: "blue" },
                { name: "Medium", color: "yellow" },
                { name: "High", color: "red" }
              ]
            }
          },
          "Due Date": { date: {} },
          "Assignee": { people: {} }
        },
        "CRM": {
          "Name": { title: {} },
          "Email": { email: {} },
          "Phone": { phone_number: {} },
          "Status": { 
            select: { 
              options: [
                { name: "Lead", color: "blue" },
                { name: "Prospect", color: "yellow" },
                { name: "Customer", color: "green" },
                { name: "Lost", color: "red" }
              ]
            }
          },
          "Company": { rich_text: {} },
          "Last Contact": { date: {} }
        },
        "Content Calendar": {
          "Title": { title: {} },
          "Status": { 
            select: { 
              options: [
                { name: "Draft", color: "gray" },
                { name: "In Review", color: "yellow" },
                { name: "Published", color: "green" }
              ]
            }
          },
          "Publish Date": { date: {} },
          "Author": { people: {} },
          "Type": { 
            select: { 
              options: [
                { name: "Blog Post", color: "blue" },
                { name: "Social Media", color: "green" },
                { name: "Video", color: "purple" }
              ]
            }
          }
        }
      }
      
      databaseProperties = templates[template] || {}
    } else {
      // Use custom properties if provided
      databaseProperties = properties
    }

    // Create database payload
    const payload: any = {
      parent: parentPageId ? { page_id: parentPageId } : { type: "workspace_id", workspace_id: workspace },
      title: [{ type: "text", text: { content: title } }],
      properties: databaseProperties
    }

    // Create database
    const response = await fetch("https://api.notion.com/v1/databases", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Notion API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        databaseId: result.id,
        title: result.title[0]?.text?.content,
        url: result.url,
        properties: result.properties,
        template: template,
        notionResponse: result
      },
      message: `Notion database "${result.title[0]?.text?.content}" created successfully`
    }

  } catch (error: any) {
    logger.error("Notion create database error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create Notion database"
    }
  }
}

/**
 * Create a new Notion page
 */
export async function createNotionPage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      workspace,
      database,
      title,
      parentPageId,
      content,
      properties = {}
    } = resolvedConfig

    if (!title) {
      throw new Error("Title is required")
    }

    // Get Notion integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "notion")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error("Notion integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "notion")

    // Prepare page content
    const children = content ? [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: content }
            }
          ]
        }
      }
    ] : []

    // Create page payload
    const payload: any = {
      properties: {
        title: {
          title: [
            {
              type: "text",
              text: { content: title }
            }
          ]
        },
        ...properties
      },
      children: children
    }

    // Set parent based on the provided parameters
    if (parentPageId) {
      // If parent page is selected, create page inside that page
      payload.parent = { page_id: parentPageId }
    } else if (database) {
      // If database is selected but no parent page, create page inside the database
      payload.parent = { database_id: database }
    } else {
      // If neither parent page nor database is selected, create page at workspace root
      // Note: Notion API doesn't support workspace_id directly, so we need to use a different approach
      throw new Error("Either a database or parent page must be selected to create a page")
    }

    // Create page
    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Notion API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        pageId: result.id,
        title: result.properties?.title?.title[0]?.text?.content,
        url: result.url,
        properties: result.properties,
        notionResponse: result
      },
      message: `Notion page "${result.properties?.title?.title[0]?.text?.content}" created successfully`
    }

  } catch (error: any) {
    logger.error("Notion create page error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create Notion page"
    }
  }
}

/**
 * Update an existing Notion page
 */
export async function updateNotionPage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      pageId,
      title,
      content,
      properties = {}
    } = resolvedConfig

    if (!pageId) {
      throw new Error("Page ID is required")
    }

    // Get Notion integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "notion")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      throw new Error("Notion integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "notion")

    // Prepare update payload
    const payload: any = {
      properties: {}
    }

    if (title) {
      payload.properties.title = {
        title: [
          {
            type: "text",
            text: { content: title }
          }
        ]
      }
    }

    // Add custom properties
    Object.assign(payload.properties, properties)

    // Update page
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Notion API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        pageId: result.id,
        title: result.properties?.title?.title[0]?.text?.content,
        url: result.url,
        properties: result.properties,
        notionResponse: result
      },
      message: `Notion page "${result.properties?.title?.title[0]?.text?.content}" updated successfully`
    }

  } catch (error: any) {
    logger.error("Notion update page error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to update Notion page"
    }
  }
} 

/**
 * Search for pages or databases in Notion
 */
export async function searchNotionPages(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const accessToken = await getDecryptedAccessToken(userId, "notion")
    const query = resolveValue(config.query, input) || ""
    const filter = config.filter || "page"
    const maxResults = Number(config.maxResults) || 10

    if (!accessToken) {
      return { success: false, message: "Notion access token not found" }
    }

    // Build Notion search payload
    const payload: any = {
      query,
      page_size: Math.max(1, Math.min(maxResults, 100)),
    }
    if (filter === "page" || filter === "database") {
      payload.filter = { property: "object", value: filter }
    }

    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Notion API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()
    const results = result.results || []

    // Map results to a simple structure for preview/UI
    const pages = results.map((item: any) => {
      let title = ""
      if (item.object === "page") {
        // Try to extract title from properties
        const prop = item.properties || {}
        const titleProp = Object.values(prop).find((p: any) => p.type === "title") as any
        if (titleProp && Array.isArray(titleProp.title) && titleProp.title.length > 0) {
          title = titleProp.title[0].plain_text || ""
        }
      } else if (item.object === "database") {
        // Try to extract title from title property
        if (Array.isArray(item.title) && item.title.length > 0) {
          title = item.title[0].plain_text || ""
        }
      }
      return {
        id: item.id,
        object: item.object,
        title,
        url: item.url,
        last_edited_time: item.last_edited_time,
        created_time: item.created_time,
        icon: item.icon,
        cover: item.cover,
        raw: item
      }
    })

    return {
      success: true,
      output: {
        pages,
        count: pages.length,
        query,
        filter,
        maxResults,
        raw: result
      },
      message: `Found ${pages.length} Notion ${filter === "database" ? "databases" : "pages"} matching the search criteria`
    }
  } catch (error: any) {
    logger.error("Notion search pages error:", error)
    return {
      success: false,
      message: error.message || "Failed to search Notion pages",
      error: error.message
    }
  }
} 