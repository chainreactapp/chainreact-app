import { summarizeContent, extractInformation, analyzeSentiment, translateText, generateContent, classifyContent } from "@/lib/workflows/actions/aiDataProcessing"
import { applyTemplateDefaultsToConfig } from "@/lib/workflows/nodes/providers/ai/actions/templates"
import { ExecutionContext } from "./workflowExecutionService"
import { fallbackToRegistry } from "./executionHandlers/registryFallback"
import { logger } from '@/lib/utils/logger'

export class AIActionsService {
  async executeAIAction(node: any, context: ExecutionContext): Promise<any> {
    const nodeType = node.data.type
    const resolvedConfig = context.dataFlowManager.resolveObject(node.data?.config || {})
    const configWithTemplates = applyTemplateDefaultsToConfig(nodeType, { ...resolvedConfig })
    const preparedConfig = this.prepareConfig(nodeType, configWithTemplates, context)

    logger.info(`🤖 Executing AI action: ${nodeType}`)

    if (context.testMode) {
      return this.buildTestResponse(nodeType, preparedConfig, context)
    }

    const runtimeInput = this.buildRuntimeInput(context)

    switch (nodeType) {
      case "ai_action_summarize":
        return await this.executeWithHandler(nodeType, () => summarizeContent(preparedConfig, context.userId, runtimeInput))
      case "ai_action_extract":
        return await this.executeWithHandler(nodeType, () => extractInformation(preparedConfig, context.userId, runtimeInput))
      case "ai_action_sentiment":
        return await this.executeWithHandler(nodeType, () => analyzeSentiment(preparedConfig, context.userId, runtimeInput))
      case "ai_action_translate":
        return await this.executeWithHandler(nodeType, () => translateText(preparedConfig, context.userId, runtimeInput))
      case "ai_action_generate":
        return await this.executeWithHandler(nodeType, () => generateContent(preparedConfig, context.userId, runtimeInput))
      case "ai_action_classify":
        return await this.executeWithHandler(nodeType, () => classifyContent(preparedConfig, context.userId, runtimeInput))
      default:
        // PR-V2C — fall through to registry. v1 AI naming (ai_summarize,
        // ai_prompt, ai_translate without the `ai_action_` prefix) lands
        // here. Test-mode safety inside helper.
        return await fallbackToRegistry(node, context, {
          source: 'AIActionsService',
        })
    }
  }

  async executeAIAgent(node: any, context: ExecutionContext): Promise<any> {
    logger.info("🤖 Executing AI Agent")

    // Resolve variable references in config before executing
    const aiResolvedConfig = context.dataFlowManager.resolveObject(node.data?.config || {})

    logger.info("🤖 AI Agent executing with resolved config keys:", Object.keys(aiResolvedConfig || {}))

    // Call AI agent directly
    const { executeAIAgent } = await import('@/lib/workflows/aiAgent')
    return await executeAIAgent({
      userId: context.userId,
      config: aiResolvedConfig,
      input: this.buildRuntimeInput(context)
    })
  }

  async executeAIRouter(node: any, context: ExecutionContext): Promise<any> {
    logger.info("🤖 Executing AI Agent (Router Mode)")

    // Resolve variable references in config before executing
    const resolvedConfig = context.dataFlowManager.resolveObject(node.data?.config || {})

    logger.info("🤖 AI Agent executing with resolved config")

    // Call unified AI agent action
    const { executeAIAgentAction } = await import('@/lib/workflows/actions/aiAgentAction')
    return await executeAIAgentAction(resolvedConfig, this.buildRuntimeInput(context), context)
  }

  private async executeWithHandler(actionType: string, handler: () => Promise<any>) {
    try {
      const result = await handler()
      return this.formatActionResult(actionType, result)
    } catch (error: any) {
      logger.error(`❌ AI action ${actionType} failed:`, error)
      return {
        type: actionType,
        success: false,
        error: error?.message || "AI action failed",
        message: error?.message || "AI action failed"
      }
    }
  }

  private prepareConfig(nodeType: string, config: any, context: ExecutionContext) {
    switch (nodeType) {
      case "ai_action_summarize":
        return this.prepareSummarizeConfig(config, context)
      case "ai_action_extract":
        return this.prepareExtractConfig(config, context)
      case "ai_action_sentiment":
        return this.prepareSentimentConfig(config, context)
      case "ai_action_translate":
        return this.prepareTranslateConfig(config, context)
      case "ai_action_generate":
        return this.prepareGenerateConfig(config, context)
      case "ai_action_classify":
        return this.prepareClassifyConfig(config, context)
      default:
        return config
    }
  }

  private normalizeInputText(config: any, fallback: string = ""): string {
    if (typeof config?.inputText === "string") return config.inputText
    if (typeof config?.text === "string") return config.text
    return fallback
  }

  private normalizeNumber(value: any, defaultValue: number): number {
    if (value === undefined || value === null) return defaultValue
    const parsed = Number(value)
    return Number.isNaN(parsed) ? defaultValue : parsed
  }

  private normalizeArray(value: any): string[] {
    if (Array.isArray(value)) return value
    if (typeof value === "string") {
      return value
        .split(/\r?\n|,/)
        .map(entry => entry.trim())
        .filter(Boolean)
    }
    return []
  }

