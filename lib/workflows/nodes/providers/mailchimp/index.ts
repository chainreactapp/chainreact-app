import { Users, MailOpen, UserPlus, Mail, UserX, Tag, List, Search, BarChart, Calendar, User, FileText, UserMinus, StickyNote, Filter, MousePointer, UserCheck, Send, ListPlus, Zap } from "lucide-react"
import { NodeComponent } from "../../types"

// Import new action schemas
import { getCampaignStatsActionSchema } from "./actions/getCampaignStats.schema"
import { scheduleCampaignActionSchema } from "./actions/scheduleCampaign.schema"
import { getSubscriberActionSchema } from "./actions/getSubscriber.schema"
import { getCampaignActionSchema } from "./actions/getCampaign.schema"
import { unsubscribeSubscriberActionSchema } from "./actions/unsubscribeSubscriber.schema"
import { addNoteActionSchema } from "./actions/addNote.schema"
import { createSegmentActionSchema } from "./actions/createSegment.schema"

// Apply icons to new action schemas
const getCampaignStats: NodeComponent = {
  ...getCampaignStatsActionSchema,
  icon: BarChart
}

const scheduleCampaign: NodeComponent = {
  ...scheduleCampaignActionSchema,
  icon: Calendar
}

const getSubscriber: NodeComponent = {
  ...getSubscriberActionSchema,
  icon: User
}

const getCampaign: NodeComponent = {
  ...getCampaignActionSchema,
  icon: FileText
}

const unsubscribeSubscriber: NodeComponent = {
  ...unsubscribeSubscriberActionSchema,
  icon: UserMinus
}

const addNote: NodeComponent = {
  ...addNoteActionSchema,
  icon: StickyNote
}

const createSegment: NodeComponent = {
  ...createSegmentActionSchema,
  icon: Filter
}

