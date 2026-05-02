import { MessageSquare, Calendar, Hash, UserPlus, FileText, Users, Plus, Reply, AtSign, Edit, Trash2, Info, MessageCircle, Smile, Square } from "lucide-react"
import { NodeComponent } from "../../types"

export const teamsNodes: NodeComponent[] = [
  {
    type: "teams_trigger_new_message",
    title: "New Message in Channel",
    description: "Triggers on a new message in a channel",
    icon: MessageSquare,
    providerId: "teams",
    category: "Communication",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel to monitor", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" } }
    ],
    outputSchema: [
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the new message" },
      { name: "content", label: "Message Content", type: "string", description: "The content of the message" },
      { name: "senderId", label: "Sender ID", type: "string", description: "The ID of the message sender" },
      { name: "senderName", label: "Sender Name", type: "string", description: "The name of the message sender" },
      { name: "channelId", label: "Channel ID", type: "string", description: "The ID of the channel where the message was posted" },
      { name: "channelName", label: "Channel Name", type: "string", description: "The name of the channel where the message was posted" },
      { name: "timestamp", label: "Message Time", type: "string", description: "When the message was posted (ISO 8601 format)" },
      { name: "attachments", label: "Attachments", type: "array", description: "Array of file attachments in the message" }
    ]
  },
  {
    type: "teams_trigger_user_joins_team",
    title: "User Joins Team",
    description: "Triggers when a new user joins a team",
    icon: Users,
    providerId: "teams",
    category: "Communication",
    isTrigger: true,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team to monitor" }
    ],
    outputSchema: [
      { name: "userId", label: "User ID", type: "string", description: "The ID of the user who joined" },
      { name: "userName", label: "User Name", type: "string", description: "The name of the user who joined" },
      { name: "userEmail", label: "User Email", type: "string", description: "The email of the user who joined" },
      { name: "teamId", label: "Team ID", type: "string", description: "The ID of the team the user joined" },
      { name: "teamName", label: "Team Name", type: "string", description: "The name of the team the user joined" },
      { name: "joinTime", label: "Join Time", type: "string", description: "When the user joined the team (ISO 8601 format)" },
      { name: "role", label: "User Role", type: "string", description: "The role assigned to the user in the team" }
    ]
  },
  {
    type: "teams_action_send_message",
    title: "Send Channel Message",
    description: "Send a message to a channel",
    icon: MessageSquare,
    providerId: "teams",
    requiredScopes: ["Chat.ReadWrite"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" } },
      { name: "message", label: "Message", type: "email-rich-text", required: true, placeholder: "Enter your message", dependsOn: "channelId", visibilityCondition: { field: "channelId", operator: "isNotEmpty" } }
    ],
    outputSchema: [
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the sent message" },
      { name: "channelId", label: "Channel ID", type: "string", description: "The ID of the channel where the message was sent" },
      { name: "timestamp", label: "Sent Time", type: "string", description: "When the message was sent (ISO 8601 format)" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the message was sent successfully" }
    ]
  },
  {
    type: "teams_action_send_chat_message",
    title: "Send Chat Message",
    description: "Send a message to a specific chat or user",
    icon: MessageSquare,
    providerId: "teams",
    requiredScopes: ["Chat.ReadWrite"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "chatId", label: "Chat", type: "select", dynamic: "teams_chats", required: true, placeholder: "Select a chat", loadOnMount: true },
      { name: "message", label: "Message", type: "email-rich-text", required: true, placeholder: "Enter your message", dependsOn: "chatId", visibilityCondition: { field: "chatId", operator: "isNotEmpty" } }
    ],
    outputSchema: [
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the sent message" },
      { name: "chatId", label: "Chat ID", type: "string", description: "The ID of the chat where the message was sent" },
      { name: "timestamp", label: "Sent Time", type: "string", description: "When the message was sent (ISO 8601 format)" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the message was sent successfully" }
    ]
  },
  {
    type: "teams_action_create_channel",
    title: "Create Channel",
    description: "Create a new channel in a team",
    icon: Hash,
    providerId: "teams",
    requiredScopes: ["Channel.Create"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "channelName", label: "Channel Name", type: "text", required: true, placeholder: "Enter channel name", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" }, supportsAI: true },
      { name: "description", label: "Description", type: "textarea", required: false, placeholder: "Channel description (optional)", dependsOn: "channelName", visibilityCondition: { field: "channelName", operator: "isNotEmpty" }, supportsAI: true },
      { name: "isPrivate", label: "Private Channel", type: "boolean", required: false, defaultValue: false, dependsOn: "channelName", visibilityCondition: { field: "channelName", operator: "isNotEmpty" } }
    ],
    outputSchema: [
      { name: "channelId", label: "Channel ID", type: "string", description: "The ID of the created channel" },
      { name: "channelName", label: "Channel Name", type: "string", description: "The name of the created channel" },
      { name: "teamId", label: "Team ID", type: "string", description: "The ID of the team where the channel was created" },
      { name: "isPrivate", label: "Is Private", type: "boolean", description: "Whether the channel is private" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the channel was created successfully" }
    ]
  },
  {
    type: "teams_action_add_member_to_team",
    title: "Add Member to Team",
    description: "Add a user to a team",
    icon: UserPlus,
    providerId: "teams",
    requiredScopes: ["TeamMember.ReadWrite.All"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "userEmail", label: "User Email", type: "text", required: true, placeholder: "Enter the user's email address", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" }, supportsAI: true },
      { name: "role", label: "Role", type: "select", required: true, defaultValue: "member", dependsOn: "userEmail", visibilityCondition: { field: "userEmail", operator: "isNotEmpty" }, options: [
        { value: "member", label: "Member" },
        { value: "owner", label: "Owner" }
      ] }
    ],
    outputSchema: [
      { name: "userId", label: "User ID", type: "string", description: "The ID of the added user" },
      { name: "userEmail", label: "User Email", type: "string", description: "The email of the added user" },
      { name: "teamId", label: "Team ID", type: "string", description: "The ID of the team" },
      { name: "role", label: "Role", type: "string", description: "The assigned role" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the user was added successfully" }
    ]
  },
  {
    type: "teams_action_schedule_meeting",
    title: "Schedule Meeting",
    description: "Schedule a meeting with participants",
    icon: Calendar,
    providerId: "teams",
    requiredScopes: ["Calendars.ReadWrite"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "subject", label: "Meeting Subject", type: "text", required: true, placeholder: "Enter meeting subject", supportsAI: true },
      { name: "startTime", label: "Start Time", type: "datetime", required: true, supportsAI: true },
      { name: "endTime", label: "End Time", type: "datetime", required: true, supportsAI: true },
      { name: "attendees", label: "Attendees", type: "email-autocomplete", dynamic: "outlook-enhanced-recipients", required: false, placeholder: "Select or enter attendee email addresses", supportsAI: true },
      { name: "description", label: "Description", type: "textarea", required: false, placeholder: "Meeting description", supportsAI: true },
      { name: "isOnlineMeeting", label: "Online Meeting", type: "boolean", required: false, defaultValue: true }
    ],
    outputSchema: [
      { name: "eventId", label: "Event ID", type: "string", description: "The ID of the scheduled meeting" },
      { name: "subject", label: "Meeting Subject", type: "string", description: "The subject of the meeting" },
      { name: "startTime", label: "Start Time", type: "string", description: "When the meeting starts (ISO 8601 format)" },
      { name: "endTime", label: "End Time", type: "string", description: "When the meeting ends (ISO 8601 format)" },
      { name: "joinUrl", label: "Join URL", type: "string", description: "The URL to join the online meeting (if applicable)" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the meeting was scheduled successfully" }
    ]
  },
  {
    type: "teams_action_send_adaptive_card",
    title: "Send Adaptive Card",
    description: "Send a rich adaptive card message to a channel",
    icon: FileText,
    providerId: "teams",
    requiredScopes: ["Chat.ReadWrite"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" } },
      { name: "cardTitle", label: "Card Title", type: "text", required: true, placeholder: "Enter card title", dependsOn: "channelId", visibilityCondition: { field: "channelId", operator: "isNotEmpty" }, supportsAI: true },
      { name: "cardText", label: "Card Text", type: "textarea", required: true, placeholder: "Enter card content", dependsOn: "channelId", visibilityCondition: { field: "channelId", operator: "isNotEmpty" }, supportsAI: true },
      { name: "cardType", label: "Card Type", type: "select", required: true, defaultValue: "hero", dependsOn: "channelId", visibilityCondition: { field: "channelId", operator: "isNotEmpty" }, options: [
        { value: "hero", label: "Hero Card" },
        { value: "thumbnail", label: "Thumbnail Card" },
        { value: "receipt", label: "Receipt Card" }
      ] }
    ],
    outputSchema: [
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the sent adaptive card message" },
      { name: "cardTitle", label: "Card Title", type: "string", description: "The title of the card" },
      { name: "cardType", label: "Card Type", type: "string", description: "The type of card sent" },
      { name: "channelId", label: "Channel ID", type: "string", description: "The ID of the channel where the card was sent" },
      { name: "timestamp", label: "Sent Time", type: "string", description: "When the card was sent (ISO 8601 format)" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the card was sent successfully" }
    ]
  },
  {
    type: "teams_action_get_team_members",
    title: "Get Team Members",
    description: "Get all members of a team",
    icon: Users,
    providerId: "teams",
    requiredScopes: ["TeamMember.Read.All"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team" }
    ],
    outputSchema: [
      { name: "members", label: "Team Members", type: "array", description: "Array of team member objects" },
      { name: "memberCount", label: "Member Count", type: "number", description: "Total number of team members" },
      { name: "teamId", label: "Team ID", type: "string", description: "The ID of the team" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the members were retrieved successfully" }
    ]
  },
  {
    type: "teams_action_create_team",
    title: "Create Team",
    description: "Create a new team",
    icon: Plus,
    providerId: "teams",
    requiredScopes: ["Team.Create"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "displayName", label: "Team Name", type: "text", required: true, placeholder: "Enter team name", supportsAI: true },
      { name: "description", label: "Description", type: "textarea", required: false, placeholder: "Team description (optional)", supportsAI: true },
      { name: "visibility", label: "Visibility", type: "select", required: true, defaultValue: "private", options: [
        { value: "private", label: "Private" },
        { value: "public", label: "Public" }
      ] }
    ],
    outputSchema: [
      { name: "teamId", label: "Team ID", type: "string", description: "The ID of the created team" },
      { name: "displayName", label: "Team Name", type: "string", description: "The name of the team" },
      { name: "description", label: "Description", type: "string", description: "The team description" },
      { name: "visibility", label: "Visibility", type: "string", description: "The visibility setting (private/public)" },
      { name: "webUrl", label: "Web URL", type: "string", description: "URL to the team in Teams" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the team was created successfully" }
    ]
  },
  // New Triggers
  {
    type: "teams_trigger_new_reply",
    title: "New Reply to Message",
    description: "Triggers when someone replies to a message in a channel",
    icon: Reply,
    providerId: "teams",
    category: "Communication",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel to monitor", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" } }
    ],
    outputSchema: [
      { name: "replyId", label: "Reply ID", type: "string", description: "The ID of the reply" },
      { name: "parentMessageId", label: "Parent Message ID", type: "string", description: "The ID of the message being replied to" },
      { name: "content", label: "Reply Content", type: "string", description: "The content of the reply" },
      { name: "senderId", label: "Sender ID", type: "string", description: "The ID of the reply sender" },
      { name: "senderName", label: "Sender Name", type: "string", description: "The name of the reply sender" },
      { name: "channelId", label: "Channel ID", type: "string", description: "The ID of the channel" },
      { name: "timestamp", label: "Reply Time", type: "string", description: "When the reply was posted (ISO 8601 format)" }
    ]
  },
  {
    type: "teams_trigger_channel_mention",
    title: "New Channel Mention",
    description: "Triggers when a user or keyword is mentioned in a channel",
    icon: AtSign,
    providerId: "teams",
    category: "Communication",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel to monitor", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" } },
      { name: "keywords", label: "Keywords to Monitor", type: "textarea", required: false, placeholder: "Enter keywords to monitor (one per line). Leave empty to monitor all mentions.", dependsOn: "channelId", visibilityCondition: { field: "channelId", operator: "isNotEmpty" } }
    ],
    outputSchema: [
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the message with the mention" },
      { name: "content", label: "Message Content", type: "string", description: "The content of the message" },
      { name: "mentionedUsers", label: "Mentioned Users", type: "array", description: "Array of mentioned user IDs" },
      { name: "mentionedKeywords", label: "Mentioned Keywords", type: "array", description: "Array of mentioned keywords" },
      { name: "senderId", label: "Sender ID", type: "string", description: "The ID of the message sender" },
      { name: "senderName", label: "Sender Name", type: "string", description: "The name of the message sender" },
      { name: "timestamp", label: "Message Time", type: "string", description: "When the message was posted (ISO 8601 format)" }
    ]
  },
  {
    type: "teams_trigger_new_chat",
    title: "New Chat",
    description: "Triggers when a new chat conversation is created",
    icon: MessageCircle,
    providerId: "teams",
    category: "Communication",
    isTrigger: true,
    producesOutput: true,
    configSchema: [],
    outputSchema: [
      { name: "chatId", label: "Chat ID", type: "string", description: "The ID of the new chat" },
      { name: "chatType", label: "Chat Type", type: "string", description: "Type of chat (oneOnOne, group, meeting)" },
      { name: "topic", label: "Chat Topic", type: "string", description: "The topic of the chat" },
      { name: "createdDateTime", label: "Created Time", type: "string", description: "When the chat was created (ISO 8601 format)" },
      { name: "members", label: "Members", type: "array", description: "Array of chat members" }
    ]
  },
  {
    type: "teams_trigger_new_chat_message",
    title: "New Chat Message",
    description: "Triggers when a new message is posted in any chat",
    icon: MessageSquare,
    providerId: "teams",
    category: "Communication",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      { name: "chatId", label: "Chat", type: "select", dynamic: "teams_chats", required: true, placeholder: "Select a chat" }
    ],
    outputSchema: [
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the message" },
      { name: "chatId", label: "Chat ID", type: "string", description: "The ID of the chat" },
      { name: "content", label: "Message Content", type: "string", description: "The content of the message" },
      { name: "senderId", label: "Sender ID", type: "string", description: "The ID of the message sender" },
      { name: "senderName", label: "Sender Name", type: "string", description: "The name of the message sender" },
      { name: "timestamp", label: "Message Time", type: "string", description: "When the message was posted (ISO 8601 format)" }
    ]
  },
  {
    type: "teams_trigger_new_channel",
    title: "New Channel",
    description: "Triggers when a new channel is created in a team",
    icon: Hash,
    providerId: "teams",
    category: "Communication",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team to monitor", loadOnMount: true }
    ],
    outputSchema: [
      { name: "channelId", label: "Channel ID", type: "string", description: "The ID of the new channel" },
      { name: "channelName", label: "Channel Name", type: "string", description: "The name of the new channel" },
      { name: "description", label: "Description", type: "string", description: "The channel description" },
      { name: "membershipType", label: "Membership Type", type: "string", description: "Type of channel (standard, private)" },
      { name: "createdDateTime", label: "Created Time", type: "string", description: "When the channel was created (ISO 8601 format)" }
    ]
  },
  // New Actions
  {
    type: "teams_action_reply_to_message",
    title: "Reply to Channel Message",
    description: "Reply to a specific message in a channel",
    icon: Reply,
    providerId: "teams",
    requiredScopes: ["ChannelMessage.Send"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" } },
      // Message selection method
      { name: "messageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], dependsOn: "channelId", visibilityCondition: { field: "channelId", operator: "isNotEmpty" } },
      { name: "messageId", label: "Message", type: "select", dynamic: "teams_messages", required: true, placeholder: "Select a message to reply to", dependsOn: "channelId", visibilityCondition: { field: "messageSelection", operator: "equals", value: "dropdown" } },
      { name: "messageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "messageSelection", operator: "equals", value: "manual" } },
      { name: "replyContent", label: "Reply Message", type: "email-rich-text", required: true, placeholder: "Enter your reply" }
    ],
    outputSchema: [
      { name: "replyId", label: "Reply ID", type: "string", description: "The ID of the reply message" },
      { name: "parentMessageId", label: "Parent Message ID", type: "string", description: "The ID of the parent message" },
      { name: "timestamp", label: "Sent Time", type: "string", description: "When the reply was sent (ISO 8601 format)" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the reply was sent successfully" }
    ]
  },
  {
    type: "teams_action_edit_message",
    title: "Edit Message",
    description: "Edit an existing message in a channel or chat (only your own messages)",
    icon: Edit,
    providerId: "teams",
    requiredScopes: ["ChannelMessage.Edit"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "messageType", label: "Message Type", type: "select", required: true, defaultValue: "channel", options: [
        { value: "channel", label: "Channel Message" },
        { value: "chat", label: "Chat Message" }
      ] },
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true, visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "chatId", label: "Chat", type: "select", dynamic: "teams_chats", required: true, placeholder: "Select a chat", dependsOn: "messageType", visibilityCondition: { field: "messageType", operator: "equals", value: "chat" } },
      // Message selection method - channel messages
      { name: "channelMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], dependsOn: "channelId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "messageId", label: "Message", type: "select", dynamic: "teams_messages_own", required: true, placeholder: "Select a message", dependsOn: "channelId", visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "messageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "manual" } },
      // Message selection method - chat messages
      { name: "chatMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], visibilityCondition: { field: "chatId", operator: "isNotEmpty" } },
      { name: "chatMessageId", label: "Message", type: "select", dynamic: "teams_messages_own", required: true, placeholder: "Select a message", dependsOn: "chatId", visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "chatMessageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "manual" } },
      { name: "newContent", label: "New Message Content", type: "email-rich-text", required: true, placeholder: "Enter the new message content" }
    ],
    outputSchema: [
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the edited message" },
      { name: "updatedDateTime", label: "Updated Time", type: "string", description: "When the message was edited (ISO 8601 format)" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the message was edited successfully" }
    ]
  },
  {
    type: "teams_action_find_message",
    title: "Get Message",
    description: "Retrieve details of a specific message",
    icon: Info,
    providerId: "teams",
    requiredScopes: ["ChannelMessage.Read.All"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "messageType", label: "Message Type", type: "select", required: true, defaultValue: "channel", options: [
        { value: "channel", label: "Channel Message" },
        { value: "chat", label: "Chat Message" }
      ] },
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true, visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "chatId", label: "Chat", type: "select", dynamic: "teams_chats", required: true, placeholder: "Select a chat", dependsOn: "messageType", visibilityCondition: { field: "messageType", operator: "equals", value: "chat" } },
      // Message selection method - channel messages
      { name: "channelMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], dependsOn: "channelId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "messageId", label: "Message", type: "select", dynamic: "teams_messages", required: true, placeholder: "Select a message", dependsOn: "channelId", visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "messageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "manual" } },
      // Message selection method - chat messages
      { name: "chatMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], visibilityCondition: { field: "chatId", operator: "isNotEmpty" } },
      { name: "chatMessageId", label: "Message", type: "select", dynamic: "teams_messages", required: true, placeholder: "Select a message", dependsOn: "chatId", visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "chatMessageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "manual" } }
    ],
    outputSchema: [
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the message" },
      { name: "content", label: "Message Content", type: "string", description: "The content of the message" },
      { name: "senderId", label: "Sender ID", type: "string", description: "The ID of the sender" },
      { name: "senderName", label: "Sender Name", type: "string", description: "The name of the sender" },
      { name: "createdDateTime", label: "Created Time", type: "string", description: "When the message was created" },
      { name: "attachments", label: "Attachments", type: "array", description: "Array of attachments" },
      { name: "reactions", label: "Reactions", type: "array", description: "Array of reactions" }
    ]
  },
  {
    type: "teams_action_delete_message",
    title: "Delete Message",
    description: "Delete a message from a channel or chat (only your own messages)",
    icon: Trash2,
    providerId: "teams",
    requiredScopes: ["ChannelMessage.Edit"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "messageType", label: "Message Type", type: "select", required: true, defaultValue: "channel", options: [
        { value: "channel", label: "Channel Message" },
        { value: "chat", label: "Chat Message" }
      ] },
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true, visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "chatId", label: "Chat", type: "select", dynamic: "teams_chats", required: true, placeholder: "Select a chat", dependsOn: "messageType", visibilityCondition: { field: "messageType", operator: "equals", value: "chat" } },
      // Message selection method - channel messages
      { name: "channelMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], dependsOn: "channelId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "messageId", label: "Message", type: "select", dynamic: "teams_messages_own", required: true, placeholder: "Select a message", dependsOn: "channelId", visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "messageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "manual" } },
      // Message selection method - chat messages
      { name: "chatMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], visibilityCondition: { field: "chatId", operator: "isNotEmpty" } },
      { name: "chatMessageId", label: "Message", type: "select", dynamic: "teams_messages_own", required: true, placeholder: "Select a message", dependsOn: "chatId", visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "chatMessageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "manual" } }
    ],
    outputSchema: [
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the message was deleted successfully" },
      { name: "deletedMessageId", label: "Deleted Message ID", type: "string", description: "The ID of the deleted message" }
    ]
  },
  {
    type: "teams_action_create_group_chat",
    title: "Create Group Chat",
    description: "Create a new group chat with multiple users (supports external guests)",
    icon: Users,
    providerId: "teams",
    requiredScopes: ["Chat.Create", "User.Invite.All"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "topic", label: "Chat Topic", type: "text", required: false, placeholder: "Enter chat topic (optional)", supportsAI: true },
      { name: "members", label: "Members", type: "textarea", required: true, placeholder: "Enter member email addresses (one per line or comma-separated)", supportsAI: true, info: "Enter email addresses of users to add to the chat. Internal users will be added directly. For external users, enable 'Invite External Users' below." },
      { name: "inviteExternalUsers", label: "Invite External Users", type: "boolean", required: false, defaultValue: false, info: "If enabled, users not found in your organization will be automatically invited as guest users to your Azure AD tenant." },
      { name: "sendInvitationEmail", label: "Send Invitation Email", type: "boolean", required: true, description: "Required (Q11). Recommended: false — group-chat invitations contact real people on every workflow run.", visibilityCondition: { field: "inviteExternalUsers", operator: "equals", value: true }, info: "Send an email invitation to external users being invited to your organization." },
      { name: "initialMessage", label: "Initial Message", type: "email-rich-text", required: false, placeholder: "Send an initial message (optional)" }
    ],
    outputSchema: [
      { name: "chatId", label: "Chat ID", type: "string", description: "The ID of the created chat" },
      { name: "chatType", label: "Chat Type", type: "string", description: "Type of chat (group)" },
      { name: "topic", label: "Chat Topic", type: "string", description: "The topic of the chat" },
      { name: "createdDateTime", label: "Created Time", type: "string", description: "When the chat was created (ISO 8601 format)" },
      { name: "membersAdded", label: "Members Added", type: "number", description: "Number of members successfully added to the chat" },
      { name: "addedMembers", label: "Added Members", type: "array", description: "List of email addresses of members who were already in the directory and added" },
      { name: "invitedMembers", label: "Invited Members", type: "array", description: "List of email addresses of external users who were invited and added" },
      { name: "failedMembers", label: "Failed Members", type: "array", description: "List of email addresses that could not be added" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the chat was created successfully" }
    ]
  },
  {
    type: "teams_action_get_channel_details",
    title: "Get Channel Details",
    description: "Retrieve detailed information about a channel",
    icon: Info,
    providerId: "teams",
    requiredScopes: ["Channel.ReadBasic.All"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "teamId", operator: "isNotEmpty" } }
    ],
    outputSchema: [
      { name: "channelId", label: "Channel ID", type: "string", description: "The ID of the channel" },
      { name: "displayName", label: "Channel Name", type: "string", description: "The name of the channel" },
      { name: "description", label: "Description", type: "string", description: "The channel description" },
      { name: "email", label: "Channel Email", type: "string", description: "The email address of the channel" },
      { name: "membershipType", label: "Membership Type", type: "string", description: "Type of channel (standard, private)" },
      { name: "createdDateTime", label: "Created Time", type: "string", description: "When the channel was created" },
      { name: "webUrl", label: "Web URL", type: "string", description: "URL to the channel in Teams" }
    ]
  },
  // Message Reactions
  {
    type: "teams_action_add_reaction",
    title: "Add Reaction to Message",
    description: "Add an emoji reaction to a message",
    icon: Smile,
    providerId: "teams",
    requiredScopes: ["ChannelMessage.Send"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "messageType", label: "Message Type", type: "select", required: true, defaultValue: "channel", options: [
        { value: "channel", label: "Channel Message" },
        { value: "chat", label: "Chat Message" }
      ] },
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true, visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "chatId", label: "Chat", type: "select", dynamic: "teams_chats", required: true, placeholder: "Select a chat", dependsOn: "messageType", visibilityCondition: { field: "messageType", operator: "equals", value: "chat" } },
      // Message selection method - channel messages
      { name: "channelMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], dependsOn: "channelId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "messageId", label: "Message", type: "select", dynamic: "teams_messages", required: true, placeholder: "Select a message", dependsOn: "channelId", visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "messageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "manual" } },
      // Message selection method - chat messages
      { name: "chatMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], visibilityCondition: { field: "chatId", operator: "isNotEmpty" } },
      { name: "chatMessageId", label: "Message", type: "select", dynamic: "teams_messages", required: true, placeholder: "Select a message", dependsOn: "chatId", visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "chatMessageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "manual" } },
      { name: "reactionType", label: "Reaction", type: "select", required: true, options: [
        { value: "like", label: "👍 Like" },
        { value: "heart", label: "❤️ Heart" },
        { value: "laugh", label: "😂 Laugh" },
        { value: "surprised", label: "😮 Surprised" },
        { value: "sad", label: "😢 Sad" },
        { value: "angry", label: "😠 Angry" }
      ] }
    ],
    outputSchema: [
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the reaction was added successfully" },
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the message" },
      { name: "reactionType", label: "Reaction Type", type: "string", description: "The type of reaction added" }
    ]
  },
  {
    type: "teams_action_remove_reaction",
    title: "Remove Reaction from Message",
    description: "Remove your emoji reaction(s) from a message",
    icon: Smile,
    providerId: "teams",
    requiredScopes: ["ChannelMessage.Send"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "messageType", label: "Message Type", type: "select", required: true, defaultValue: "channel", options: [
        { value: "channel", label: "Channel Message" },
        { value: "chat", label: "Chat Message" }
      ] },
      { name: "teamId", label: "Team", type: "select", dynamic: "teams_teams", required: true, placeholder: "Select a team", loadOnMount: true, visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "channelId", label: "Channel", type: "select", dynamic: "teams_channels", required: true, placeholder: "Select a channel", dependsOn: "teamId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "chatId", label: "Chat", type: "select", dynamic: "teams_chats", required: true, placeholder: "Select a chat", dependsOn: "messageType", visibilityCondition: { field: "messageType", operator: "equals", value: "chat" } },
      // Message selection method - channel messages
      { name: "channelMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], dependsOn: "channelId", visibilityCondition: { field: "messageType", operator: "equals", value: "channel" } },
      { name: "messageId", label: "Message", type: "select", dynamic: "teams_messages", required: true, placeholder: "Select a message", dependsOn: "channelId", visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "messageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "channelMessageSelection", operator: "equals", value: "manual" } },
      // Message selection method - chat messages
      { name: "chatMessageSelection", label: "Select Message By", type: "select", required: true, defaultValue: "dropdown", options: [
        { value: "dropdown", label: "Choose from list" },
        { value: "manual", label: "Enter Message ID" }
      ], visibilityCondition: { field: "chatId", operator: "isNotEmpty" } },
      { name: "chatMessageId", label: "Message", type: "select", dynamic: "teams_messages", required: true, placeholder: "Select a message", dependsOn: "chatId", visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "dropdown" } },
      { name: "chatMessageIdManual", label: "Message ID", type: "text", required: true, placeholder: "Enter the message ID", supportsAI: true, visibilityCondition: { field: "chatMessageSelection", operator: "equals", value: "manual" } }
    ],
    outputSchema: [
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the reaction was removed successfully" },
      { name: "messageId", label: "Message ID", type: "string", description: "The ID of the message" },
      { name: "removedReactions", label: "Removed Reactions", type: "array", description: "The reactions that were removed" }
    ]
  },
  // Meeting Controls
  {
    type: "teams_action_end_meeting",
    title: "Cancel Online Meeting",
    description: "Cancel a scheduled meeting and notify attendees",
    icon: Square,
    providerId: "teams",
    requiredScopes: ["Calendars.ReadWrite"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "meetingId", label: "Meeting", type: "select", dynamic: "teams_online_meetings", required: true, placeholder: "Select a meeting to cancel", loadOnMount: true }
    ],
    outputSchema: [
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the meeting was cancelled successfully" },
      { name: "meetingId", label: "Meeting ID", type: "string", description: "The ID of the cancelled meeting" },
      { name: "subject", label: "Subject", type: "string", description: "The subject of the cancelled meeting" },
      { name: "message", label: "Message", type: "string", description: "Confirmation message" }
    ]
  },
  {
    type: "teams_action_update_meeting",
    title: "Update Meeting",
    description: "Update meeting subject, start time, or end time",
    icon: Edit,
    providerId: "teams",
    requiredScopes: ["Calendars.ReadWrite"],
    category: "Communication",
    isTrigger: false,
    configSchema: [
      { name: "meetingId", label: "Meeting", type: "select", dynamic: "teams_online_meetings", required: true, placeholder: "Select a meeting to update", loadOnMount: true },
      { name: "subject", label: "New Subject", type: "text", required: false, placeholder: "Enter new meeting subject (optional)", dependsOn: "meetingId", visibilityCondition: { field: "meetingId", operator: "isNotEmpty" }, supportsAI: true },
      { name: "startDateTime", label: "New Start Time", type: "datetime-local", required: false, placeholder: "Change start time (optional)", dependsOn: "meetingId", visibilityCondition: { field: "meetingId", operator: "isNotEmpty" } },
      { name: "endDateTime", label: "New End Time", type: "datetime-local", required: false, placeholder: "Change end time (optional)", dependsOn: "meetingId", visibilityCondition: { field: "meetingId", operator: "isNotEmpty" } }
    ],
    outputSchema: [
      { name: "meetingId", label: "Meeting ID", type: "string", description: "The ID of the meeting" },
      { name: "subject", label: "Subject", type: "string", description: "The updated meeting subject" },
      { name: "startDateTime", label: "Start Time", type: "string", description: "The updated start time" },
      { name: "endDateTime", label: "End Time", type: "string", description: "The updated end time" },
      { name: "joinUrl", label: "Join URL", type: "string", description: "The Teams meeting join URL" },
      { name: "success", label: "Success Status", type: "boolean", description: "Whether the meeting was updated successfully" }
    ]
  },
]