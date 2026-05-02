import { NodeComponent } from "../../../types"

const SLACK_CREATE_CHANNEL_METADATA = {
  key: "slack_action_create_channel",
  name: "Create Channel",
  description: "Create a new Slack channel"
}

export const createChannelActionSchema: NodeComponent = {
  type: SLACK_CREATE_CHANNEL_METADATA.key,
  title: SLACK_CREATE_CHANNEL_METADATA.name,
  description: SLACK_CREATE_CHANNEL_METADATA.description,
  icon: "Hash" as any, // Will be resolved in index file
  providerId: "slack",
  requiredScopes: ["groups:write", "users:read"],
  category: "Communication",
  isTrigger: false,
  configSchema: [
    {
      name: "channelName",
      label: "Channel Name",
      type: "text",
      required: true,
      placeholder: "e.g. plan-budget",
      tooltip: "Enter a channel name (lowercase, no spaces, hyphens allowed)."
    },
    {
      name: "visibility",
      label: "Visibility",
      type: "select",
      required: true,
      description: "Required (Q11). Recommended: Private — public channels are discoverable by the entire workspace.",
      options: [
        { value: "public", label: "Public" },
        { value: "private", label: "Private" }
      ],
      tooltip: "Choose whether the channel is public or private."
    },
    {
      name: "description",
      label: "Description (Optional)",
      type: "textarea",
      required: false,
      rows: 2,
      placeholder: "Brief description of what this channel is for",
      tooltip: "Set the channel's topic/description that appears under the channel name."
    },
    {
      name: "addPeople",
      label: "Add People (Optional)",
      type: "multi-select",
      required: false,
      dynamic: "slack_users",
      loadOnMount: true,
      searchable: true,
      placeholder: "Search by name or email",
      tooltip: "Add people to the channel when it's created. You can add more later.",
      supportsAI: true
    }
  ],
  outputSchema: [
    {
      name: "channelId",
      label: "Channel ID",
      type: "string",
      description: "The unique ID of the created channel"
    },
    {
      name: "channelName",
      label: "Channel Name",
      type: "string",
      description: "The name of the created channel"
    },
    {
      name: "isPrivate",
      label: "Is Private",
      type: "boolean",
      description: "Whether the channel is private"
    }
  ]
}
