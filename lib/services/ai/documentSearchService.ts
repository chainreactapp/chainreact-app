import { google } from "googleapis"
import { Integration } from "./aiIntentAnalysisService"
import { ActionExecutionResult } from "./aiActionExecutionService"
import { getDecryptedAccessToken } from "@/lib/integrations/getDecryptedAccessToken"
import { callLLMWithRetry } from "@/lib/ai/llm-retry"
import { AI_MODELS } from "@/lib/ai/models"
import { runWorkflowAction } from "./utils/runWorkflowAction"

import { logger } from '@/lib/utils/logger'
import { isConnectedStatus } from "@/lib/integrations/connectionStatus"

interface SearchResult {
  title: string
  snippet: string
  provider: string
  sourceId: string
  sourceUrl: string
  mimeType?: string
}

interface DocumentContent {
  title: string
  content: string
  provider: string
  sourceId: string
  sourceUrl: string
}

interface SourceCitation {
  index: number
  title: string
  provider: string
  url: string
  snippet: string
}

export class DocumentSearchService {
  private executeAction = runWorkflowAction

  /**
   * Main entry point: search across integrations, fetch content, synthesize answer
   */
  async answerQuestion(
    question: string,
    integrations: Integration[],
    userId: string
  ): Promise<ActionExecutionResult> {
    try {
      // 1. Search across connected integrations in parallel
      const searchResults = await this.searchAcrossIntegrations(question, integrations, userId)

      if (searchResults.length === 0) {
        return {
          content: `I searched your connected apps but couldn't find any documents related to "${question}". Try connecting more integrations or rephrase your question.`,
          metadata: { type: "document_qa", query: question, sources: [] }
        }
      }

      // 2. Fetch full content from top results (max 3 to manage token costs)
      const documents = await this.fetchContent(searchResults.slice(0, 3), userId)

      if (documents.length === 0) {
        // Had results but couldn't read content — return what we found
        const sources = searchResults.slice(0, 5).map((r, i) => ({
          index: i + 1,
          title: r.title,
          provider: r.provider,
          url: r.sourceUrl,
          snippet: r.snippet
        }))

        return {
          content: `I found some potentially relevant documents but couldn't read their content. Here are the documents I found — you can open them directly:\n\n${sources.map(s => `[${s.index}] **${s.title}** (${s.provider}) — ${s.snippet}`).join("\n\n")}`,
          metadata: { type: "document_qa", query: question, sources }
        }
      }

      // 3. Synthesize answer with source citations
      const { answer, citations } = await this.synthesizeAnswer(question, documents)

      return {
        content: answer,
        metadata: {
          type: "document_qa",
          query: question,
          sources: citations
        }
      }
    } catch (error: any) {
      logger.error("❌ Document search error:", error)
      return {
        content: "I encountered an error while searching your documents. Please try again.",
        metadata: { type: "error", errorType: "document_search_failed" }
      }
    }
  }

  /**
   * Search across all connected integrations in parallel
   */
  private async searchAcrossIntegrations(
    query: string,
    integrations: Integration[],
    userId: string
  ): Promise<SearchResult[]> {
    const connected = integrations.filter(i => isConnectedStatus(i.status))
    const providerSet = new Set(connected.map(i => i.provider))

    const searches: Promise<SearchResult[]>[] = []

    // Google Drive search
    if (providerSet.has("google-drive") || providerSet.has("google")) {
      searches.push(this.searchGoogleDrive(query, userId).catch(() => []))
    }

    // Notion search
    if (providerSet.has("notion")) {
      searches.push(this.searchNotion(query, userId).catch(() => []))
    }

    // Gmail search (for email content)
    if (providerSet.has("gmail") || providerSet.has("google")) {
      searches.push(this.searchGmail(query, userId).catch(() => []))
    }

    const results = await Promise.all(searches)
    return results.flat()
  }

