import { NodeComponent } from "../../types"
import {
  Upload,
  FileText,
  Download,
  FolderPlus,
  Trash2,
  Copy,
  FolderInput,
  FileEdit,
  Share2,
  Mail,
  Search,
  HardDrive
} from "lucide-react"

// OneDrive Triggers
const onedriveTriggerNewFile: NodeComponent = {
  type: "onedrive_trigger_new_file",
  title: "New file or folder",
  description: "Triggers when a new file or folder is created",
  icon: Upload,
  providerId: "onedrive",
  category: "Storage",
  isTrigger: true,
  requiredScopes: ["Files.ReadWrite"],
  producesOutput: true,
  configSchema: [
    {
      name: "folderId",
      label: "Folder to Watch",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder or leave blank for root",
      description: "Choose a specific OneDrive folder to monitor. Leave empty to watch the root.",
      uiTab: "basic"
    },
    {
      name: "watchType",
      label: "Watch For",
      type: "select",
      required: false,
      defaultValue: "any",
      options: [
        { value: "any", label: "Files and folders" },
        { value: "files", label: "Files only" },
        { value: "folders", label: "Folders only" }
      ],
      description: "Limit the trigger to files, folders, or both.",
      uiTab: "basic"
    },
    {
      name: "fileType",
      label: "File Type Filter",
      type: "select",
      required: false,
      defaultValue: "any",
      options: [
        { value: "any", label: "Any file" },
        { value: "documents", label: "Documents" },
        { value: "images", label: "Images" },
        { value: "audio", label: "Audio" },
        { value: "video", label: "Video" },
        { value: "spreadsheets", label: "Spreadsheets" },
        { value: "presentations", label: "Presentations" },
        { value: "pdf", label: "PDF" },
        { value: "archives", label: "Archives" }
      ],
      description: "Only applies when watching for files.",
      visibilityCondition: { field: "watchType", operator: "equals", value: "files" },
      uiTab: "advanced"
    },
    {
      name: "includeSubfolders",
      label: "Include Subfolders",
      type: "boolean",
      defaultValue: true,
      description: "When enabled, new items created in subfolders will also trigger.",
      uiTab: "advanced"
    }
    ,
    {
      name: "triggerOnUpdates",
      label: "Trigger on updates (new versions)",
      type: "boolean",
      defaultValue: false,
      description: "Enable to trigger when a new version of an existing file is uploaded (in addition to new files/folders).",
      uiTab: "advanced"
    },
    {
      name: "sharedOnly",
      label: "Shared Items Only",
      type: "boolean",
      defaultValue: false,
      description: "When enabled, only triggers for items that are shared with you by others.",
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "id",
      label: "File/Folder ID",
      type: "string",
      description: "Unique identifier for the new file or folder"
    },
    {
      name: "name",
      label: "Name",
      type: "string",
      description: "Name of the new file or folder"
    },
    {
      name: "type",
      label: "Type",
      type: "string",
      description: "Type: 'file' or 'folder'"
    },
    {
      name: "size",
      label: "Size",
      type: "number",
      description: "Size in bytes (0 for folders)"
    },
    {
      name: "path",
      label: "Path",
      type: "string",
      description: "Full path to the file or folder"
    },
    {
      name: "webUrl",
      label: "Web URL",
      type: "string",
      description: "URL to view the file/folder in OneDrive"
    },
    {
      name: "mimeType",
      label: "MIME Type",
      type: "string",
      description: "MIME type of the file (empty for folders)"
    },
    {
      name: "createdTime",
      label: "Created Time",
      type: "string",
      description: "ISO timestamp when the file/folder was created"
    },
    {
      name: "modifiedTime",
      label: "Modified Time",
      type: "string",
      description: "ISO timestamp when last modified"
    }
  ]
}