export const mailchimpNodes: NodeComponent[] = [
  // Triggers
  {
    type: "mailchimp_trigger_new_subscriber",
    title: "New Subscriber Added",
    description: "Triggers when a new subscriber is added to an audience",
    icon: Users,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      {
        name: "audienceId",
        label: "Audience",
        type: "combobox",
        required: true,
        dynamic: "mailchimp_audiences",
        loadOnMount: true,
        placeholder: "Select an audience",
        description: "Choose which Mailchimp audience to monitor for new subscribers"
      }
    ],
    outputSchema: [
      {
        name: "email",
        label: "Email Address",
        type: "string",
        description: "Email address of the new subscriber"
      },
      {
        name: "firstName",
        label: "First Name",
        type: "string",
        description: "Subscriber's first name"
      },
      {
        name: "lastName",
        label: "Last Name",
        type: "string",
        description: "Subscriber's last name"
      },
      {
        name: "status",
        label: "Subscription Status",
        type: "string",
        description: "Current subscription status (subscribed, unsubscribed, pending, etc.)"
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "The ID of the audience the subscriber joined"
      },
      {
        name: "subscriberId",
        label: "Subscriber ID",
        type: "string",
        description: "Unique identifier for the subscriber"
      },
      {
        name: "tags",
        label: "Tags",
        type: "array",
        description: "Tags assigned to this subscriber"
      },
      {
        name: "source",
        label: "Subscription Source",
        type: "string",
        description: "How the subscriber joined (e.g., API, signup form, import)"
      },
      {
        name: "timestamp",
        label: "Timestamp",
        type: "string",
        description: "ISO timestamp when the subscriber was added"
      }
    ]
  },
  {
    type: "mailchimp_trigger_email_opened",
    title: "Email Campaign Opened",
    description: "Triggers when a subscriber opens an email campaign",
    icon: MailOpen,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    triggerType: "polling",
    producesOutput: true,
    configSchema: [
      {
        name: "campaignId",
        label: "Campaign (Optional)",
        type: "combobox",
        required: false,
        dynamic: "mailchimp_campaigns",
        loadOnMount: true,
        placeholder: "All campaigns",
        description: "Monitor a specific campaign, or leave empty to monitor all campaigns"
      }
    ],
    outputSchema: [
      {
        name: "email",
        label: "Subscriber Email",
        type: "string",
        description: "Email address of the subscriber who opened the campaign"
      },
      {
        name: "campaignId",
        label: "Campaign ID",
        type: "string",
        description: "Unique identifier for the email campaign"
      },
      {
        name: "campaignTitle",
        label: "Campaign Title",
        type: "string",
        description: "Title/subject of the email campaign"
      },
      {
        name: "openTime",
        label: "Open Time",
        type: "string",
        description: "ISO timestamp when the email was opened"
      },
      {
        name: "subscriberId",
        label: "Subscriber ID",
        type: "string",
        description: "Unique identifier for the subscriber"
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "The ID of the audience the subscriber belongs to"
      },
      {
        name: "ipAddress",
        label: "IP Address",
        type: "string",
        description: "IP address from which the email was opened"
      },
      {
        name: "userAgent",
        label: "User Agent",
        type: "string",
        description: "Browser/email client information"
      },
      {
        name: "location",
        label: "Location",
        type: "object",
        description: "Geographic location data (city, country, timezone)"
      }
    ]
  },
  {
    type: "mailchimp_trigger_link_clicked",
    title: "Link Clicked in Campaign",
    description: "Triggers when a recipient clicks a link in an email campaign",
    icon: MousePointer,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    triggerType: "polling",
    producesOutput: true,
    configSchema: [
      {
        name: "campaignId",
        label: "Campaign (Optional)",
        type: "combobox",
        required: false,
        dynamic: "mailchimp_campaigns",
        loadOnMount: true,
        placeholder: "All campaigns",
        description: "Monitor a specific campaign, or leave empty to monitor all campaigns"
      },
      {
        name: "url",
        label: "Specific URL (Optional)",
        type: "text",
        required: false,
        placeholder: "https://example.com/page",
        description: "Only trigger for clicks on a specific URL, or leave empty for all clicks"
      }
    ],
    outputSchema: [
      {
        name: "email",
        label: "Subscriber Email",
        type: "string",
        description: "Email address of the subscriber who clicked the link"
      },
      {
        name: "url",
        label: "Clicked URL",
        type: "string",
        description: "The URL that was clicked"
      },
      {
        name: "campaignId",
        label: "Campaign ID",
        type: "string",
        description: "Unique identifier for the email campaign"
      },
      {
        name: "campaignTitle",
        label: "Campaign Title",
        type: "string",
        description: "Title/subject of the email campaign"
      },
      {
        name: "clickTime",
        label: "Click Time",
        type: "string",
        description: "ISO timestamp when the link was clicked"
      },
      {
        name: "subscriberId",
        label: "Subscriber ID",
        type: "string",
        description: "Unique identifier for the subscriber"
      },
      {
        name: "ipAddress",
        label: "IP Address",
        type: "string",
        description: "IP address from which the link was clicked"
      },
      {
        name: "location",
        label: "Location",
        type: "object",
        description: "Geographic location data (city, country, timezone)"
      }
    ]
  },
  {
    type: "mailchimp_trigger_unsubscribed",
    title: "New Unsubscriber",
    description: "Triggers when a subscriber unsubscribes from an audience",
    icon: UserX,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      {
        name: "audienceId",
        label: "Audience",
        type: "combobox",
        required: true,
        dynamic: "mailchimp_audiences",
        loadOnMount: true,
        placeholder: "Select an audience",
        description: "Choose which Mailchimp audience to monitor for unsubscribes"
      }
    ],
    outputSchema: [
      {
        name: "email",
        label: "Email Address",
        type: "string",
        description: "Email address of the unsubscribed subscriber"
      },
      {
        name: "firstName",
        label: "First Name",
        type: "string",
        description: "Subscriber's first name"
      },
      {
        name: "lastName",
        label: "Last Name",
        type: "string",
        description: "Subscriber's last name"
      },
      {
        name: "reason",
        label: "Unsubscribe Reason",
        type: "string",
        description: "Reason for unsubscribing (if provided)"
      },
      {
        name: "campaignId",
        label: "Campaign ID",
        type: "string",
        description: "Campaign that triggered the unsubscribe (if applicable)"
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "The ID of the audience they unsubscribed from"
      },
      {
        name: "subscriberId",
        label: "Subscriber ID",
        type: "string",
        description: "Unique identifier for the subscriber"
      },
      {
        name: "timestamp",
        label: "Timestamp",
        type: "string",
        description: "ISO timestamp when they unsubscribed"
      }
    ]
  },
  {
    type: "mailchimp_trigger_new_campaign",
    title: "Campaign Sent",
    description: "Triggers when a campaign is sent to an audience",
    icon: Send,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      {
        name: "audienceId",
        label: "Audience",
        type: "combobox",
        required: true,
        dynamic: "mailchimp_audiences",
        loadOnMount: true,
        placeholder: "Select an audience",
        description: "Choose which Mailchimp audience to monitor for campaign sends"
      }
    ],
    outputSchema: [
      {
        name: "campaignId",
        label: "Campaign ID",
        type: "string",
        description: "Unique identifier for the campaign"
      },
      {
        name: "title",
        label: "Campaign Title",
        type: "string",
        description: "Title/name of the campaign"
      },
      {
        name: "subject",
        label: "Subject Line",
        type: "string",
        description: "Email subject line"
      },
      {
        name: "type",
        label: "Campaign Type",
        type: "string",
        description: "Type of campaign (regular, plaintext, etc.)"
      },
      {
        name: "status",
        label: "Status",
        type: "string",
        description: "Campaign status"
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "The audience this campaign was sent to"
      },
      {
        name: "sendTime",
        label: "Send Time",
        type: "string",
        description: "When the campaign was sent"
      },
      {
        name: "createTime",
        label: "Create Time",
        type: "string",
        description: "When the campaign was created"
      },
      {
        name: "fromName",
        label: "From Name",
        type: "string",
        description: "Sender name"
      },
      {
        name: "replyTo",
        label: "Reply To",
        type: "string",
        description: "Reply-to email address"
      }
    ]
  },
  {
    type: "mailchimp_trigger_campaign_created",
    title: "New Campaign",
    description: "Triggers when a new campaign is created (draft, scheduled, or sent)",
    icon: Send,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    triggerType: "polling",
    producesOutput: true,
    configSchema: [
      {
        name: "audienceId",
        label: "Audience",
        type: "combobox",
        required: false,
        dynamic: "mailchimp_audiences",
        loadOnMount: true,
        placeholder: "All audiences",
        description: "Optionally filter to a specific audience"
      },
      {
        name: "status",
        label: "Campaign Status",
        type: "select",
        required: false,
        defaultValue: "all",
        options: [
          { value: "all", label: "All Campaigns" },
          { value: "sent", label: "Sent Campaigns Only" },
          { value: "save", label: "Saved Drafts Only" }
        ],
        description: "Filter which campaign statuses to detect"
      }
    ],
    outputSchema: [
      {
        name: "campaignId",
        label: "Campaign ID",
        type: "string",
        description: "Unique identifier for the campaign"
      },
      {
        name: "title",
        label: "Campaign Title",
        type: "string",
        description: "Title/name of the campaign"
      },
      {
        name: "subject",
        label: "Subject Line",
        type: "string",
        description: "Email subject line"
      },
      {
        name: "type",
        label: "Campaign Type",
        type: "string",
        description: "Type of campaign (regular, plaintext, etc.)"
      },
      {
        name: "status",
        label: "Status",
        type: "string",
        description: "Campaign status (save, sent, schedule, etc.)"
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "The audience associated with this campaign"
      },
      {
        name: "sendTime",
        label: "Send Time",
        type: "string",
        description: "When the campaign was sent (if applicable)"
      },
      {
        name: "createTime",
        label: "Create Time",
        type: "string",
        description: "When the campaign was created"
      },
      {
        name: "fromName",
        label: "From Name",
        type: "string",
        description: "Sender name"
      },
      {
        name: "replyTo",
        label: "Reply To",
        type: "string",
        description: "Reply-to email address"
      }
    ]
  },
  {
    type: "mailchimp_trigger_subscriber_added_to_segment",
    title: "Subscriber Tagged",
    description: "Triggers when a subscriber is tagged within an audience",
    icon: UserCheck,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    triggerType: "polling",
    producesOutput: true,
    configSchema: [
      {
        name: "audienceId",
        label: "Audience",
        type: "combobox",
        required: true,
        dynamic: "mailchimp_audiences",
        loadOnMount: true,
        placeholder: "Select an audience",
        description: "Choose which Mailchimp audience to monitor"
      },
      {
        name: "segmentId",
        label: "Tag (Optional)",
        type: "combobox",
        required: false,
        dynamic: "mailchimp_tag_segments",
        dependsOn: "audienceId",
        placeholder: "All tags",
        description: "Monitor a specific tag, or leave empty to monitor all tags"
      }
    ],
    outputSchema: [
      {
        name: "email",
        label: "Email Address",
        type: "string",
        description: "Email address of the subscriber"
      },
      {
        name: "firstName",
        label: "First Name",
        type: "string",
        description: "Subscriber's first name"
      },
      {
        name: "lastName",
        label: "Last Name",
        type: "string",
        description: "Subscriber's last name"
      },
      {
        name: "segmentId",
        label: "Segment ID",
        type: "string",
        description: "ID of the segment they joined (if applicable)"
      },
      {
        name: "segmentName",
        label: "Segment Name",
        type: "string",
        description: "Name of the segment they joined"
      },
      {
        name: "tagName",
        label: "Tag Name",
        type: "string",
        description: "Name of the tag they were assigned"
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "The ID of the audience"
      },
      {
        name: "subscriberId",
        label: "Subscriber ID",
        type: "string",
        description: "Unique identifier for the subscriber"
      },
      {
        name: "timestamp",
        label: "Timestamp",
        type: "string",
        description: "ISO timestamp when they were added to the segment/tag"
      }
    ]
  },
  {
    type: "mailchimp_trigger_subscriber_updated",
    title: "New or Updated Subscriber",
    description: "Triggers when a subscriber is added or updated in an audience",
    icon: Users,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    producesOutput: true,
    configSchema: [
      {
        name: "audienceId",
        label: "Audience",
        type: "combobox",
        required: true,
        dynamic: "mailchimp_audiences",
        loadOnMount: true,
        placeholder: "Select an audience",
        description: "Choose which Mailchimp audience to monitor"
      },
      {
        name: "eventType",
        label: "Event Type",
        type: "select",
        required: false,
        defaultValue: "both",
        options: [
          { value: "both", label: "New and Updated" },
          { value: "new", label: "New Subscribers Only" },
          { value: "updated", label: "Updates Only" }
        ],
        description: "Filter by event type"
      }
    ],
    outputSchema: [
      {
        name: "email",
        label: "Email Address",
        type: "string",
        description: "Email address of the subscriber"
      },
      {
        name: "firstName",
        label: "First Name",
        type: "string",
        description: "Subscriber's first name"
      },
      {
        name: "lastName",
        label: "Last Name",
        type: "string",
        description: "Subscriber's last name"
      },
      {
        name: "status",
        label: "Subscription Status",
        type: "string",
        description: "Current subscription status"
      },
      {
        name: "eventType",
        label: "Event Type",
        type: "string",
        description: "Whether this was a 'new' subscriber or an 'update'"
      },
      {
        name: "changedFields",
        label: "Changed Fields",
        type: "array",
        description: "List of fields that were updated (for update events)"
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "The ID of the audience"
      },
      {
        name: "subscriberId",
        label: "Subscriber ID",
        type: "string",
        description: "Unique identifier for the subscriber"
      },
      {
        name: "tags",
        label: "Tags",
        type: "array",
        description: "Tags assigned to this subscriber"
      },
      {
        name: "timestamp",
        label: "Timestamp",
        type: "string",
        description: "ISO timestamp of the event"
      }
    ]
  },
  {
    type: "mailchimp_trigger_segment_updated",
    title: "Segment Created or Updated",
    description: "Triggers when a segment is created or updated in an audience",
    icon: Filter,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    triggerType: "polling",
    producesOutput: true,
    configSchema: [
      {
        name: "audienceId",
        label: "Audience",
        type: "combobox",
        required: true,
        dynamic: "mailchimp_audiences",
        loadOnMount: true,
        placeholder: "Select an audience",
        description: "Choose which Mailchimp audience to monitor for segment changes"
      },
      {
        name: "eventType",
        label: "Event Type",
        type: "select",
        required: false,
        defaultValue: "both",
        options: [
          { value: "both", label: "Created and Updated" },
          { value: "created", label: "Created Only" },
          { value: "updated", label: "Updated Only" }
        ],
        description: "Filter by event type"
      }
    ],
    outputSchema: [
      {
        name: "segmentId",
        label: "Segment ID",
        type: "string",
        description: "Unique identifier for the segment"
      },
      {
        name: "segmentName",
        label: "Segment Name",
        type: "string",
        description: "Name of the segment"
      },
      {
        name: "segmentType",
        label: "Segment Type",
        type: "string",
        description: "Type of segment (static, saved, etc.)"
      },
      {
        name: "memberCount",
        label: "Member Count",
        type: "number",
        description: "Number of members in the segment"
      },
      {
        name: "eventType",
        label: "Event Type",
        type: "string",
        description: "Whether this segment was 'created' or 'updated'"
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "The ID of the audience this segment belongs to"
      },
      {
        name: "createdAt",
        label: "Created At",
        type: "string",
        description: "When the segment was created"
      },
      {
        name: "updatedAt",
        label: "Updated At",
        type: "string",
        description: "When the segment was last updated"
      }
    ]
  },
  {
    type: "mailchimp_trigger_new_audience",
    title: "New Audience Created",
    description: "Triggers when a new audience (list) is created in your Mailchimp account",
    icon: ListPlus,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: true,
    triggerType: "polling",
    producesOutput: true,
    configSchema: [],
    outputSchema: [
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "Unique identifier for the new audience"
      },
      {
        name: "name",
        label: "Audience Name",
        type: "string",
        description: "Name of the new audience"
      },
      {
        name: "webId",
        label: "Web ID",
        type: "number",
        description: "Web-based ID for the audience"
      },
      {
        name: "permissionReminder",
        label: "Permission Reminder",
        type: "string",
        description: "Permission reminder text"
      },
      {
        name: "company",
        label: "Company",
        type: "string",
        description: "Company name"
      },
      {
        name: "contactAddress",
        label: "Contact Address",
        type: "object",
        description: "Contact address information"
      },
      {
        name: "campaignDefaults",
        label: "Campaign Defaults",
        type: "object",
        description: "Default campaign settings (from_name, from_email, subject, language)"
      },
      {
        name: "memberCount",
        label: "Member Count",
        type: "number",
        description: "Number of members in the audience (typically 0 for new)"
      },
      {
        name: "dateCreated",
        label: "Date Created",
        type: "string",
        description: "ISO timestamp when the audience was created"
      }
    ]
  },

  // Actions
  {
    type: "mailchimp_action_add_subscriber",
    title: "Add Subscriber",
    description: "Add a new subscriber to an audience",
    icon: UserPlus,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "audience_id",
        label: "Audience",
        type: "select",
        required: true,
        dynamic: "mailchimp_audiences",
        placeholder: "Select an audience",
        loadOnMount: true
      },
      {
        name: "email",
        label: "Email Address",
        type: "email",
        required: true,
        placeholder: "subscriber@example.com",
        supportsAI: true
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        required: true,
        description: "Required (Q11). Recommended: \"Pending\" — triggers a confirmation email so the subscriber's consent is recorded (CAN-SPAM / GDPR). Use \"Subscribed\" only when explicit prior consent is already captured.",
        options: [
          { value: "subscribed", label: "Subscribed" },
          { value: "pending", label: "Pending (Double Opt-in)" },
          { value: "unsubscribed", label: "Unsubscribed" },
          { value: "transactional", label: "Transactional" }
        ]
      },
      {
        name: "first_name",
        label: "First Name",
        type: "text",
        required: false,
        placeholder: "John",
        supportsAI: true
      },
      {
        name: "last_name",
        label: "Last Name",
        type: "text",
        required: false,
        placeholder: "Doe",
        supportsAI: true
      },
      {
        name: "phone",
        label: "Phone Number",
        type: "text",
        required: false,
        placeholder: "+1234567890",
        supportsAI: true
      },
      {
        name: "address",
        label: "Address",
        type: "text",
        required: false,
        placeholder: "123 Main St",
        supportsAI: true
      },
      {
        name: "city",
        label: "City",
        type: "text",
        required: false,
        placeholder: "New York",
        supportsAI: true
      },
      {
        name: "state",
        label: "State/Province",
        type: "text",
        required: false,
        placeholder: "NY",
        supportsAI: true
      },
      {
        name: "zip",
        label: "Zip/Postal Code",
        type: "text",
        required: false,
        placeholder: "10001",
        supportsAI: true
      },
      {
        name: "country",
        label: "Country",
        type: "text",
        required: false,
        placeholder: "US",
        supportsAI: true
      },
      {
        name: "tags",
        label: "Tags (Optional)",
        type: "text",
        required: false,
        placeholder: "customer, vip, newsletter (comma-separated)",
        description: "Add tags to categorize this subscriber (separate with commas)",
        supportsAI: true
      }
    ]
  },
  {
    type: "mailchimp_action_update_subscriber",
    title: "Update Subscriber",
    description: "Update an existing subscriber's information",
    icon: Users,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "audience_id",
        label: "Audience",
        type: "select",
        required: true,
        dynamic: "mailchimp_audiences",
        placeholder: "Select an audience",
        loadOnMount: true
      },
      {
        name: "subscriber_email",
        label: "Select Subscriber",
        type: "select",
        required: true,
        dynamic: "mailchimp_subscribers",
        dependsOn: "audience_id",
        placeholder: "Search for subscriber by email...",
        description: "Select the subscriber you want to update",
        searchable: true
      },
      {
        name: "new_email",
        label: "New Email Address (optional)",
        type: "email",
        required: false,
        placeholder: "newemail@example.com",
        description: "Leave empty to keep current email",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "status",
        label: "Status (Optional)",
        type: "select",
        required: false,
        options: [
          { value: "subscribed", label: "Subscribed" },
          { value: "pending", label: "Pending" },
          { value: "unsubscribed", label: "Unsubscribed" },
          { value: "transactional", label: "Transactional" }
        ],
        placeholder: "Keep current status",
        description: "Leave empty to keep current status",
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "first_name",
        label: "First Name (Optional)",
        type: "text",
        required: false,
        placeholder: "Leave empty to keep current value",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "last_name",
        label: "Last Name (Optional)",
        type: "text",
        required: false,
        placeholder: "Leave empty to keep current value",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "phone",
        label: "Phone Number (Optional)",
        type: "text",
        required: false,
        placeholder: "Leave empty to keep current value",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "address",
        label: "Address (Optional)",
        type: "text",
        required: false,
        placeholder: "Leave empty to keep current value",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "city",
        label: "City (Optional)",
        type: "text",
        required: false,
        placeholder: "Leave empty to keep current value",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "state",
        label: "State/Province (Optional)",
        type: "text",
        required: false,
        placeholder: "Leave empty to keep current value",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "zip",
        label: "Zip/Postal Code (Optional)",
        type: "text",
        required: false,
        placeholder: "Leave empty to keep current value",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      },
      {
        name: "country",
        label: "Country (Optional)",
        type: "text",
        required: false,
        placeholder: "Leave empty to keep current value",
        supportsAI: true,
        dependsOn: "subscriber_email",
        hidden: {
          $deps: ["subscriber_email"],
          $condition: { subscriber_email: { $exists: false } }
        }
      }
    ]
  },
  {
    type: "mailchimp_action_remove_subscriber",
    title: "Remove Subscriber",
    description: "Remove a subscriber from an audience",
    icon: UserX,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "audience_id",
        label: "Audience",
        type: "select",
        required: true,
        dynamic: "mailchimp_audiences",
        placeholder: "Select an audience",
        loadOnMount: true
      },
      {
        name: "email",
        label: "Email Address",
        type: "email",
        required: true,
        placeholder: "subscriber@example.com",
        supportsAI: true
      },
      {
        name: "delete_permanently",
        label: "Delete Permanently",
        type: "boolean",
        required: false,
        defaultValue: false,
        description: "If enabled, permanently delete the subscriber. Otherwise, just unsubscribe them."
      }
    ]
  },
  {
    type: "mailchimp_action_add_tag",
    title: "Add Tag to Subscriber",
    description: "Add tags to a subscriber",
    icon: Tag,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "audience_id",
        label: "Audience",
        type: "select",
        required: true,
        dynamic: "mailchimp_audiences",
        placeholder: "Select an audience",
        loadOnMount: true
      },
      {
        name: "email",
        label: "Email Address",
        type: "email",
        required: true,
        placeholder: "subscriber@example.com",
        supportsAI: true
      },
      {
        name: "tags",
        label: "Tags to Add",
        type: "multiselect",
        required: true,
        dynamic: "mailchimp_tags",
        dependsOn: "audience_id",
        creatable: true,
        placeholder: "Select existing tags or type to create new ones",
        description: "Tags will be created if they don't exist"
      }
    ]
  },
  {
    type: "mailchimp_action_remove_tag",
    title: "Remove Tag from Subscriber",
    description: "Remove tags from a subscriber",
    icon: Tag,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "audience_id",
        label: "Audience",
        type: "select",
        required: true,
        dynamic: "mailchimp_audiences",
        placeholder: "Select an audience",
        loadOnMount: true
      },
      {
        name: "email",
        label: "Email Address",
        type: "email",
        required: true,
        placeholder: "subscriber@example.com",
        supportsAI: true
      },
      {
        name: "tags",
        label: "Tags to Remove",
        type: "multiselect",
        required: true,
        dynamic: "mailchimp_tags",
        dependsOn: "audience_id",
        placeholder: "Select tags to remove"
      }
    ]
  },
  {
    type: "mailchimp_action_send_campaign",
    title: "Send Campaign",
    description: "Send an email campaign",
    icon: Mail,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "campaign_id",
        label: "Campaign",
        type: "select",
        required: true,
        dynamic: "mailchimp_campaigns",
        placeholder: "Select a campaign",
        loadOnMount: true,
        description: "Select a saved/draft campaign to send"
      }
    ]
  },
  {
    type: "mailchimp_action_create_campaign",
    title: "Create Campaign",
    description: "Create a new email campaign",
    icon: Mail,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "audience_id",
        label: "Audience",
        type: "select",
        required: true,
        dynamic: "mailchimp_audiences",
        placeholder: "Select an audience",
        loadOnMount: true
      },
      {
        name: "type",
        label: "Campaign Type",
        type: "select",
        required: true,
        defaultValue: "regular",
        options: [
          { value: "regular", label: "Regular" },
          { value: "plaintext", label: "Plain Text" },
          { value: "absplit", label: "A/B Split" },
          { value: "rss", label: "RSS" },
          { value: "variate", label: "Multivariate" }
        ]
      },
      {
        name: "subject_line",
        label: "Subject Line",
        type: "text",
        required: true,
        placeholder: "Your email subject",
        supportsAI: true
      },
      {
        name: "preview_text",
        label: "Preview Text",
        type: "text",
        required: false,
        placeholder: "Text shown in email preview",
        supportsAI: true
      },
      {
        name: "from_name",
        label: "From Name",
        type: "text",
        required: true,
        placeholder: "Your Company",
        supportsAI: true
      },
      {
        name: "reply_to",
        label: "Reply To Email",
        type: "email",
        required: true,
        placeholder: "reply@example.com",
        supportsAI: true
      },
      {
        name: "html_content",
        label: "HTML Content",
        type: "textarea",
        required: false,
        placeholder: "Your email HTML content",
        supportsAI: true
      },
      {
        name: "text_content",
        label: "Plain Text Content",
        type: "textarea",
        required: false,
        placeholder: "Your email plain text content",
        supportsAI: true
      }
    ]
  },
  {
    type: "mailchimp_action_get_subscribers",
    title: "Get Subscribers",
    description: "Retrieve subscribers from a Mailchimp audience with optional filtering",
    icon: Search,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "audience_id",
        label: "Audience",
        type: "select",
        required: true,
        dynamic: "mailchimp_audiences",
        placeholder: "Select an audience",
        loadOnMount: true
      },
      {
        name: "status",
        label: "Subscriber Status",
        type: "select",
        required: false,
        defaultValue: "subscribed",
        options: [
          { value: "subscribed", label: "Subscribed" },
          { value: "unsubscribed", label: "Unsubscribed" },
          { value: "cleaned", label: "Cleaned" },
          { value: "pending", label: "Pending" },
          { value: "transactional", label: "Transactional" }
        ]
      },
      {
        name: "limit",
        label: "Maximum Results",
        type: "number",
        required: false,
        defaultValue: 100,
        placeholder: "Number of subscribers to retrieve (max 1000)"
      },
      {
        name: "offset",
        label: "Offset (Optional)",
        type: "number",
        required: false,
        defaultValue: 0,
        placeholder: "Starting position for pagination",
        tooltip: "Skip this many subscribers before returning results. Use for pagination in combination with limit."
      }
    ],
    outputSchema: [
      {
        name: "subscribers",
        label: "Subscribers",
        type: "array",
        description: "Array of subscribers from the audience"
      },
      {
        name: "count",
        label: "Count",
        type: "number",
        description: "Number of subscribers retrieved"
      }
    ]
  },
  {
    type: "mailchimp_action_create_audience",
    title: "Create Audience",
    description: "Create a new Mailchimp audience (list)",
    icon: ListPlus,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "name",
        label: "Audience Name",
        type: "text",
        required: true,
        placeholder: "My New Audience",
        description: "Name for the new audience",
        supportsAI: true
      },
      {
        name: "permission_reminder",
        label: "Permission Reminder",
        type: "text",
        required: true,
        placeholder: "You signed up for updates on our website",
        description: "Reminder of how people signed up (required by anti-spam laws)",
        supportsAI: true
      },
      {
        name: "email_type_option",
        label: "Email Type Option",
        type: "boolean",
        required: false,
        defaultValue: false,
        description: "Whether the audience supports HTML and plain-text emails"
      },
      {
        name: "company",
        label: "Company Name",
        type: "text",
        required: true,
        placeholder: "Acme Corporation",
        description: "Your company or organization name",
        supportsAI: true
      },
      {
        name: "address1",
        label: "Address Line 1",
        type: "text",
        required: true,
        placeholder: "123 Main Street",
        description: "Street address (required by anti-spam laws)",
        supportsAI: true
      },
      {
        name: "address2",
        label: "Address Line 2",
        type: "text",
        required: false,
        placeholder: "Suite 100",
        supportsAI: true
      },
      {
        name: "city",
        label: "City",
        type: "text",
        required: true,
        placeholder: "San Francisco",
        supportsAI: true
      },
      {
        name: "state",
        label: "State/Province",
        type: "text",
        required: true,
        placeholder: "CA",
        supportsAI: true
      },
      {
        name: "zip",
        label: "Zip/Postal Code",
        type: "text",
        required: true,
        placeholder: "94102",
        supportsAI: true
      },
      {
        name: "country",
        label: "Country",
        type: "text",
        required: true,
        placeholder: "US",
        description: "Two-letter country code",
        supportsAI: true
      },
      {
        name: "from_name",
        label: "Default From Name",
        type: "text",
        required: true,
        placeholder: "Acme Team",
        description: "Default sender name for campaigns",
        supportsAI: true
      },
      {
        name: "from_email",
        label: "Default From Email",
        type: "email",
        required: true,
        placeholder: "hello@acme.com",
        description: "Default sender email for campaigns",
        supportsAI: true
      },
      {
        name: "subject",
        label: "Default Subject",
        type: "text",
        required: false,
        placeholder: "Newsletter from Acme",
        description: "Default email subject line",
        supportsAI: true
      },
      {
        name: "language",
        label: "Language",
        type: "text",
        required: false,
        defaultValue: "en",
        placeholder: "en",
        description: "Language code for the audience"
      }
    ],
    outputSchema: [
      {
        name: "audienceId",
        label: "Audience ID",
        type: "string",
        description: "Unique ID of the created audience"
      },
      {
        name: "name",
        label: "Audience Name",
        type: "string",
        description: "Name of the created audience"
      },
      {
        name: "webId",
        label: "Web ID",
        type: "number",
        description: "Web-based ID for the audience"
      },
      {
        name: "dateCreated",
        label: "Date Created",
        type: "string",
        description: "When the audience was created"
      }
    ]
  },
  {
    type: "mailchimp_action_create_event",
    title: "Create Custom Event",
    description: "Track a custom event for a subscriber",
    icon: Zap,
    providerId: "mailchimp",
    category: "Email",
    isTrigger: false,
    configSchema: [
      {
        name: "audience_id",
        label: "Audience",
        type: "select",
        required: true,
        dynamic: "mailchimp_audiences",
        placeholder: "Select an audience",
        loadOnMount: true
      },
      {
        name: "email",
        label: "Subscriber Email",
        type: "email",
        required: true,
        placeholder: "subscriber@example.com",
        description: "Email address of the subscriber",
        supportsAI: true
      },
      {
        name: "event_name",
        label: "Event Name",
        type: "text",
        required: true,
        placeholder: "purchased_product",
        description: "Name of the custom event (lowercase, no spaces)",
        supportsAI: true
      },
      {
        name: "properties",
        label: "Event Properties",
        type: "keyvalue",
        required: false,
        placeholder: "Add custom event properties",
        description: "Additional event data (e.g., product_name: Premium Plan, price: 99.99)"
      },
      {
        name: "occurred_at",
        label: "Occurred At (Optional)",
        type: "text",
        required: false,
        placeholder: "2025-01-15T10:30:00Z",
        description: "ISO 8601 timestamp when the event occurred (defaults to now)",
        supportsAI: true
      },
      {
        name: "is_syncing",
        label: "Is Syncing",
        type: "boolean",
        required: false,
        defaultValue: false,
        description: "Whether this is a historical event being synced"
      }
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the event was created successfully"
      },
      {
        name: "eventName",
        label: "Event Name",
        type: "string",
        description: "Name of the created event"
      },
      {
        name: "subscriberEmail",
        label: "Subscriber Email",
        type: "string",
        description: "Email of the subscriber"
      }
    ]
  },
  // New schema-based actions
  getCampaignStats,
  scheduleCampaign,
  getSubscriber,
  getCampaign,
  unsubscribeSubscriber,
  addNote,
  createSegment
]
