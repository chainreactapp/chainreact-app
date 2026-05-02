import { NodeComponent } from "../../../types"

export const shareFileActionSchema: NodeComponent = {
  type: "google-drive:share_file",
  title: "Share File/Folder",
  description: "Share a Google Drive file or folder with specific people or make it public with customizable permissions",
  icon: "Share2" as any,
  providerId: "google-drive",
  category: "Google Drive",
  isTrigger: false,
  testable: true,
  producesOutput: true,
  requiredScopes: ["https://www.googleapis.com/auth/drive"],
  configSchema: [
    {
      name: "fileId",
      label: "File or Folder",
      type: "select",
      required: true,
      dynamic: "google-drive-files",
      loadOnMount: true,
      description: "Select the file or folder to share"
    },
    {
      name: "shareType",
      label: "Share With",
      type: "select",
      required: true,
      defaultValue: "user",
      options: [
        { value: "user", label: "Specific People (by email)" },
        { value: "domain", label: "Everyone in Organization" },
        { value: "anyone", label: "Anyone with the Link" }
      ]
    },
    {
      name: "emailAddress",
      label: "Email Address",
      type: "combobox",
      dynamic: "gmail-enhanced-recipients",
      required: false,
      visibleWhen: { field: "shareType", value: "user" },
      placeholder: "Select a contact or enter email...",
      searchable: true,
      allowCustomValue: true,
      supportsAI: true,
      description: "Email address of the person to share with. Loads contacts and recent recipients from your Gmail account."
    },
    {
      name: "role",
      label: "Permission Level",
      type: "select",
      required: true,
      defaultValue: "reader",
      options: [
        { value: "reader", label: "Viewer (can view only)" },
        { value: "commenter", label: "Commenter (can view and comment)" },
        { value: "writer", label: "Editor (can edit)" },
        { value: "owner", label: "Owner (transfer ownership)" }
      ]
    },
    {
      name: "sendNotification",
      label: "Send Email Notification",
      type: "boolean",
      required: true,
      description: "Required (Q11). Recommended: false — sending shared-with users an email contacts a real person on every workflow run. Notify the person via email about this shared file."
    },
    {
      name: "emailMessage",
      label: "Custom Message (Optional)",
      type: "textarea",
      required: false,
      visibleWhen: { field: "sendNotification", value: true },
      placeholder: "Here's the file you requested...",
      supportsAI: true,
      description: "Add a personal message to the notification email"
    }
  ],
  outputSchema: [
    {
      name: "permissionId",
      label: "Permission ID",
      type: "string",
      description: "Unique identifier for this permission"
    },
    {
      name: "role",
      label: "Role Granted",
      type: "string",
      description: "The permission level that was granted"
    },
    {
      name: "shareLink",
      label: "Share Link",
      type: "string",
      description: "Direct link to the shared file/folder"
    },
    {
      name: "sharedWith",
      label: "Shared With",
      type: "string",
      description: "Who the file was shared with"
    }
  ]
}
