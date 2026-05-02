import { NodeComponent } from "../../../types"

const SLACK_INVITE_USERS_METADATA = {
  key: "slack_action_invite_users_to_channel",
  name: "Invite Users to Channel",
  description: "Invite one or more users to a channel"
}

export const inviteUsersToChannelActionSchema: NodeComponent = {
  type: SLACK_INVITE_USERS_METADATA.key,
  title: SLACK_INVITE_USERS_METADATA.name,
  description: SLACK_INVITE_USERS_METADATA.description,
  icon: "UserPlus" as any, // Will be resolved in index file
  providerId: "slack",
  requiredScopes: ["channels:write", "groups:write"],
  category: "Communication",
  isTrigger: false,
  configSchema: [
    // Workspace field - always visible first
    {
      name: "workspace",
      label: "Workspace",
      type: "select",
      dynamic: "slack_workspaces",
      required: true,
      loadOnMount: true,
      placeholder: "Select Slack workspace",
      description: "Your Slack workspace (used for authentication)"
    },
    // Option to use user token instead of bot token
    {
      name: "asUser",
      label: "Execute as User",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Execute this action as yourself instead of the Chain React bot. Requires reconnecting Slack with user permissions.",
      dependsOn: "workspace",
      hidden: {
        $deps: ["workspace"],
        $condition: { workspace: { $exists: false } }
      }
    },
    // Channel field - cascaded from workspace
    {
      name: "channel",
      label: "Channel",
      type: "combobox",
      required: true,
      dynamic: "slack_channels",
      loadOnMount: true,
      searchable: true,
      placeholder: "Select a channel",
      tooltip: "Select the channel to invite users to. Works with both public and private channels (if bot is a member).",
      dependsOn: "workspace",
      hidden: {
        $deps: ["workspace"],
        $condition: { workspace: { $exists: false } }
      }
    },

    // Users field - cascaded from channel
    {
      name: "users",
      label: "Users",
      type: "multi-select",
      required: true,
      dynamic: "slack_users",
      loadOnMount: true,
      searchable: true,
      placeholder: "Select users to invite",
      tooltip: "Select one or more users to invite to the channel. You can search by name or email. Maximum 1000 users per invitation.",
      dependsOn: "channel",
      hidden: {
        $deps: ["channel"],
        $condition: { channel: { $exists: false } }
      }
    },
    {
      name: "sendInviteNotification",
      label: "Send Invite Notification",
      type: "boolean",
      required: true,
      description: "Required (Q11). Recommended: false — invitations contact real users on every workflow run.",
      tooltip: "When enabled, invited users will receive a notification about being added to the channel. Disable for silent additions.",
      dependsOn: "channel",
      hidden: {
        $deps: ["channel"],
        $condition: { channel: { $exists: false } }
      }
    },
    {
      name: "customWelcomeMessage",
      label: "Welcome Message (Optional)",
      type: "slack-rich-text",
      required: false,
      placeholder: "Welcome to the channel! Here's what this space is for...",
      tooltip: "Optional: Send a custom welcome message to the channel after users are invited. Use the toolbar for rich formatting (bold, italic, links, emojis, etc.). Leave empty for no message.",
      dependsOn: "channel",
      hidden: {
        $deps: ["channel"],
        $condition: { channel: { $exists: false } }
      }
    }
  ],
  outputSchema: [
    {
      name: "success",
      label: "Success",
      type: "boolean",
      description: "Whether the invitation was successful"
    },
    {
      name: "channelId",
      label: "Channel ID",
      type: "string",
      description: "The ID of the channel users were invited to",
      example: "C1234567890"
    },
    {
      name: "channelName",
      label: "Channel Name",
      type: "string",
      description: "The name of the channel",
      example: "general"
    },
    {
      name: "invitedUsers",
      label: "Invited Users",
      type: "array",
      description: "Array of user IDs that were successfully invited",
      example: ["U1234567890", "U0987654321"]
    },
    {
      name: "invitedCount",
      label: "Invited Count",
      type: "number",
      description: "Number of users successfully invited",
      example: 2
    },
    {
      name: "failedUsers",
      label: "Failed Users",
      type: "array",
      description: "Array of user IDs that could not be invited (already members, deactivated, etc.)",
      example: []
    },
    {
      name: "alreadyInChannel",
      label: "Already in Channel",
      type: "array",
      description: "Array of user IDs that were already members of the channel",
      example: []
    }
  ]
}