const onedriveTriggerFileModified: NodeComponent = {
  type: "onedrive_trigger_file_modified",
  title: "File modified",
  description: "Triggers when a file is modified",
  icon: FileText,
  providerId: "onedrive",
  category: "Storage",
  isTrigger: true,
  requiredScopes: ["Files.ReadWrite"],
  producesOutput: true,
  configSchema: [
    {
      name: "folderId",
      label: "Folder to Watch",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder or leave blank for all folders",
      description: "Limit the trigger to a specific folder. Leave empty to monitor the entire drive.",
      uiTab: "basic"
    },
    {
      name: "fileId",
      label: "Specific File",
      type: "select",
      dynamic: "onedrive-files",
      required: false,
      placeholder: "Optional: select a specific file",
      description: "Choose a single file to monitor for modifications.",
      dependsOn: "folderId",
      uiTab: "basic"
    },
    {
      name: "fileNameFilter",
      label: "File Name Filter",
      type: "text",
      required: false,
      placeholder: "e.g. report, Q1, draft",
      description: "Only trigger when the file name contains this text.",
      uiTab: "advanced",
      supportsAI: true
    },
    {
      name: "fileType",
      label: "File Type",
      type: "select",
      required: false,
      defaultValue: "any",
      options: [
        { value: "any", label: "Any file" },
        { value: "documents", label: "Documents" },
        { value: "images", label: "Images" },
        { value: "audio", label: "Audio" },
        { value: "video", label: "Video" },
        { value: "spreadsheets", label: "Spreadsheets" },
        { value: "presentations", label: "Presentations" },
        { value: "pdf", label: "PDF" },
        { value: "archives", label: "Archives" }
      ],
      description: "Filter modifications by file type category.",
      uiTab: "advanced"
    },
    {
      name: "includeSubfolders",
      label: "Include Subfolders",
      type: "boolean",
      defaultValue: true,
      description: "When enabled, modifications inside subfolders will also trigger.",
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "id",
      label: "File ID",
      type: "string",
      description: "Unique identifier for the modified file"
    },
    {
      name: "name",
      label: "File Name",
      type: "string",
      description: "Name of the modified file"
    },
    {
      name: "size",
      label: "File Size",
      type: "number",
      description: "Size of the file in bytes"
    },
    {
      name: "path",
      label: "File Path",
      type: "string",
      description: "Full path to the file in OneDrive"
    },
    {
      name: "webUrl",
      label: "Web URL",
      type: "string",
      description: "URL to view the file in OneDrive"
    },
    {
      name: "mimeType",
      label: "MIME Type",
      type: "string",
      description: "MIME type of the file"
    },
    {
      name: "modifiedTime",
      label: "Modified Time",
      type: "string",
      description: "ISO timestamp when the file was modified"
    },
    {
      name: "modifiedBy",
      label: "Modified By",
      type: "string",
      description: "User who modified the file"
    }
  ]
}

// OneDrive Actions
const onedriveActionUploadFile: NodeComponent = {
  type: "onedrive_action_upload_file",
  title: "Upload File",
  description: "Upload a file to OneDrive from various sources",
  icon: Upload,
  providerId: "onedrive",
  requiredScopes: ["Files.ReadWrite"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "fileName",
      label: "File Name",
      type: "text",
      required: true,
      placeholder: "Enter file name (e.g., document.txt, report.pdf) - auto-filled when uploading files",
      description: "File name for the created file. Will be automatically populated when you upload files.",
      supportsAI: true
    },
    {
      name: "sourceType",
      label: "File Source",
      type: "select",
      required: true,
      defaultValue: "file",
      options: [
        { value: "file", label: "Upload File" },
        { value: "url", label: "From URL" },
        { value: "text", label: "Text Content" },
        { value: "node", label: "From Previous Node" }
      ],
      description: "Choose how to provide the file for upload"
    },
    {
      name: "uploadedFiles",
      label: "Upload Files",
      type: "file",
      required: false,
      placeholder: "Choose files to upload...",
      accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.zip,.rar,.json,.xml,.html,.css,.js,.py,.java,.cpp,.c,.md,.log",
      maxSize: 100 * 1024 * 1024, // 100MB limit for OneDrive
      description: "Upload files to create in OneDrive (max 100MB per file). Files will be stored and available for workflow execution.",
      visibilityCondition: { field: "sourceType", operator: "equals", value: "file" }
    },
    {
      name: "fileUrl",
      label: "File URL",
      type: "text",
      required: false,
      placeholder: "https://example.com/file.pdf",
      description: "Direct URL to a publicly accessible file (e.g., image, PDF, document). The file will be downloaded and uploaded to OneDrive.",
      visibilityCondition: { field: "sourceType", operator: "equals", value: "url" },
      supportsAI: true
    },
    {
      name: "fileContent",
      label: "Text Content",
      type: "textarea",
      required: false,
      placeholder: "Enter text content for the file",
      description: "Text content to create a text file. The file will be saved with the specified file name.",
      visibilityCondition: { field: "sourceType", operator: "equals", value: "text" },
      supportsAI: true
    },
    {
      name: "fileFromNode",
      label: "File Variable",
      type: "text",
      required: false,
      placeholder: "{{node-id.file}}",
      description: "Variable containing file data (base64, buffer, or file object) from a previous node. Use this for files generated or processed by other nodes in your workflow.",
      visibilityCondition: { field: "sourceType", operator: "equals", value: "node" },
      supportsAI: true
    },
    {
      name: "folderId",
      label: "Destination Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      placeholder: "Select a folder (optional, defaults to root)",
      description: "Choose the folder where the file should be uploaded. Leave empty to upload to root.",
      loadOnMount: true
    },
  ],
  outputSchema: [
    {
      name: "id",
      label: "File ID",
      type: "string",
      description: "Unique identifier for the uploaded file"
    },
    {
      name: "name",
      label: "File Name",
      type: "string",
      description: "Name of the uploaded file"
    },
    {
      name: "size",
      label: "File Size",
      type: "number",
      description: "Size of the file in bytes"
    },
    {
      name: "webUrl",
      label: "Web URL",
      type: "string",
      description: "URL to view the file in OneDrive"
    },
    {
      name: "downloadUrl",
      label: "Download URL",
      type: "string",
      description: "Direct download URL for the file"
    },
    {
      name: "path",
      label: "File Path",
      type: "string",
      description: "Full path to the file in OneDrive"
    },
    {
      name: "createdTime",
      label: "Created Time",
      type: "string",
      description: "ISO timestamp when the file was created"
    }
  ]
}