  private async searchGoogleDrive(query: string, userId: string): Promise<SearchResult[]> {
    const accessToken = await getDecryptedAccessToken(userId, "google-drive")
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: accessToken })
    const drive = google.drive({ version: "v3", auth })

    const response = await drive.files.list({
      q: `fullText contains '${query.replace(/'/g, "\\'")}'`,
      pageSize: 5,
      fields: "files(id, name, mimeType, webViewLink, modifiedTime)"
    })

    return (response.data.files || []).map(file => ({
      title: file.name || "Untitled",
      snippet: `${file.mimeType} — Modified ${file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : "unknown"}`,
      provider: "Google Drive",
      sourceId: file.id || "",
      sourceUrl: file.webViewLink || "",
      mimeType: file.mimeType || ""
    }))
  }

  private async searchNotion(query: string, userId: string): Promise<SearchResult[]> {
    const result = await this.executeAction(
      userId,
      "notion_action_search",
      {
        query,
        filter: { property: "object", value: "page" },
        page_size: 5
      }
    )

    if (!result.success || !result.output?.results) return []

    return result.output.results.map((page: any) => {
      const title = page.properties?.title?.title?.[0]?.plain_text
        || page.properties?.Name?.title?.[0]?.plain_text
        || "Untitled"
      const pageId = page.id?.replace(/-/g, "") || page.id || ""

      return {
        title,
        snippet: `Notion page — Last edited ${page.last_edited_time ? new Date(page.last_edited_time).toLocaleDateString() : "unknown"}`,
        provider: "Notion",
        sourceId: page.id || "",
        sourceUrl: `https://notion.so/${pageId}`,
        mimeType: "notion-page"
      }
    })
  }

  private async searchGmail(query: string, userId: string): Promise<SearchResult[]> {
    const result = await this.executeAction(
      userId,
      "gmail_action_search_email",
      {
        query,
        maxResults: 3,
        includeSpamTrash: false
      }
    )

    if (!result.success || !result.output) return []

    const emails = Array.isArray(result.output) ? result.output : result.output?.messages || []

    return emails.slice(0, 3).map((email: any) => ({
      title: email.subject || "No subject",
      snippet: email.snippet || email.body?.substring(0, 150) || "",
      provider: "Gmail",
      sourceId: email.id || "",
      sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${email.id || ""}`,
      mimeType: "email"
    }))
  }

  /**
   * Fetch full content from search results
   */
  private async fetchContent(
    results: SearchResult[],
    userId: string
  ): Promise<DocumentContent[]> {
    const docs: DocumentContent[] = []

    for (const result of results) {
      try {
        if (result.provider === "Google Drive" && result.mimeType === "application/vnd.google-apps.document") {
          const content = await this.readGoogleDoc(result.sourceId, userId)
          if (content) {
            docs.push({
              title: result.title,
              content,
              provider: result.provider,
              sourceId: result.sourceId,
              sourceUrl: result.sourceUrl
            })
          }
        } else if (result.provider === "Notion") {
          const content = await this.readNotionPage(result.sourceId, userId)
          if (content) {
            docs.push({
              title: result.title,
              content,
              provider: result.provider,
              sourceId: result.sourceId,
              sourceUrl: result.sourceUrl
            })
          }
        } else if (result.provider === "Gmail") {
          // Gmail snippet is already content enough for Q&A
          docs.push({
            title: result.title,
            content: result.snippet,
            provider: result.provider,
            sourceId: result.sourceId,
            sourceUrl: result.sourceUrl
          })
        }
      } catch (err) {
        logger.error(`Failed to fetch content for ${result.provider}:${result.sourceId}`, err)
      }
    }

    return docs
  }

  private async readGoogleDoc(fileId: string, userId: string): Promise<string | null> {
    try {
      const accessToken = await getDecryptedAccessToken(userId, "google-drive")
      const { getGoogleDocsContent } = await import(
        "@/app/api/integrations/google/data/handlers/drive"
      )

      const integrationObj = {
        id: "doc-search",
        user_id: userId,
        provider: "google-drive",
        access_token: accessToken,
        status: "connected"
      }

      const result = await getGoogleDocsContent(integrationObj, {
        documentId: fileId,
        previewOnly: false
      })

      return result.content || result.preview || null
    } catch {
      return null
    }
  }

  private async readNotionPage(pageId: string, userId: string): Promise<string | null> {
    try {
      const blocksResult = await this.executeAction(
        userId,
        "notion_action_get_blocks",
        { page_id: pageId, page_size: 100 }
      )

      if (!blocksResult.success) return null

      const blocks = blocksResult.output?.results || blocksResult.output || []
      return blocks.map((block: any) => {
        const type = block.type
        const content = block[type]
        if (!content) return ""
        const richText = content.rich_text || content.text || []
        return richText.map((t: any) => t.plain_text || t.text?.content || "").join("")
      }).filter(Boolean).join("\n")
    } catch {
      return null
    }
  }

  /**
   * Synthesize an answer from document content with source citations
   */
  private async synthesizeAnswer(
    question: string,
    documents: DocumentContent[]
  ): Promise<{ answer: string; citations: SourceCitation[] }> {
    const docsContext = documents.map((doc, i) =>
      `[Source ${i + 1}: "${doc.title}" from ${doc.provider}]\n${doc.content}`
    ).join("\n\n---\n\n")

    const systemPrompt = `You are a helpful assistant that answers questions using the provided documents.
Rules:
- Answer ONLY based on the provided documents. If the documents don't contain the answer, say so.
- Include numbered citations like [1], [2] when referencing information from specific sources.
- Be concise but thorough.
- If multiple sources agree, cite all of them.
- Format your answer with clear structure (headers, bullets) when appropriate.`

    const userPrompt = `Question: ${question}\n\nDocuments:\n${docsContext}\n\nProvide a cited answer:`

    const response = await callLLMWithRetry({
      model: AI_MODELS.fast,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 1500
    })

    const answer = response.choices?.[0]?.message?.content
      || "I was unable to synthesize an answer from the documents found."

    const citations: SourceCitation[] = documents.map((doc, i) => ({
      index: i + 1,
      title: doc.title,
      provider: doc.provider,
      url: doc.sourceUrl,
      snippet: doc.content.substring(0, 200) + (doc.content.length > 200 ? "..." : "")
    }))

    return { answer, citations }
  }
}
