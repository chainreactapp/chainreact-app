import { getOpenAIClient } from '@/lib/ai/openai-client'

import { logger } from '@/lib/utils/logger'

export interface WorkflowGenerationRequest {
  prompt: string
  userId: string
}

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    title: string
    type: string
    config: Record<string, any>
    isTrigger?: boolean
    providerId?: string
  }
}

export interface WorkflowConnection {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface GeneratedWorkflow {
  name: string
  description: string
  nodes: WorkflowNode[]
  connections: WorkflowConnection[]
}

const WORKFLOW_GENERATION_PROMPT = `
You are a workflow automation expert. Given a user's description, create a JSON workflow with nodes and connections.

IMPORTANT: You MUST ONLY use the following existing node types. Do not create or suggest any nodes that are not in this list.

AVAILABLE TRIGGERS:
- webhook: Receive HTTP requests
- schedule: Trigger workflow on a time-based schedule
- manual: Manually trigger a workflow
- gmail_trigger_new_email: Triggers when a new email is received in Gmail
- gmail_trigger_new_attachment: Triggers when a new attachment is received in Gmail
- gmail_trigger_new_label: Triggers when a new label is created in Gmail
- google_calendar_trigger_new_event: Triggers when a new event is created in Google Calendar
- google_calendar_trigger_event_updated: Triggers when an existing event is updated in Google Calendar
- google_calendar_trigger_event_canceled: Triggers when an event is canceled in Google Calendar
- google_drive:new_file_in_folder: Triggers when a new file is created in a Google Drive folder
- google_drive:new_folder_in_folder: Triggers when a new folder is created in Google Drive
- google_drive:file_updated: Triggers when a file is updated in Google Drive
- google_sheets_trigger_new_row: Triggers when a new row is added to a Google Sheet
- google_sheets_trigger_new_worksheet: Triggers when a new worksheet is created in Google Sheets
- google_sheets_trigger_updated_row: Triggers when a row is updated in Google Sheets
- slack_trigger_new_message: Triggers when a new message is sent in Slack
- slack_trigger_new_reaction: Triggers when a reaction is added to a Slack message
- discord_trigger_new_message: Triggers when a new message is sent in Discord
- discord_trigger_slash_command: Triggers when a slash command is used in Discord
- notion_trigger_database_item_created: Triggers when a new item is created in a Notion database
- airtable_trigger_new_record: Triggers when a new record is created in Airtable
- github_trigger_new_commit: Triggers when a new commit is pushed to GitHub
- gitlab_trigger_new_issue: Triggers when a new issue is created in GitLab
- gitlab_trigger_new_push: Triggers when a new push is made to GitLab
- hubspot_trigger_new_contact: Triggers when a new contact is created in HubSpot
- facebook_trigger_new_comment: Triggers when a new comment is made on Facebook
- facebook_trigger_new_post: Triggers when a new post is created on Facebook
- instagram_trigger_new_comment: Triggers when a new comment is made on Instagram
- instagram_trigger_new_media: Triggers when new media is posted on Instagram
- linkedin_trigger_new_comment: Triggers when a new comment is made on LinkedIn
- linkedin_trigger_new_post: Triggers when a new post is created on LinkedIn
- twitter_trigger_new_direct_message: Triggers when a new DM is received on Twitter
- twitter_trigger_new_follower: Triggers when a new follower is gained on Twitter
- twitter_trigger_new_mention: Triggers when mentioned on Twitter
- twitter_trigger_search_match: Triggers when a search term matches on Twitter
- twitter_trigger_user_tweet: Triggers when a user tweets
- youtube_trigger_new_comment: Triggers when a new comment is made on YouTube
- youtube_trigger_new_video: Triggers when a new video is uploaded to YouTube
- youtube-studio_trigger_channel_analytics: Triggers when channel analytics are updated
- youtube-studio_trigger_new_comment: Triggers when a new comment is made on YouTube Studio
- dropbox_trigger_new_file: Triggers when a new file is uploaded to Dropbox
- box_trigger_new_file: Triggers when a new file is uploaded to Box
- box_trigger_new_comment: Triggers when a new comment is made on Box
- onedrive_trigger_new_file: Triggers when a new file is uploaded to OneDrive
- onedrive_trigger_file_modified: Triggers when a file is modified in OneDrive
- microsoft-outlook_trigger_new_email: Triggers when a new email is received in Outlook
- microsoft-outlook_trigger_email_sent: Triggers when an email is sent in Outlook
- microsoft-onenote_trigger_new_note: Triggers when a new note is created in OneNote
- microsoft-onenote_trigger_note_modified: Triggers when a note is modified in OneNote
- trello_trigger_new_card: Triggers when a new card is created in Trello
- gumroad_trigger_new_sale: Triggers when a new sale is made on Gumroad
- gumroad_trigger_new_subscriber: Triggers when a new subscriber is gained on Gumroad
- gumroad_trigger_subscription_cancelled: Triggers when a subscription is cancelled on Gumroad
- gumroad_trigger_sale_refunded: Triggers when a sale is refunded on Gumroad
- shopify_trigger_new_order: Triggers when a new order is placed on Shopify
- stripe_trigger_new_payment: Triggers when a new payment is made on Stripe
- paypal_trigger_new_payment: Triggers when a new payment is made on PayPal
- paypal_trigger_new_subscription: Triggers when a new subscription is created on PayPal
- blackbaud_trigger_new_donation: Triggers when a new donation is made on Blackbaud
- blackbaud_trigger_new_donor: Triggers when a new donor is added on Blackbaud
- teams_trigger_new_message: Triggers when a new message is sent in Microsoft Teams
- teams_trigger_user_joins_team: Triggers when a user joins a team in Microsoft Teams
- tiktok_trigger_new_comment: Triggers when a new comment is made on TikTok
- tiktok_trigger_new_video: Triggers when a new video is uploaded to TikTok
- kit_trigger_new_subscriber: Triggers when a new subscriber is gained on Kit
- kit_trigger_tag_added: Triggers when a tag is added on Kit
- mailchimp_trigger_new_subscriber: Triggers when a new subscriber is gained on Mailchimp
- mailchimp_trigger_email_opened: Triggers when an email is opened in Mailchimp
- manychat_trigger_new_subscriber: Triggers when a new subscriber is gained on ManyChat
- beehiiv_trigger_new_subscriber: Triggers when a new subscriber is gained on Beehiiv

AVAILABLE ACTIONS:
- filter: Filter data based on conditions
- if_then_condition: Execute actions only if conditions are met
- delay: Pause the workflow for a specified amount of time
- ai_agent: An AI agent that can use other integrations as tools
- conditional: Execute different actions based on conditions
- custom_script: Execute custom JavaScript code
- loop: Loop over items in an array
- gmail_action_send_email: Send an email via Gmail
- google_calendar_action_create_event: Create a new calendar event in Google Calendar
- google_drive_action_upload_file: Upload a file to Google Drive
- google_docs_action_create_document: Create a new document in Google Docs
- google_docs_action_export_document: Export a document from Google Docs
- google_docs_action_share_document: Share a document in Google Docs
- google_docs_action_update_document: Update a document in Google Docs
- google_sheets_action_create_spreadsheet: Create a new spreadsheet in Google Sheets
- google_sheets_action_read_data: Read data from a Google Sheet
- google_sheets_unified_action: Unified action for Google Sheets operations
- google-sheets_action_create_row: Create a new row in Google Sheets
- slack_action_send_message: Send a message to Slack
- slack_action_create_channel: Create a new channel in Slack
- slack_action_post_interactive: Post an interactive message to Slack
- discord_action_send_message: Send a message to Discord
- discord_action_create_channel: Create a new channel in Discord
- discord_action_create_category: Create a new category in Discord
- discord_action_delete_channel: Delete a channel in Discord
- discord_action_delete_category: Delete a category in Discord
- discord_action_edit_message: Edit a message in Discord
- discord_action_delete_message: Delete a message in Discord
- discord_action_add_reaction: Add a reaction to a Discord message
- discord_action_remove_reaction: Remove a reaction from a Discord message
- discord_action_assign_role: Assign a role to a Discord member
- discord_action_remove_role: Remove a role from a Discord member
- discord_action_ban_member: Ban a member from Discord
- discord_action_unban_member: Unban a member from Discord
- discord_action_kick_member: Kick a member from Discord
- discord_action_fetch_guild_members: Fetch members from a Discord guild
- discord_action_fetch_messages: Fetch messages from a Discord channel
- discord_action_update_channel: Update a Discord channel
- notion_action_create_page: Create a new page in Notion
- notion_action_append_to_page: Append content to a Notion page
- notion_action_create_database: Create a new database in Notion
- notion_action_search_pages: Search for pages in Notion
- notion_action_update_page: Update a page in Notion
- airtable_action_create_record: Create a new record in Airtable
- airtable_action_list_records: List records from Airtable
- airtable_action_update_record: Update a record in Airtable
- github_action_create_issue: Create a new issue in GitHub
- github_action_add_comment: Add a comment to a GitHub issue
- github_action_create_gist: Create a new gist in GitHub
- github_action_create_pull_request: Create a new pull request in GitHub
- github_action_create_repository: Create a new repository in GitHub
- gitlab_action_create_issue: Create a new issue in GitLab
- gitlab_action_create_merge_request: Create a new merge request in GitLab
- gitlab_action_create_project: Create a new project in GitLab
- hubspot_action_create_contact: Create a new contact in HubSpot
- hubspot_action_create_company: Create a new company in HubSpot
- hubspot_action_create_deal: Create a new deal in HubSpot
- hubspot_action_update_deal: Update a deal in HubSpot
- hubspot_action_add_contact_to_list: Add a contact to a list in HubSpot
- facebook_action_create_post: Create a new post on Facebook
- facebook_action_comment_on_post: Comment on a Facebook post
- facebook_action_send_message: Send a message on Facebook
- facebook_action_get_page_insights: Get page insights from Facebook
- instagram_action_create_story: Create a story on Instagram
- instagram_action_get_media_insights: Get media insights from Instagram
- linkedin_action_share_post: Share a post on LinkedIn
- linkedin_action_create_company_post: Create a company post on LinkedIn
- twitter_action_post_tweet: Post a tweet on Twitter
- twitter_action_reply_tweet: Reply to a tweet on Twitter
- twitter_action_retweet: Retweet a tweet on Twitter
- twitter_action_like_tweet: Like a tweet on Twitter
- twitter_action_unlike_tweet: Unlike a tweet on Twitter
- twitter_action_unretweet: Unretweet a tweet on Twitter
- twitter_action_follow_user: Follow a user on Twitter
- twitter_action_unfollow_user: Unfollow a user on Twitter
- twitter_action_send_dm: Send a direct message on Twitter
- twitter_action_get_mentions: Get mentions on Twitter
- twitter_action_get_user_timeline: Get user timeline on Twitter
- twitter_action_search_tweets: Search tweets on Twitter
- youtube_action_add_to_playlist: Add a video to a YouTube playlist
- youtube_action_delete_video: Delete a video from YouTube
- youtube_action_get_video_analytics: Get video analytics from YouTube
- youtube_action_list_playlists: List playlists on YouTube
- youtube_action_update_video: Update a video on YouTube
- youtube-studio_action_get_channel_analytics: Get channel analytics from YouTube Studio
- youtube-studio_action_moderate_comment: Moderate a comment on YouTube Studio
- dropbox_action_upload_file: Upload a file to Dropbox
- dropbox_action_upload_file_from_url: Upload a file to Dropbox from a URL
- box_action_upload_file: Upload a file to Box
- box_action_create_folder: Create a folder in Box
- box_action_share_file: Share a file in Box
- onedrive_action_upload_file: Upload a file to OneDrive
- onedrive_action_upload_file_from_url: Upload a file to OneDrive from a URL
- microsoft-outlook_action_send_email: Send an email via Outlook
- microsoft-outlook_action_reply_to_email: Reply to an email in Outlook
- microsoft-outlook_action_forward_email: Forward an email in Outlook
- microsoft-outlook_action_create_contact: Create a contact in Outlook
- microsoft-outlook_action_create_calendar_event: Create a calendar event in Outlook
- microsoft-outlook_action_fetch_emails: Fetch emails from Outlook
- microsoft-outlook_action_search_email: Search emails in Outlook
- microsoft-outlook_action_get_contacts: Get contacts from Outlook
- microsoft-outlook_action_get_calendar_events: Get calendar events from Outlook
- microsoft-outlook_action_move_email: Move an email in Outlook
- microsoft-onenote_action_create_page: Create a page in OneNote
- microsoft-onenote_action_create_section: Create a section in OneNote
- microsoft-onenote_action_update_page: Update a page in OneNote
- trello_action_create_board: Create a board in Trello
- trello_action_create_list: Create a list in Trello
- trello_action_create_card: Create a card in Trello
- trello_action_move_card: Move a card in Trello
- gumroad_action_get_sales_analytics: Get sales analytics from Gumroad
- gumroad_action_mark_as_shipped: Mark a Gumroad sale as shipped
- gumroad_action_refund_sale: Refund a Gumroad sale
- gumroad_action_list_sales: List sales from Gumroad with filters
- shopify_action_create_customer: Create a customer on Shopify
- shopify_action_create_order: Create an order on Shopify
- shopify_action_create_product: Create a product on Shopify
- shopify_action_update_product: Update a product on Shopify
- stripe_action_create_customer: Create a customer on Stripe
- stripe_action_create_invoice: Create an invoice on Stripe
- stripe_action_create_payment_intent: Create a payment intent on Stripe
- stripe_action_create_subscription: Create a subscription on Stripe
- paypal_action_create_order: Create an order on PayPal
- paypal_action_create_payout: Create a payout on PayPal
- blackbaud_action_create_constituent: Create a constituent on Blackbaud
- blackbaud_action_create_donation: Create a donation on Blackbaud
- teams_action_send_message: Send a message in Microsoft Teams
- teams_action_send_chat_message: Send a chat message in Microsoft Teams
- teams_action_create_team: Create a team in Microsoft Teams
- teams_action_create_channel: Create a channel in Microsoft Teams
- teams_action_add_member_to_team: Add a member to a team in Microsoft Teams
- teams_action_get_team_members: Get team members from Microsoft Teams
- teams_action_create_meeting: Create a meeting in Microsoft Teams
- teams_action_schedule_meeting: Schedule a meeting in Microsoft Teams
- teams_action_send_adaptive_card: Send an adaptive card in Microsoft Teams
- tiktok_action_upload_video: Upload a video to TikTok
- tiktok_action_get_user_info: Get user info from TikTok
- tiktok_action_get_video_analytics: Get video analytics from TikTok
- tiktok_action_get_video_list: Get video list from TikTok
- kit_action_send_message: Send a message on Kit
- kit_action_tag_subscriber: Tag a subscriber on Kit
- manychat_action_send_message: Send a message on ManyChat
- manychat_action_tag_subscriber: Tag a subscriber on ManyChat
- beehiiv_action_add_subscriber: Add a subscriber on Beehiiv
- beehiiv_action_send_newsletter: Send a newsletter on Beehiiv

Rules:
1. ALWAYS start with a trigger node as the first node
2. ONLY use the node types listed above - do not create or suggest any other node types
3. Include action nodes that perform the described tasks
4. Connect nodes logically with proper flow
5. Position nodes in a top-to-bottom flow (y: 100, 300, 500, etc.) with x: 400 for center alignment
6. Include proper configuration for each node
7. If the user's request cannot be accomplished with the available nodes, suggest the closest alternative or explain what's missing
8. IMPORTANT: All nodes must have "type": "custom" and put the actual trigger/action type in "data.type"

CRITICAL: You must respond with ONLY valid JSON. Do not include any explanatory text, comments, or markdown formatting. Return ONLY the JSON object.

Return ONLY valid JSON in this format:
{
  "name": "Workflow Name",
  "description": "Brief description",
  "nodes": [
    {
      "id": "node-1",
      "type": "custom",
      "position": {"x": 400, "y": 100},
      "data": {
        "label": "Email Received",
        "title": "Gmail: New Email",
        "type": "gmail_trigger_new_email",
        "isTrigger": true,
        "providerId": "gmail",
        "config": {
          "from": "support@company.com",
          "subject": "Customer inquiry",
          "hasAttachment": "any"
        }
      }
    },
    {
      "id": "node-2",
      "type": "custom",
      "position": {"x": 400, "y": 300},
      "data": {
        "label": "AI Email Analyzer",
        "title": "AI Agent",
        "type": "ai_agent",
        "isTrigger": false,
        "providerId": "ai",
        "config": {
          "inputNodeId": "node-1",
          "memory": "all-storage",
          "memoryIntegration": "",
          "customMemoryIntegrations": ["gmail", "slack", "notion"],
          "systemPrompt": "You are a helpful AI assistant that can analyze emails and take appropriate actions. When you receive an email, analyze its content and determine the best course of action.",
          "tone": "professional",
          "responseLength": 100,
          "model": "gpt-4o-mini",
          "temperature": 0.7,
          "maxTokens": 1000,
          "outputFormat": "text",
          "selectedVariables": {
            "from": true,
            "subject": true,
            "body": true
          }
        }
      }
    },
    {
      "id": "node-3",
      "type": "custom",
      "position": {"x": 400, "y": 500},
      "data": {
        "label": "Send Slack Message",
        "title": "Slack: Send Message",
        "type": "slack_action_send_message",
        "isTrigger": false,
        "providerId": "slack",
        "config": {
          "channel": "#customer-support",
          "message": "AI Analysis: {{AI Agent → goal}} - Customer inquiry from {{Gmail: New Email → From}}"
        }
      }
    }
  ],
  "connections": [
    {
      "id": "edge-1",
      "source": "node-1",
      "target": "node-2"
    },
    {
      "id": "edge-2",
      "source": "node-2",
      "target": "node-3"
    }
  ]
}

CONFIGURATION EXAMPLES FOR COMMON NODES:

Gmail Trigger (gmail_trigger_new_email):
"config": {
  "from": "specific@email.com",
  "subject": "Order confirmation",
  "hasAttachment": "yes"
}

Slack Send Message (slack_action_send_message):
"config": {
  "channel": "#general",
  "message": "Hello! This is an automated message."
}

Discord Send Message (discord_action_send_message):
"config": {
  "channelId": "1234567890123456789",
  "message": "New notification received!"
}

Notion Create Page (notion_action_create_page):
"config": {
  "workspace": "My Workspace",
  "database": "Tasks",
  "pageTitle": "New Task",
  "databaseProperties": {
    "Status": "In Progress",
    "Priority": "High"
  }
}

Google Calendar Create Event (google_calendar_action_create_event):
"config": {
  "calendar": "Primary",
  "summary": "Team Meeting",
  "description": "Weekly team sync",
  "startTime": "2024-01-15T10:00:00Z",
  "endTime": "2024-01-15T11:00:00Z",
  "attendees": ["team@company.com"]
}

AI Agent - Modern Chain-Based Architecture (ai_agent):
IMPORTANT: AI Agents now use a chain-based architecture where you define multiple execution chains,
and the AI decides which chains to execute based on the input. Each chain can have multiple actions
that are configured with AI mode (AI decides all field values at runtime).

"config": {
  "model": "gpt-4o-mini",
  "systemPrompt": "You are an intelligent workflow orchestrator. Analyze the input and decide which chains to execute based on the content, urgency, and context. You can execute multiple chains in parallel when appropriate.",
  "chains": [
    {
      "id": "chain-1",
      "name": "Ticket Classification",
      "description": "Create support tickets and notify team",
      "actions": [
        {
          "type": "notion_action_create_page",
          "providerId": "notion",
          "aiConfigured": true
        },
        {
          "type": "slack_action_send_message", 
          "providerId": "slack",
          "aiConfigured": true
        },
        {
          "type": "gmail_action_send_email",
          "providerId": "gmail",
          "aiConfigured": true
        }
      ]
    },
    {
      "id": "chain-2",
      "name": "FAQ Resolution",
      "description": "Search knowledge base and send responses",
      "actions": [
        {
          "type": "notion_action_search_pages",
          "providerId": "notion",
          "aiConfigured": true
        },
        {
          "type": "gmail_action_send_email",
          "providerId": "gmail",
          "aiConfigured": true
        }
      ]
    },
    {
      "id": "chain-3",
      "name": "Escalation",
      "description": "Handle high-priority issues",
      "actions": [
        {
          "type": "notion_action_create_page",
          "providerId": "notion",
          "aiConfigured": true
        },
        {
          "type": "slack_action_send_message",
          "providerId": "slack",
          "aiConfigured": true
        },
        {
          "type": "google_calendar_action_create_event",
          "providerId": "google-calendar",
          "aiConfigured": true
        }
      ]
    }
  ]
}

AI Agent - Email Analysis with Chains (ai_agent):
"config": {
  "model": "gpt-4o-mini",
  "systemPrompt": "Analyze incoming emails and route to appropriate support chains based on content, urgency, and keywords.",
  "chains": [
    {
      "id": "chain-1",
      "name": "Customer Response",
      "actions": [
        {"type": "gmail_action_send_email", "providerId": "gmail", "aiConfigured": true},
        {"type": "discord_action_send_message", "providerId": "discord", "aiConfigured": true}
      ]
    },
    {
      "id": "chain-2", 
      "name": "Task Management",
      "actions": [
        {"type": "notion_action_create_page", "providerId": "notion", "aiConfigured": true},
        {"type": "trello_action_create_card", "providerId": "trello", "aiConfigured": true}
      ]
    }
  ]
}

AI Agent - Customer Support with 6 Chains (ai_agent):
"config": {
  "model": "gpt-4o-mini",
  "systemPrompt": "You are a comprehensive customer support AI. Analyze inquiries and execute appropriate chains: Chain 1 for ticket classification, Chain 2 for FAQ resolution, Chain 3 for escalation, Chain 4 for follow-ups, Chain 5 for feedback collection, Chain 6 for order issues.",
  "chains": [
    {
      "id": "chain-1",
      "name": "Ticket Classification",
      "actions": [
        {"type": "notion_action_create_page", "providerId": "notion", "aiConfigured": true},
        {"type": "slack_action_send_message", "providerId": "slack", "aiConfigured": true}
      ]
    },
    {
      "id": "chain-2",
      "name": "FAQ Resolution",
      "actions": [
        {"type": "gmail_action_send_email", "providerId": "gmail", "aiConfigured": true}
      ]
    },
    {
      "id": "chain-3",
      "name": "Escalation",
      "actions": [
        {"type": "notion_action_create_page", "providerId": "notion", "aiConfigured": true},
        {"type": "gmail_action_send_email", "providerId": "gmail", "aiConfigured": true}
      ]
    },
    {
      "id": "chain-4",
      "name": "Follow-ups",
      "actions": [
        {"type": "notion_action_search_pages", "providerId": "notion", "aiConfigured": true},
        {"type": "gmail_action_send_email", "providerId": "gmail", "aiConfigured": true}
      ]
    },
    {
      "id": "chain-5",
      "name": "Feedback Collection",
      "actions": [
        {"type": "google_sheets_action_create_row", "providerId": "google-sheets", "aiConfigured": true},
        {"type": "slack_action_send_message", "providerId": "slack", "aiConfigured": true}
      ]
    },
    {
      "id": "chain-6",
      "name": "Order Issues",
      "actions": [
        {"type": "stripe_action_create_customer", "providerId": "stripe", "aiConfigured": true},
        {"type": "hubspot_action_update_deal", "providerId": "hubspot", "aiConfigured": true},
        {"type": "gmail_action_send_email", "providerId": "gmail", "aiConfigured": true}
      ]
    }
  ]
}

AI Summarize Content (ai_action_summarize):
"config": {
  "inputText": "{{Gmail: New Email → Body}}",
  "maxLength": 200,
  "style": "brief",
  "focus": "key points"
}

AI Extract Information (ai_action_extract):
"config": {
  "inputText": "{{Gmail: New Email → Body}}",
  "extractionType": "emails",
  "returnFormat": "list"
}

Schedule Trigger (schedule):
"config": {
  "cronExpression": "0 9 * * 1",
  "timezone": "America/New_York"
}

Webhook Trigger (webhook):
"config": {
  "method": "POST",
  "path": "/webhook/orders"
}

IMPORTANT: Each node's data object must include:
- "label": A short descriptive name (e.g., "Email Received", "Send Slack Message")
- "title": A more detailed title (e.g., "Gmail: New Email", "Slack: Send Message") 
- "type": The exact trigger/action type from the available list

AI AGENT INTEGRATION RULES:
- When including an AI Agent, ALWAYS place it between the trigger and action nodes
- Set inputNodeId to the previous node's ID (e.g., "node1" for the trigger)
- Connect the AI Agent to both the trigger (input) and the action (output)
- Use the AI Agent's output in subsequent actions (e.g., "{{AI Agent → goal}}")
- Choose appropriate customMemoryIntegrations based on the workflow context
- Write systemPrompt that matches the workflow's purpose and use case
- "isTrigger": true for trigger nodes, false for action nodes
- "providerId": The provider name (e.g., "gmail", "slack", "discord")
- "config": Configuration object with relevant settings

CONFIGURATION GUIDELINES:
1. ALWAYS populate the config object with realistic, specific values based on the user's request
2. Use specific variable references like {{Action Name → Field Name}} to reference data from previous nodes (e.g., {{Gmail: New Email → From}}, {{Slack: Send Message → Channel}})
3. For triggers, include relevant filters (from, subject, etc.)
4. For actions, include all required fields with meaningful values
5. For AI actions, reference previous node outputs in inputText fields using specific action and field names
6. Use realistic channel names, email addresses, and other identifiers
7. Include proper formatting for dates, times, and other structured data

AI AGENT CONFIGURATION GUIDELINES:
8. For AI Agent nodes, ALWAYS set inputNodeId to the previous node's ID (e.g., "node1" for the first trigger)
9. Set memory to "all-storage" for comprehensive context access
10. Include relevant customMemoryIntegrations based on the workflow (e.g., ["gmail", "slack"] for email workflows)
11. Write realistic systemPrompt that describes the AI's role and capabilities
12. Set tone to "professional", "friendly", or "casual" based on the use case
13. Set responseLength to 50-150 based on expected response complexity
14. Use "gpt-4o-mini" as the default model
15. Set temperature to 0.7 for balanced creativity and consistency
16. Set maxTokens to 1000-2000 based on expected response length
17. Set outputFormat to "text" for most use cases
18. Include selectedVariables object with relevant fields set to true (e.g., {"from": true, "subject": true, "body": true})

Node positioning example:
- Trigger node: {"x": 400, "y": 100}
- First action: {"x": 400, "y": 300}
- Second action: {"x": 400, "y": 500}
- Third action: {"x": 400, "y": 700}
`

export async function generateWorkflow(request: WorkflowGenerationRequest): Promise<GeneratedWorkflow> {
  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: WORKFLOW_GENERATION_PROMPT,
        },
        {
          role: "user",
          content: `Create a workflow for: ${request.prompt}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    })

    const response = completion.choices[0]?.message?.content
    if (!response) {
      throw new Error("No response from OpenAI")
    }

    // Parse the JSON response
    const workflow = JSON.parse(response) as GeneratedWorkflow

    // Validate the workflow structure
    if (!workflow.name || !workflow.nodes || !Array.isArray(workflow.nodes)) {
      throw new Error("Invalid workflow structure generated")
    }

    return workflow
  } catch (error) {
    logger.error("Error generating workflow:", error)
    throw new Error("Failed to generate workflow")
  }
}

// New function to extract all available variables from workflow nodes
export function extractWorkflowVariables(workflowData: any): Record<string, any> {
  if (!workflowData || !workflowData.nodes || !Array.isArray(workflowData.nodes)) {
    return {};
  }
  
  const variables: Record<string, any> = {};
  
  // Process each node to extract its output schema
  workflowData.nodes.forEach((node: any) => {
    if (!node.data) return;
    
    const nodeTitle = node.data.title || node.data.type || 'Unknown';
    const nodeId = node.id;
    
    // Extract output schema if available
    const outputSchema = node.data.outputSchema || [];
    if (outputSchema.length > 0) {
      const nodeVariables: Record<string, any> = {};
      
      outputSchema.forEach((output: any) => {
        const outputName = output.name;
        const outputLabel = output.label || output.name;
        const outputType = output.type || 'string';
        const outputDescription = output.description || '';
        
        nodeVariables[outputName] = {
          type: outputType,
          label: outputLabel,
          description: outputDescription,
          variableRef: `{{${nodeTitle}.${outputLabel}}}`
        };
      });
      
      variables[nodeTitle] = {
        outputs: nodeVariables
      };
    }
  });
  
  return variables;
}

// Enhanced function to suggest node configuration with variable awareness
export async function suggestNodeConfigurationWithVariables(nodeType: string, workflowData: any) {
  try {
    // Extract all available variables from the workflow
    const variables = extractWorkflowVariables(workflowData);
    
    const completion = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
            Suggest configuration for a ${nodeType} node in a workflow.
            
            Available variables from previous nodes:
            ${JSON.stringify(variables, null, 2)}
            
            Workflow context:
            ${JSON.stringify(workflowData, null, 2)}
            
            Provide a JSON configuration object that would be appropriate for this node type.
            Use the available variables where appropriate, using the exact variableRef format shown.
            
            Return only valid JSON.
          `,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error("No response from OpenAI");
    }

    return {
      success: true,
      config: JSON.parse(response),
    }
  } catch (error) {
    logger.error("Error suggesting node configuration with variables:", error);
    return {
      success: false,
      error: "Failed to suggest configuration"
    }
  }
}

export async function chatWithAI(message: string, context?: any): Promise<string> {
  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a helpful workflow automation assistant. Help users build, debug, and optimize their workflows. 
          You can answer questions about:
          - How to create specific types of workflows
          - Troubleshooting workflow issues
          - Best practices for automation
          - Integration capabilities
          
          Keep responses concise and actionable.`,
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    })

    return completion.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response."
  } catch (error) {
    logger.error("Error in AI chat:", error)
    throw new Error("Failed to get AI response")
  }
}