const onedriveActionGetFile: NodeComponent = {
  type: "onedrive_action_get_file",
  title: "Get File",
  description: "Retrieve file details and download a file from OneDrive",
  icon: Download,
  providerId: "onedrive",
  requiredScopes: ["Files.Read"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "folderId",
      label: "Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder (optional)",
      description: "Choose a folder to browse files from"
    },
    {
      name: "fileId",
      label: "File",
      type: "select",
      dynamic: "onedrive-files",
      required: true,
      loadOnMount: true,
      placeholder: "Select a file",
      description: "Choose the file to retrieve",
      dependsOn: "folderId"
      // loadOnMount loads files from root on mount, dependsOn reloads when folder is selected
    },
    {
      name: "downloadContent",
      label: "Download File Content",
      type: "boolean",
      defaultValue: true,
      description: "When enabled, downloads the file content. When disabled, only retrieves file metadata."
    }
  ],
  outputSchema: [
    {
      name: "id",
      label: "File ID",
      type: "string",
      description: "The unique ID of the file"
    },
    {
      name: "name",
      label: "File Name",
      type: "string",
      description: "The name of the file"
    },
    {
      name: "size",
      label: "File Size",
      type: "number",
      description: "Size of the file in bytes"
    },
    {
      name: "url",
      label: "File URL",
      type: "string",
      description: "Direct download URL for the file"
    },
    {
      name: "content",
      label: "File Content",
      type: "string",
      description: "The file content (base64 encoded if binary)"
    },
    {
      name: "mimeType",
      label: "MIME Type",
      type: "string",
      description: "The MIME type of the file"
    },
    {
      name: "modifiedAt",
      label: "Last Modified",
      type: "string",
      description: "When the file was last modified"
    }
  ]
}

// Phase 1: File Operations
const onedriveActionCreateFolder: NodeComponent = {
  type: "onedrive_action_create_folder",
  title: "Create Folder",
  description: "Create a new folder in OneDrive",
  icon: FolderPlus,
  providerId: "onedrive",
  requiredScopes: ["Files.ReadWrite"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "folderName",
      label: "Folder Name",
      type: "text",
      required: true,
      placeholder: "e.g., Project Files, Reports 2025",
      description: "Name of the new folder to create",
      supportsAI: true,
      uiTab: "basic"
    },
    {
      name: "parentFolderId",
      label: "Parent Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select parent folder (optional, defaults to root)",
      description: "Choose where to create the folder. Leave empty to create in root.",
      uiTab: "basic"
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      required: false,
      placeholder: "Optional description for the folder",
      description: "Add a description to help organize and identify the folder",
      supportsAI: true,
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "id",
      label: "Folder ID",
      type: "string",
      description: "Unique identifier for the created folder"
    },
    {
      name: "name",
      label: "Folder Name",
      type: "string",
      description: "Name of the created folder"
    },
    {
      name: "webUrl",
      label: "Web URL",
      type: "string",
      description: "URL to view the folder in OneDrive"
    },
    {
      name: "path",
      label: "Folder Path",
      type: "string",
      description: "Full path to the folder in OneDrive"
    },
    {
      name: "createdTime",
      label: "Created Time",
      type: "string",
      description: "ISO timestamp when the folder was created"
    }
  ]
}