  private normalizeInputData(value: any): Record<string, any> {
    if (!value) return {}
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === "object" ? parsed : {}
      } catch {
        return {}
      }
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      return value
    }
    return {}
  }

  private prepareSummarizeConfig(config: any, context: ExecutionContext) {
    const text = this.normalizeInputText(config, context.data?.text || "")
    return {
      ...config,
      inputText: text,
      maxLength: this.normalizeNumber(config.maxLength, 300),
      style: config.style || "",
      focus: config.focus || ""
    }
  }

  private prepareExtractConfig(config: any, context: ExecutionContext) {
    const text = this.normalizeInputText(config, context.data?.text || "")
    return {
      ...config,
      inputText: text,
      extractionType: config.extractionType || "entities",
      instructions: config.instructions || "",
      returnFormat: config.returnFormat || "auto"
    }
  }

  private prepareSentimentConfig(config: any, context: ExecutionContext) {
    const text = this.normalizeInputText(config, context.data?.text || "")
    const labels = this.normalizeArray(config.labels)
    return {
      ...config,
      inputText: text,
      analysisType: config.analysisType || "basic",
      labels,
      confidence: config.confidence !== false
    }
  }

  private prepareTranslateConfig(config: any, context: ExecutionContext) {
    const text = this.normalizeInputText(config, context.data?.text || "")
    return {
      ...config,
      inputText: text,
      targetLanguage: config.targetLanguage || "en",
      sourceLanguage: config.sourceLanguage || "auto",
      preserveFormatting: config.preserveFormatting !== false
    }
  }

  private prepareGenerateConfig(config: any, context: ExecutionContext) {
    return {
      ...config,
      prompt: config.prompt || "",
      contentType: config.contentType || "response",
      tone: config.tone || "neutral",
      length: config.length || "medium",
      temperature: this.normalizeNumber(config.temperature, 0.7),
      maxTokens: this.normalizeNumber(config.maxTokens, 300),
      inputData: this.normalizeInputData(config.inputData)
    }
  }

  private prepareClassifyConfig(config: any, context: ExecutionContext) {
    const text = this.normalizeInputText(config, context.data?.text || "")
    const categories = this.normalizeArray(config.categories)
    const normalizedCategories = categories.length > 0 ? categories : ["positive", "negative", "neutral"]
    return {
      ...config,
      inputText: text,
      categories: normalizedCategories,
      confidence: config.confidence !== false
    }
  }

  private buildRuntimeInput(context: ExecutionContext) {
    return {
      ...context.data,
      variables: context.variables,
      nodeOutputs: context.results,
      previousResults: context.results,
      workflowId: context.workflowId,
      executionId: context.executionId
    }
  }

  private formatActionResult(actionType: string, result: any) {
    if (!result) {
      return {
        type: actionType,
        success: false,
        error: "No result returned from AI action"
      }
    }

    const formatted: Record<string, any> = {
      type: actionType,
      success: result.success ?? true,
      message: result.message
    }

    if (result.output && typeof result.output === "object") {
      Object.assign(formatted, result.output)
    }

    if (!formatted.success) {
      formatted.error = result.error || result.message
    }

    if (result.metadata) {
      formatted.metadata = result.metadata
    }

    return formatted
  }

  private buildTestResponse(actionType: string, config: any, context: ExecutionContext) {
    switch (actionType) {
      case "ai_action_summarize": {
        const text = config.inputText || ""
        const maxLength = this.normalizeNumber(config.maxLength, 300)
        return {
          type: actionType,
          success: true,
          summary: `Test summary of: ${text.substring(0, Math.min(maxLength, 50))}...`,
          originalLength: text.length,
          summaryLength: Math.min(maxLength, 50),
          style: config.style,
          focus: config.focus
        }
      }
      case "ai_action_extract":
        return {
          type: actionType,
          success: true,
          extractionType: config.extractionType,
          extracted: ["test entity 1", "test entity 2"],
          text: config.inputText || "",
          instructions: config.instructions,
          returnFormat: config.returnFormat
        }
      case "ai_action_sentiment": {
        const includeConfidence = config.confidence !== false
        return {
          type: actionType,
          success: true,
          sentiment: "positive",
          confidence: includeConfidence ? 0.85 : undefined,
          text: config.inputText || "",
          labels: config.labels
        }
      }
      case "ai_action_translate":
        return {
          type: actionType,
          success: true,
          originalText: config.inputText || "",
          translatedText: `[Translated to ${config.targetLanguage}] ${config.inputText || ""}`,
          sourceLanguage: config.sourceLanguage,
          targetLanguage: config.targetLanguage
        }
      case "ai_action_generate": {
        const prompt = config.prompt || ""
        const timestamp = new Date().toISOString()
        return {
          type: actionType,
          success: true,
          prompt,
          content: `Test generated content based on: ${prompt.substring(0, 40)}...`,
          contentType: config.contentType,
          tone: config.tone,
          length: config.length,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          inputData: config.inputData,
          timestamp
        }
      }
      case "ai_action_classify": {
        const categories = config.categories || []
        const firstCategory = Array.isArray(categories) && categories.length > 0 ? categories[0] : "unknown"
        const includeConfidence = config.confidence !== false
        return {
          type: actionType,
          success: true,
          text: config.inputText || "",
          classification: firstCategory,
          confidence: includeConfidence ? 0.85 : undefined,
          categories
        }
      }
      default:
        return {
          type: actionType,
          success: true
        }
    }
  }
}
