import React from "react"
import { NodeComponent } from "../../types"

const AIAgentIcon = ({ className }: { className?: string }) =>
  React.createElement("img", {
    src: "/integrations/ai.svg",
    alt: "AI Agent",
    className: className ? `object-contain ${className}` : "h-5 w-5 object-contain",
    width: 20,
    height: 20,
    draggable: false,
    loading: "lazy",
    decoding: "async",
  })

/**
 * Autonomous AI Agent Node
 *
 * This intelligent agent automatically:
 * 1. Detects connected output paths and chains
 * 2. Analyzes input data and task requirements
 * 3. Generates content if needed for downstream nodes
 * 4. Routes to the best path based on context
 * 5. Makes all decisions autonomously - no mode selection needed!
 *
 * The agent is smart enough to know what to do based on:
 * - What you ask it to do (the prompt)
 * - What's connected to it (single path vs multiple paths)
 * - What comes after it (does the next node need generated content?)
 */
export const aiAgentNode: NodeComponent = {
  type: "ai_agent",
  title: "AI Agent",
  description: "Get Custom AI Responses Using ChatGPT or Gemini",
  icon: AIAgentIcon,
  category: "AI & Automation",
  providerId: "ai",
  isTrigger: false,
  testable: true,
  hasMultipleOutputs: true,
  producesOutput: true,
  requiresInput: true,
  billableTest: true, // AI calls cost money - deduct from user's task quota when testing
  testCost: 1,

  configSchema: [
    // ========================================
    // ACTION TYPE - Pre-built templates like Zapier/Make
    // ========================================
    {
      name: "actionType",
      label: "What do you want the AI to do?",
      type: "select",
      required: true,
      defaultValue: "respond",
      options: [
        { value: "respond", label: "✉️ Respond - Reply to emails, messages, or inquiries" },
        { value: "extract", label: "📋 Extract Data - Pull specific information from text" },
        { value: "summarize", label: "📝 Summarize - Create concise summaries" },
        { value: "classify", label: "🏷️ Classify - Categorize, tag, or analyze sentiment" },
        { value: "translate", label: "🌐 Translate - Convert to another language" },
        { value: "generate", label: "✨ Generate - Create new content from scratch" },
        { value: "custom", label: "🔧 Custom - Write your own prompt" }
      ],
      description: "Choose a task type for optimized results, or use Custom for full control"
    },

    // ========================================
    // SMART PROMPT TEMPLATES (shown based on actionType)
    // ========================================

    // RESPOND - Email/Message reply
    {
      name: "respondInstructions",
      label: "Response Instructions",
      type: "textarea",
      multiline: true,
      rows: 6,
      required: true,
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "respond" },
      hasVariablePicker: true,
      placeholder: `How should the AI respond? Examples:
• "Be helpful and address their question directly"
• "Acknowledge their concern and offer a solution"
• "Thank them for their inquiry and provide next steps"`,
      description: "Required (Q11). Guide how the AI should respond — the prior silent fallback (\"Respond helpfully to the incoming message\") is removed because AI behavior is too central to workflow output to silently substitute."
    },

    // EXTRACT - Data extraction
    {
      name: "extractFields",
      label: "What data should be extracted?",
      type: "textarea",
      multiline: true,
      rows: 8,
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "extract" },
      hasVariablePicker: true,
      required: true,
      placeholder: `List the fields to extract (one per line):
name
email
phone
order_number
amount
date

Or describe what to look for:
"Extract the customer's name, email address, and any order numbers mentioned"`,
      description: "Specify the data fields you want the AI to extract"
    },

    // SUMMARIZE - Summarization
    {
      name: "summarizeFormat",
      label: "Summary Format",
      type: "select",
      defaultValue: "bullets",
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "summarize" },
      options: [
        { value: "bullets", label: "Bullet points (3-5 key points)" },
        { value: "paragraph", label: "Short paragraph (2-3 sentences)" },
        { value: "oneliner", label: "One-line summary" },
        { value: "detailed", label: "Detailed summary with sections" }
      ],
      description: "How the summary should be formatted"
    },
    {
      name: "summarizeFocus",
      label: "What to focus on (Optional)",
      type: "text",
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "summarize" },
      hasVariablePicker: true,
      placeholder: "e.g., action items, key decisions, main topics",
      description: "Optionally specify what aspects to emphasize"
    },

    // CLASSIFY - Classification/Sentiment
    {
      name: "classifyCategories",
      label: "Categories",
      type: "textarea",
      multiline: true,
      rows: 6,
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "classify" },
      required: true,
      placeholder: `List your categories (one per line):
bug
feature_request
question
feedback
complaint

Or use common presets like:
"sentiment" for positive/negative/neutral
"priority" for high/medium/low
"urgency" for urgent/normal/low`,
      description: "The categories the AI should classify into"
    },
    {
      name: "classifyMultiple",
      label: "Allow multiple categories?",
      type: "select",
      defaultValue: "single",
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "classify" },
      options: [
        { value: "single", label: "Single category only" },
        { value: "multiple", label: "Can have multiple categories" }
      ],
      description: "Whether the input can belong to multiple categories"
    },

    // TRANSLATE - Translation
    {
      name: "translateTo",
      label: "Translate to",
      type: "select",
      required: true,
      defaultValue: "spanish",
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "translate" },
      options: [
        { value: "spanish", label: "Spanish" },
        { value: "french", label: "French" },
        { value: "german", label: "German" },
        { value: "italian", label: "Italian" },
        { value: "portuguese", label: "Portuguese" },
        { value: "chinese", label: "Chinese (Simplified)" },
        { value: "japanese", label: "Japanese" },
        { value: "korean", label: "Korean" },
        { value: "arabic", label: "Arabic" },
        { value: "hindi", label: "Hindi" },
        { value: "russian", label: "Russian" },
        { value: "dutch", label: "Dutch" },
        { value: "other", label: "Other (specify below)" }
      ],
      description: "Target language for translation"
    },
    {
      name: "translateToCustom",
      label: "Target Language",
      type: "text",
      dependsOn: "translateTo",
      visibilityCondition: { field: "translateTo", operator: "equals", value: "other" },
      required: true,
      placeholder: "e.g., Swedish, Polish, Thai",
      description: "Specify the target language"
    },
    {
      name: "translatePreserve",
      label: "Preserve formatting?",
      type: "select",
      defaultValue: "yes",
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "translate" },
      options: [
        { value: "yes", label: "Yes - Keep original formatting" },
        { value: "no", label: "No - Plain text only" }
      ],
      description: "Whether to preserve markdown, HTML, or other formatting"
    },

    // GENERATE - Content generation
    {
      name: "generateType",
      label: "What to generate",
      type: "select",
      required: true,
      defaultValue: "email",
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "generate" },
      options: [
        { value: "email", label: "Email" },
        { value: "message", label: "Chat message (Slack, Discord, etc.)" },
        { value: "social", label: "Social media post" },
        { value: "document", label: "Document or article" },
        { value: "description", label: "Product/item description" },
        { value: "other", label: "Other content" }
      ],
      description: "Type of content to generate"
    },
    {
      name: "generateInstructions",
      label: "Generation Instructions",
      type: "textarea",
      multiline: true,
      rows: 6,
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "generate" },
      hasVariablePicker: true,
      required: true,
      placeholder: `Describe what you want generated:
• "Write a welcome email for new subscribers"
• "Create a product description for {{trigger.product.name}}"
• "Draft a meeting summary based on the notes"`,
      description: "Detailed instructions for content generation"
    },

    // CUSTOM - Full prompt control (original behavior)
    {
      name: "prompt",
      label: "Custom Prompt",
      type: "textarea",
      multiline: true,
      rows: 12,
      dependsOn: "actionType",
      visibilityCondition: { field: "actionType", operator: "equals", value: "custom" },
      required: true,
      hasVariablePicker: true,
      hasImproveButton: true,
      placeholder: `Write your complete prompt here. Examples:
• "Summarize this article in 3 bullet points"
• "Extract the customer name and order number from {{trigger.email.body}}"
• "Analyze sentiment and classify as positive, negative, or neutral"
• "Generate a professional response to this customer inquiry"`,
      description: "Full control over what the AI does"
    },

    // ========================================
    // OPTIONAL: CONTEXT & INSTRUCTIONS
    // ========================================
    {
      name: "systemInstructions",
      label: "Additional Instructions (Optional)",
      type: "textarea",
      multiline: true,
      rows: 7,
      placeholder: `Optional: Give the AI additional context or rules

Examples:
• "Always maintain a professional tone"
• "Our refund policy is 30 days"
• "You are a helpful customer service assistant"
• "Prioritize urgent requests"`,
      description: "Optional guidelines for the AI's behavior"
    },

    {
      name: "includeContextFrom",
      label: "Include Data From Previous Steps",
      type: "select",
      multiple: true,
      description: "Select previous steps to give the AI more context",
      placeholder: "Select steps to include as context..."
    },

    // ========================================
    // TONE & PERSONALITY
    // ========================================
    {
      name: "tone",
      label: "Response Tone",
      type: "select",
      defaultValue: "professional",
      options: [
        { value: "professional", label: "Professional - Clear and business-appropriate" },
        { value: "friendly", label: "Friendly - Warm and approachable" },
        { value: "casual", label: "Casual - Relaxed and conversational" },
        { value: "formal", label: "Formal - Polished and traditional" },
        { value: "concise", label: "Concise - Brief and to the point" }
      ],
      description: "How should the AI communicate?"
    },

    // ========================================
    // SIGNATURE SETTINGS
    // ========================================
    {
      name: "includeSignature",
      label: "Include Signature",
      type: "select",
      defaultValue: "none",
      options: [
        { value: "none", label: "No signature" },
        { value: "name_only", label: "Name only (from your profile)" },
        { value: "full", label: "Full signature (name, title, company)" },
        { value: "custom", label: "Custom signature" }
      ],
      description: "Automatically add a signature to AI responses"
    },

    {
      name: "customSignature",
      label: "Custom Signature",
      type: "textarea",
      multiline: true,
      rows: 4,
      dependsOn: "includeSignature",
      visibilityCondition: { field: "includeSignature", operator: "equals", value: "custom" },
      placeholder: `Best regards,
John Doe
CEO, Acme Corp
john@acme.com`,
      description: "Your custom signature (supports line breaks)"
    },

    {
      name: "signaturePrefix",
      label: "Sign-off Style",
      type: "select",
      defaultValue: "best",
      dependsOn: "includeSignature",
      // Only show for name_only and full - custom already includes the full signature
      visibilityCondition: { field: "includeSignature", operator: "in", value: ["name_only", "full"] },
      options: [
        { value: "best", label: "Best regards," },
        { value: "thanks", label: "Thanks," },
        { value: "sincerely", label: "Sincerely," },
        { value: "cheers", label: "Cheers," },
        { value: "regards", label: "Regards," },
        { value: "none", label: "No sign-off (name only)" }
      ],
      description: "The closing phrase before your name"
    },

    // ========================================
    // MODEL CONFIGURATION
    // ========================================
    {
      name: "model",
      label: "AI Model",
      type: "select",
      required: true,
      defaultValue: "gpt-4o-mini",
      options: [
        { value: "gpt-4o", label: "GPT-4o (Most capable, higher cost)" },
        { value: "gpt-4o-mini", label: "GPT-4o Mini ⭐ Recommended (Best balance)" },
        { value: "gpt-4-turbo", label: "GPT-4 Turbo (Fast, 128k context)" },
        { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo (Budget friendly)" },
        { value: "claude-3-opus", label: "Claude 3 Opus (Best reasoning)" },
        { value: "claude-3-sonnet", label: "Claude 3 Sonnet (Balanced)" },
        { value: "claude-3-haiku", label: "Claude 3 Haiku (Fastest, cheapest)" },
        { value: "gemini-pro", label: "Gemini Pro (Google)" }
      ],
      description: "Which AI model to use"
    },

    {
      name: "apiSource",
      label: "API Source",
      type: "select",
      required: true,
      defaultValue: "chainreact",
      options: [
        { value: "chainreact", label: "ChainReact Managed (No setup required)" },
        { value: "custom", label: "Use my own API key" }
      ],
      description: "Use ChainReact's API or provide your own"
    },

    {
      name: "customApiKey",
      label: "API Key",
      type: "password",
      dependsOn: "apiSource",
      visibilityCondition: { field: "apiSource", operator: "equals", value: "custom" },
      placeholder: "sk-...",
      description: "Your API key (encrypted and secure)"
    },

    {
      name: "customApiProvider",
      label: "API Provider",
      type: "select",
      dependsOn: "apiSource",
      visibilityCondition: { field: "apiSource", operator: "equals", value: "custom" },
      required: true,
      options: [
        { value: "openai", label: "OpenAI" },
        { value: "anthropic", label: "Anthropic (Claude)" },
        { value: "google", label: "Google (Gemini)" }
      ],
      description: "Select your API provider"
    },

    // ========================================
    // OUTPUT CONFIGURATION
    // ========================================
    {
      name: "outputFormat",
      label: "Output Format Hint (Optional)",
      type: "textarea",
      multiline: true,
      rows: 9,
      placeholder: `Optionally tell the AI what format you need the output in:

Examples:
• "subject, body, tone"
• "decision, reasoning, confidence_score"
• "approved: boolean, feedback: string"
• "priority: high/medium/low, category: string"

The AI will structure its output accordingly.`,
      description: "Hint at what structured data you want extracted (optional)"
    },

    {
      name: "outputPaths",
      label: "Output Paths (Auto-detected)",
      type: "info",
      description: "The AI automatically detects connected paths and routes intelligently. You can name paths in the visual editor."
    },

    // ========================================
    // ADVANCED SETTINGS
    // ========================================
    {
      name: "temperature",
      label: "Creativity",
      type: "slider",
      min: 0,
      max: 1,
      step: 0.1,
      defaultValue: 0.7,
      description: "Lower (0-0.3) = focused and consistent. Higher (0.7-1.0) = creative and varied"
    },

    {
      name: "maxTokens",
      label: "Max Response Length",
      type: "number",
      min: 100,
      max: 4000,
      step: 100,
      defaultValue: 1500,
      description: "Maximum length of AI response (roughly 4 characters per token)"
    },

    {
      name: "timeout",
      label: "Timeout (seconds)",
      type: "number",
      min: 5,
      max: 120,
      defaultValue: 30,
      description: "Maximum time to wait for AI response"
    },

    {
      name: "maxRetries",
      label: "Retry Attempts",
      type: "number",
      min: 0,
      max: 3,
      defaultValue: 1,
      description: "Number of retry attempts on failure"
    },

    {
      name: "costLimit",
      label: "Cost Limit ($)",
      type: "number",
      min: 0.01,
      max: 10,
      step: 0.01,
      defaultValue: 1.00,
      description: "Maximum cost per execution"
    },

    {
      name: "minConfidence",
      label: "Routing Confidence Threshold",
      type: "slider",
      min: 0,
      max: 1,
      step: 0.05,
      defaultValue: 0.7,
      description: "Minimum confidence required for routing decisions (only applies when multiple paths exist)"
    }
  ],

  // ========================================
  // OUTPUTS - Streamlined to avoid duplicates
  // ========================================
  outputSchema: [
    // ========================================
    // PRIMARY OUTPUTS (use these for most cases)
    // ========================================
    {
      name: "output",
      label: "AI Response",
      type: "string",
      description: "Main text output - serves as email body (Respond), summary (Summarize), translation (Translate), or generated content (Generate/Custom)"
    },
    {
      name: "data",
      label: "Structured Data",
      type: "object",
      description: "Extracted fields as key-value pairs (Extract action) or any structured data requested"
    },

    // ========================================
    // EMAIL-SPECIFIC OUTPUTS
    // ========================================
    {
      name: "email_subject",
      label: "Email Subject",
      type: "string",
      description: "Auto-generated subject line with 'Re: ...' format for email replies (Respond action only)"
    },
    {
      name: "formatted_output",
      label: "Formatted Response",
      type: "string",
      description: "Full response with subject header - use for Discord/Slack/Teams where you want complete context"
    },

    // ========================================
    // CLASSIFY ACTION OUTPUTS
    // ========================================
    {
      name: "category",
      label: "Category",
      type: "string",
      description: "The primary classification category"
    },
    {
      name: "categories",
      label: "All Categories",
      type: "array",
      description: "All matching categories (when multiple allowed)"
    },
    {
      name: "sentiment",
      label: "Sentiment",
      type: "string",
      description: "Detected sentiment (positive/negative/neutral)"
    },
    {
      name: "confidence",
      label: "Confidence",
      type: "number",
      description: "AI's confidence in the result (0-1)"
    },

    // ========================================
    // TRANSLATE ACTION OUTPUT
    // ========================================
    {
      name: "target_language",
      label: "Target Language",
      type: "string",
      description: "The language translated to"
    },

    // ========================================
    // ROUTING OUTPUTS
    // ========================================
    {
      name: "selectedPath",
      label: "Selected Path",
      type: "string",
      description: "Which path the AI chose (when routing)"
    },

    // ========================================
    // METADATA
    // ========================================
    {
      name: "tokensUsed",
      label: "Tokens Used",
      type: "number",
      description: "Number of tokens consumed"
    },
    {
      name: "costIncurred",
      label: "Cost ($)",
      type: "number",
      description: "Cost of this execution in USD"
    },
    {
      name: "modelUsed",
      label: "Model Used",
      type: "string",
      description: "Which AI model was used"
    }
  ]
}

/**
 * Router Templates (kept for backwards compatibility with masterPromptBuilder)
 * Note: These are not used in the autonomous agent UI, but may be used
 * internally for routing context
 */
export const AI_AGENT_ROUTER_TEMPLATES = {
  custom: {
    name: "Custom Router",
    systemPrompt: "You are a smart routing agent. Analyze the input and choose the best path.",
    defaultOutputs: []
  }
} as const