const onedriveActionDeleteItem: NodeComponent = {
  type: "onedrive_action_delete_item",
  title: "Delete File or Folder",
  description: "Delete a file or folder from OneDrive",
  icon: Trash2,
  providerId: "onedrive",
  requiredScopes: ["Files.ReadWrite"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "itemType",
      label: "Item Type",
      type: "select",
      required: true,
      defaultValue: "file",
      options: [
        { value: "file", label: "File" },
        { value: "folder", label: "Folder" }
      ],
      description: "Choose whether to delete a file or folder",
      uiTab: "basic"
    },
    {
      name: "folderId",
      label: "Browse Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select folder to browse (optional)",
      description: "Navigate to a folder to find the file you want to delete. Leave empty to browse root files.",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "fileId",
      label: "File to Delete",
      type: "select",
      dynamic: "onedrive-files",
      required: false,
      loadOnMount: true,
      placeholder: "Select a file",
      description: "Choose the file to delete",
      dependsOn: "folderId",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "folderIdToDelete",
      label: "Folder to Delete",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder",
      description: "Choose the folder to delete",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "folder" } }
      },
      uiTab: "basic"
    },
    {
      name: "itemId",
      label: "Item ID (Advanced)",
      type: "text",
      required: false,
      placeholder: "Paste item ID directly",
      description: "Alternatively, provide the OneDrive item ID directly",
      supportsAI: true,
      uiTab: "advanced"
    },
    {
      name: "permanentDelete",
      label: "Permanent Delete",
      type: "boolean",
      defaultValue: false,
      description: "When enabled, permanently deletes the item. When disabled, moves to recycle bin.",
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "success",
      label: "Success",
      type: "boolean",
      description: "Whether the deletion was successful"
    },
    {
      name: "deletedId",
      label: "Deleted Item ID",
      type: "string",
      description: "ID of the deleted item"
    },
    {
      name: "deletedName",
      label: "Deleted Item Name",
      type: "string",
      description: "Name of the deleted item"
    },
    {
      name: "deletedAt",
      label: "Deleted At",
      type: "string",
      description: "ISO timestamp when the item was deleted"
    }
  ]
}

const onedriveActionCopyItem: NodeComponent = {
  type: "onedrive_action_copy_item",
  title: "Copy File or Folder",
  description: "Copy a file or folder to a new location in OneDrive",
  icon: Copy,
  providerId: "onedrive",
  requiredScopes: ["Files.ReadWrite"],
  category: "Storage",
  isTrigger: false,
  recommendedTimeoutMs: 180000,
  configSchema: [
    {
      name: "itemType",
      label: "Item Type",
      type: "select",
      required: true,
      defaultValue: "file",
      options: [
        { value: "file", label: "File" },
        { value: "folder", label: "Folder" }
      ],
      description: "Choose whether to copy a file or folder",
      uiTab: "basic"
    },
    {
      name: "sourceFolderId",
      label: "Browse Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select folder to browse (optional)",
      description: "Navigate to a folder to find the file you want to copy. Leave empty to browse root files.",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "sourceFileId",
      label: "File to Copy",
      type: "select",
      dynamic: "onedrive-files",
      required: false,
      loadOnMount: true,
      placeholder: "Select a file",
      description: "Choose the file to copy. Select a source folder first to browse files in that folder, or leave it empty to see root files.",
      dependsOn: "sourceFolderId",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "sourceFolderIdToCopy",
      label: "Folder to Copy",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder",
      description: "Choose the folder to copy",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "folder" } }
      },
      uiTab: "basic"
    },
    {
      name: "destinationFolderId",
      label: "Destination Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select destination (defaults to root)",
      description: "Choose where to copy the item. Leave empty for root.",
      uiTab: "basic"
    },
    {
      name: "newName",
      label: "New Name (Optional)",
      type: "text",
      required: false,
      placeholder: "Leave blank to keep original name",
      description: "Optionally rename the item during copy",
      supportsAI: true,
      uiTab: "advanced"
    },
    {
      name: "conflictBehavior",
      label: "If Item Exists",
      type: "select",
      required: false,
      defaultValue: "rename",
      options: [
        { value: "rename", label: "Rename (add number)" },
        { value: "replace", label: "Replace existing" },
        { value: "fail", label: "Fail" }
      ],
      description: "How to handle if an item with the same name exists",
      uiTab: "advanced"
    },
    {
      name: "waitForCompletion",
      label: "Wait for Completion",
      type: "boolean",
      defaultValue: false,
      description: "When disabled (default), returns success immediately after copy is initiated - the copy continues in the background. Enable to wait for the copy to fully complete before proceeding.",
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "status",
      label: "Status",
      type: "string",
      description: "Copy status: 'initiated', 'in_progress', or 'completed'"
    },
    {
      name: "monitorUrl",
      label: "Monitor URL",
      type: "string",
      description: "URL to check copy operation progress (when not waiting for completion)"
    },
    {
      name: "id",
      label: "Copied Item ID",
      type: "string",
      description: "Unique identifier for the copied item (available when completed)"
    },
    {
      name: "name",
      label: "Item Name",
      type: "string",
      description: "Name of the copied item"
    },
    {
      name: "type",
      label: "Item Type",
      type: "string",
      description: "Type: 'file' or 'folder'"
    },
    {
      name: "webUrl",
      label: "Web URL",
      type: "string",
      description: "URL to view the copied item in OneDrive"
    },
    {
      name: "path",
      label: "Path",
      type: "string",
      description: "Full path to the copied item"
    },
    {
      name: "size",
      label: "Size",
      type: "number",
      description: "Size in bytes (0 for folders)"
    },
    {
      name: "createdTime",
      label: "Created Time",
      type: "string",
      description: "ISO timestamp when the copy was created"
    }
  ]
}

const onedriveActionMoveItem: NodeComponent = {
  type: "onedrive_action_move_item",
  title: "Move File or Folder",
  description: "Move a file or folder to a new location in OneDrive",
  icon: FolderInput,
  providerId: "onedrive",
  requiredScopes: ["Files.ReadWrite"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "itemType",
      label: "Item Type",
      type: "select",
      required: true,
      defaultValue: "file",
      options: [
        { value: "file", label: "File" },
        { value: "folder", label: "Folder" }
      ],
      description: "Choose whether to move a file or folder",
      uiTab: "basic"
    },
    {
      name: "sourceFolderId",
      label: "Browse Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select folder to browse (optional)",
      description: "Navigate to a folder to find the file you want to move. Leave empty to browse root files.",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "sourceFileId",
      label: "File to Move",
      type: "select",
      dynamic: "onedrive-files",
      required: false,
      loadOnMount: true,
      placeholder: "Select a file",
      description: "Choose the file to move. Select a source folder first to browse files in that folder, or leave it empty to see root files.",
      dependsOn: "sourceFolderId",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "sourceFolderIdToMove",
      label: "Folder to Move",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder",
      description: "Choose the folder to move",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "folder" } }
      },
      uiTab: "basic"
    },
    {
      name: "destinationFolderId",
      label: "Destination Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select destination (defaults to root)",
      description: "Choose where to move the item. Leave empty for root.",
      uiTab: "basic"
    },
    {
      name: "newName",
      label: "New Name (Optional)",
      type: "text",
      required: false,
      placeholder: "Leave blank to keep original name",
      description: "Optionally rename the item during move",
      supportsAI: true,
      uiTab: "advanced"
    },
    {
      name: "conflictBehavior",
      label: "If Item Exists",
      type: "select",
      required: false,
      defaultValue: "rename",
      options: [
        { value: "rename", label: "Rename (add number)" },
        { value: "replace", label: "Replace existing" },
        { value: "fail", label: "Fail" }
      ],
      description: "How to handle if an item with the same name exists",
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "id",
      label: "Moved Item ID",
      type: "string",
      description: "Unique identifier for the moved item"
    },
    {
      name: "name",
      label: "Item Name",
      type: "string",
      description: "Name of the moved item"
    },
    {
      name: "type",
      label: "Item Type",
      type: "string",
      description: "Type: 'file' or 'folder'"
    },
    {
      name: "webUrl",
      label: "Web URL",
      type: "string",
      description: "URL to view the moved item in OneDrive"
    },
    {
      name: "path",
      label: "Path",
      type: "string",
      description: "Full path to the moved item"
    },
    {
      name: "size",
      label: "Size",
      type: "number",
      description: "Size in bytes (0 for folders)"
    },
    {
      name: "modifiedTime",
      label: "Modified Time",
      type: "string",
      description: "ISO timestamp when the item was last modified"
    }
  ]
}

const onedriveActionRenameItem: NodeComponent = {
  type: "onedrive_action_rename_item",
  title: "Rename File or Folder",
  description: "Rename a file or folder in OneDrive",
  icon: FileEdit,
  providerId: "onedrive",
  requiredScopes: ["Files.ReadWrite"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "itemType",
      label: "Item Type",
      type: "select",
      required: true,
      defaultValue: "file",
      options: [
        { value: "file", label: "File" },
        { value: "folder", label: "Folder" }
      ],
      description: "Choose whether to rename a file or folder",
      uiTab: "basic"
    },
    {
      name: "folderId",
      label: "Browse Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select folder to browse (optional)",
      description: "Navigate to a folder to find the file you want to rename. Leave empty to browse root files.",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "fileId",
      label: "File to Rename",
      type: "select",
      dynamic: "onedrive-files",
      required: false,
      loadOnMount: true,
      placeholder: "Select a file",
      description: "Choose the file to rename",
      dependsOn: "folderId",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "folderIdToRename",
      label: "Folder to Rename",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder",
      description: "Choose the folder to rename",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "folder" } }
      },
      uiTab: "basic"
    },
    {
      name: "newName",
      label: "New Name",
      type: "text",
      required: true,
      placeholder: "e.g., Updated Report Q4 2025.pdf",
      description: "The new name for the item (include file extension for files)",
      supportsAI: true,
      uiTab: "basic"
    }
  ],
  outputSchema: [
    {
      name: "id",
      label: "Item ID",
      type: "string",
      description: "Unique identifier for the renamed item"
    },
    {
      name: "oldName",
      label: "Old Name",
      type: "string",
      description: "Previous name of the item"
    },
    {
      name: "newName",
      label: "New Name",
      type: "string",
      description: "New name of the item"
    },
    {
      name: "type",
      label: "Item Type",
      type: "string",
      description: "Type: 'file' or 'folder'"
    },
    {
      name: "webUrl",
      label: "Web URL",
      type: "string",
      description: "URL to view the renamed item in OneDrive"
    },
    {
      name: "path",
      label: "Path",
      type: "string",
      description: "Full path to the renamed item"
    },
    {
      name: "modifiedTime",
      label: "Modified Time",
      type: "string",
      description: "ISO timestamp when the item was renamed"
    }
  ]
}

// Phase 2: Sharing Features
const onedriveActionCreateSharingLink: NodeComponent = {
  type: "onedrive_action_create_sharing_link",
  title: "Create Sharing Link",
  description: "Generate a shareable link for a file or folder",
  icon: Share2,
  providerId: "onedrive",
  requiredScopes: ["Files.ReadWrite"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "itemType",
      label: "Item Type",
      type: "select",
      required: true,
      defaultValue: "file",
      options: [
        { value: "file", label: "File" },
        { value: "folder", label: "Folder" }
      ],
      description: "Choose whether to share a file or folder",
      uiTab: "basic"
    },
    {
      name: "folderId",
      label: "Browse Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select folder to browse (optional)",
      description: "Navigate to a folder to find the file you want to share. Leave empty to browse root files.",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "fileId",
      label: "File to Share",
      type: "select",
      dynamic: "onedrive-files",
      required: false,
      loadOnMount: true,
      placeholder: "Select a file",
      description: "Choose the file to create a sharing link for",
      dependsOn: "folderId",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "folderIdToShare",
      label: "Folder to Share",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder",
      description: "Choose the folder to create a sharing link for",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "folder" } }
      },
      uiTab: "basic"
    },
    {
      name: "linkType",
      label: "Link Type",
      type: "select",
      required: true,
      defaultValue: "view",
      options: [
        { value: "view", label: "View only" },
        { value: "edit", label: "Can edit" }
      ],
      description: "Permission level for the sharing link",
      uiTab: "basic"
    },
    {
      name: "linkScope",
      label: "Link Scope",
      type: "select",
      required: true,
      options: [
        { value: "anonymous", label: "Anyone with the link" },
        { value: "organization", label: "People in my organization" }
      ],
      description: "Required (Q11). Recommended: Organization — anonymous links are accessible by anyone with the URL.",
      uiTab: "basic"
    },
    {
      name: "expirationDateTime",
      label: "Expiration Date/Time",
      type: "text",
      required: false,
      placeholder: "e.g., 2025-12-31T23:59:59Z",
      description: "Optional: ISO 8601 datetime when the link expires",
      supportsAI: true,
      uiTab: "advanced"
    },
    {
      name: "password",
      label: "Password Protection",
      type: "text",
      required: false,
      placeholder: "Optional: set a password",
      description: "Require a password to access the link (OneDrive Personal only)",
      supportsAI: true,
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "link",
      label: "Sharing Link",
      type: "string",
      description: "The generated sharing URL"
    },
    {
      name: "linkId",
      label: "Link ID",
      type: "string",
      description: "Unique identifier for the sharing link"
    },
    {
      name: "type",
      label: "Link Type",
      type: "string",
      description: "Permission level (view/edit)"
    },
    {
      name: "scope",
      label: "Link Scope",
      type: "string",
      description: "Who can access (anonymous/organization)"
    },
    {
      name: "expirationDateTime",
      label: "Expiration Date",
      type: "string",
      description: "When the link expires (if set)"
    },
    {
      name: "itemName",
      label: "Item Name",
      type: "string",
      description: "Name of the shared item"
    },
    {
      name: "createdTime",
      label: "Created Time",
      type: "string",
      description: "When the sharing link was created"
    }
  ]
}

const onedriveActionSendSharingInvitation: NodeComponent = {
  type: "onedrive_action_send_sharing_invitation",
  title: "Send Sharing Invitation",
  description: "Send file or folder access invitation to specific recipients",
  icon: Mail,
  providerId: "onedrive",
  requiredScopes: ["Files.ReadWrite"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "itemType",
      label: "Item Type",
      type: "select",
      required: true,
      defaultValue: "file",
      options: [
        { value: "file", label: "File" },
        { value: "folder", label: "Folder" }
      ],
      description: "Choose whether to share a file or folder",
      uiTab: "basic"
    },
    {
      name: "folderId",
      label: "Browse Folder",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select folder to browse (optional)",
      description: "Navigate to a folder to find the file you want to share. Leave empty to browse root files.",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "fileId",
      label: "File to Share",
      type: "select",
      dynamic: "onedrive-files",
      required: false,
      loadOnMount: true,
      placeholder: "Select a file",
      description: "Choose the file to share",
      dependsOn: "folderId",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "file" } }
      },
      uiTab: "basic"
    },
    {
      name: "folderIdToShare",
      label: "Folder to Share",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Select a folder",
      description: "Choose the folder to share",
      hidden: {
        $deps: ["itemType"],
        $condition: { itemType: { $ne: "folder" } }
      },
      uiTab: "basic"
    },
    {
      name: "recipients",
      label: "Recipients (Email Addresses)",
      type: "textarea",
      required: true,
      placeholder: "Enter email addresses (one per line or comma-separated)",
      description: "Email addresses to send the invitation to. One per line or comma-separated.",
      supportsAI: true,
      uiTab: "basic"
    },
    {
      name: "role",
      label: "Permission Level",
      type: "select",
      required: true,
      defaultValue: "read",
      options: [
        { value: "read", label: "Can view" },
        { value: "write", label: "Can edit" }
      ],
      description: "Access level for recipients",
      uiTab: "basic"
    },
    {
      name: "requireSignIn",
      label: "Require Sign-In",
      type: "boolean",
      defaultValue: true,
      description: "Recipients must sign in to access the item",
      uiTab: "advanced"
    },
    {
      name: "sendInvitation",
      label: "Send Email Notification",
      type: "boolean",
      defaultValue: true,
      description: "Send an email notification with the sharing link",
      uiTab: "advanced"
    },
    {
      name: "message",
      label: "Custom Message",
      type: "textarea",
      required: false,
      placeholder: "Optional message to include in the invitation email",
      description: "Personal message included in the invitation email",
      supportsAI: true,
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "success",
      label: "Success",
      type: "boolean",
      description: "Whether invitations were sent successfully"
    },
    {
      name: "invitationIds",
      label: "Invitation IDs",
      type: "array",
      description: "Array of unique identifiers for the sent invitations"
    },
    {
      name: "recipients",
      label: "Recipients",
      type: "array",
      description: "List of email addresses invited"
    },
    {
      name: "role",
      label: "Permission Level",
      type: "string",
      description: "Access level granted (read/write)"
    },
    {
      name: "itemName",
      label: "Item Name",
      type: "string",
      description: "Name of the shared item"
    },
    {
      name: "sentTime",
      label: "Sent Time",
      type: "string",
      description: "ISO timestamp when invitations were sent"
    }
  ]
}

// Phase 3: Search Capabilities
const onedriveActionSearchFiles: NodeComponent = {
  type: "onedrive_action_search_files",
  title: "Search Files/Folders",
  description: "Search for files and folders by name, content, or metadata",
  icon: Search,
  providerId: "onedrive",
  requiredScopes: ["Files.Read"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "searchQuery",
      label: "Search Query",
      type: "text",
      required: true,
      placeholder: "e.g., report, budget 2025, project",
      description: "Search term to find files and folders",
      supportsAI: true,
      uiTab: "basic"
    },
    {
      name: "searchType",
      label: "Search Type",
      type: "select",
      required: false,
      defaultValue: "any",
      options: [
        { value: "any", label: "Files and folders" },
        { value: "files", label: "Files only" },
        { value: "folders", label: "Folders only" }
      ],
      description: "Limit search to specific item types",
      uiTab: "basic"
    },
    {
      name: "searchScope",
      label: "Search Scope",
      type: "select",
      dynamic: "onedrive-folders",
      required: false,
      loadOnMount: true,
      placeholder: "Search entire drive (leave blank) or select folder",
      description: "Limit search to a specific folder and its subfolders",
      uiTab: "basic"
    },
    {
      name: "fileType",
      label: "File Type Filter",
      type: "select",
      required: false,
      defaultValue: "any",
      options: [
        { value: "any", label: "Any type" },
        { value: "documents", label: "Documents" },
        { value: "images", label: "Images" },
        { value: "audio", label: "Audio" },
        { value: "video", label: "Video" },
        { value: "spreadsheets", label: "Spreadsheets" },
        { value: "presentations", label: "Presentations" },
        { value: "pdf", label: "PDF" },
        { value: "archives", label: "Archives" }
      ],
      description: "Filter results by file type category",
      uiTab: "advanced"
    },
    {
      name: "maxResults",
      label: "Max Results",
      type: "number",
      required: false,
      defaultValue: 20,
      placeholder: "20",
      description: "Maximum number of results to return (1-200)",
      uiTab: "advanced"
    },
    {
      name: "sortBy",
      label: "Sort By",
      type: "select",
      required: false,
      defaultValue: "relevance",
      options: [
        { value: "relevance", label: "Relevance" },
        { value: "name", label: "Name" },
        { value: "lastModified", label: "Last modified" },
        { value: "size", label: "Size" }
      ],
      description: "How to sort search results",
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "results",
      label: "Search Results",
      type: "array",
      description: "Array of matching items"
    },
    {
      name: "totalCount",
      label: "Total Count",
      type: "number",
      description: "Total number of results found"
    },
    {
      name: "items",
      label: "Items",
      type: "array",
      description: "Detailed array of items with id, name, type, path, webUrl, size, modifiedTime"
    }
  ]
}

const onedriveActionFindItemById: NodeComponent = {
  type: "onedrive_action_find_item_by_id",
  title: "Get Item Details by ID",
  description: "Get full details of a file/folder using an ID from a previous step (trigger or action output)",
  icon: Search,
  providerId: "onedrive",
  requiredScopes: ["Files.Read"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "itemId",
      label: "Item ID",
      type: "text",
      required: true,
      placeholder: "e.g., {{trigger.id}} or {{node-123.id}}",
      description: "Use a variable from a previous step like {{trigger.id}} or {{search-node.items[0].id}}",
      supportsAI: true,
      uiTab: "basic"
    },
    {
      name: "includeMetadata",
      label: "Include Full Metadata",
      type: "boolean",
      defaultValue: true,
      description: "Include all item metadata (permissions, versions, etc.)",
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "id",
      label: "Item ID",
      type: "string",
      description: "The unique ID of the item"
    },
    {
      name: "name",
      label: "Item Name",
      type: "string",
      description: "Name of the item"
    },
    {
      name: "type",
      label: "Item Type",
      type: "string",
      description: "Type: 'file' or 'folder'"
    },
    {
      name: "webUrl",
      label: "Web URL",
      type: "string",
      description: "URL to view the item in OneDrive"
    },
    {
      name: "path",
      label: "Path",
      type: "string",
      description: "Full path to the item"
    },
    {
      name: "size",
      label: "Size",
      type: "number",
      description: "Size in bytes (0 for folders)"
    },
    {
      name: "mimeType",
      label: "MIME Type",
      type: "string",
      description: "MIME type of the file"
    },
    {
      name: "createdTime",
      label: "Created Time",
      type: "string",
      description: "ISO timestamp when created"
    },
    {
      name: "modifiedTime",
      label: "Modified Time",
      type: "string",
      description: "ISO timestamp when last modified"
    },
    {
      name: "metadata",
      label: "Full Metadata",
      type: "object",
      description: "Complete metadata object (if includeMetadata is true)"
    }
  ]
}

// Phase 4: Advanced Features
const onedriveActionListDrives: NodeComponent = {
  type: "onedrive_action_list_drives",
  title: "List Drives",
  description: "List all available OneDrive drives for the user or site",
  icon: HardDrive,
  providerId: "onedrive",
  requiredScopes: ["Files.Read"],
  category: "Storage",
  isTrigger: false,
  configSchema: [
    {
      name: "driveType",
      label: "Drive Type",
      type: "select",
      required: false,
      defaultValue: "all",
      options: [
        { value: "all", label: "All drives" },
        { value: "personal", label: "Personal OneDrive" },
        { value: "business", label: "OneDrive for Business" },
        { value: "sharepoint", label: "SharePoint document libraries" }
      ],
      description: "Filter drives by type",
      uiTab: "basic"
    },
    {
      name: "siteId",
      label: "SharePoint Site ID",
      type: "text",
      required: false,
      placeholder: "Optional: specific site ID",
      description: "List drives for a specific SharePoint site",
      supportsAI: true,
      uiTab: "advanced"
    }
  ],
  outputSchema: [
    {
      name: "drives",
      label: "Drives",
      type: "array",
      description: "Array of available drives"
    },
    {
      name: "totalCount",
      label: "Total Count",
      type: "number",
      description: "Total number of drives found"
    },
    {
      name: "items",
      label: "Drive Details",
      type: "array",
      description: "Detailed array with id, name, driveType, webUrl, owner, quota"
    }
  ]
}

// Export all OneDrive nodes
export const onedriveNodes: NodeComponent[] = [
  // Triggers
  onedriveTriggerNewFile,
  onedriveTriggerFileModified,

  // Actions - Phase 1: File Operations
  onedriveActionUploadFile,
  onedriveActionGetFile,
  onedriveActionCreateFolder,
  onedriveActionDeleteItem,
  onedriveActionCopyItem,
  onedriveActionMoveItem,
  onedriveActionRenameItem,

  // Actions - Phase 2: Sharing Features
  onedriveActionCreateSharingLink,
  onedriveActionSendSharingInvitation,

  // Actions - Phase 3: Search Capabilities
  onedriveActionSearchFiles,
  onedriveActionFindItemById,

  // Actions - Phase 4: Advanced Features
  onedriveActionListDrives,
]
