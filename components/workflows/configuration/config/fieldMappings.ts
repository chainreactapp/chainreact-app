import { logger } from '@/lib/utils/logger'

/**
 * Field to Resource Type Mappings
 * Maps field names to their corresponding resource types for dynamic data loading
 */

export interface FieldMapping {
  [fieldName: string]: string;
}

export interface NodeFieldMappings {
  [nodeType: string]: FieldMapping;
}

// Gmail field mappings
const gmailMappings: Record<string, FieldMapping> = {
  gmail_trigger_new_email: {
    from: "gmail_recent_senders",
    to: "gmail-enhanced-recipients",
    labelIds: "gmail_labels",
  },
  gmail_trigger_new_attachment: {
    from: "gmail_recent_senders",
    to: "gmail-enhanced-recipients",
  },
  gmail_trigger_new_labeled_email: {
    labelId: "gmail_labels",
    from: "gmail_recent_senders",
  },
  gmail_action_send_email: {
    from: "gmail_from_addresses",
    to: "gmail-enhanced-recipients",
    cc: "gmail-enhanced-recipients",
    bcc: "gmail-enhanced-recipients",
    messageId: "gmail-enhanced-recipients",
    labelIds: "gmail_labels",
  },
  gmail_action_create_draft: {
    to: "gmail-enhanced-recipients",
    cc: "gmail-enhanced-recipients",
    bcc: "gmail-enhanced-recipients",
  },
  gmail_action_create_draft_reply: {
    cc: "gmail-enhanced-recipients",
    bcc: "gmail-enhanced-recipients",
  },
  gmail_action_add_label: {
    email: "gmail-enhanced-recipients",
    labelIds: "gmail_labels",
  },
  gmail_action_search_email: {
    labels: "gmail_labels",
    labelFilters: "gmail_labels",
    from: "gmail_recent_senders",
    to: "gmail-enhanced-recipients",
    emailAddress: "gmail-enhanced-recipients",
  },
  gmail_action_advanced_search: {
    from: "gmail_recent_senders",
    to: "gmail_from_addresses",
    hasLabel: "gmail-labels",
  },
  gmail_action_get_attachment: {
    messageId: "gmail-recent-emails",
  },
  gmail_action_download_attachment: {
    messageId: "gmail-recent-emails",
    folderId: "storage-folders",
  },
  gmail_action_mark_as_read: {
    from: "gmail_recent_senders",
    to: "gmail_from_addresses",
    hasLabel: "gmail-labels",
  },
  gmail_action_mark_as_unread: {
    from: "gmail_recent_senders",
    to: "gmail_from_addresses",
    hasLabel: "gmail-labels",
  },
};

// Discord field mappings
const discordMappings: Record<string, FieldMapping> = {
  discord_trigger_new_message: {
    channelId: "discord_channels",
    guildId: "discord_guilds",
    authorFilter: "discord_channel_members", // Use discord_channel_members to get members who can access the channel
  },
  discord_trigger_member_join: {
    guildId: "discord_guilds",
    channelFilter: "discord_channels",
  },
  discord_trigger_slash_command: {
    guildId: "discord_guilds",
    command: "discord_commands",
  },
  discord_action_send_message: {
    channelId: "discord_channels",
    guildId: "discord_guilds",
  },
  discord_action_edit_message: {
    channelId: "discord_channels",
    guildId: "discord_guilds",
    messageId: "discord_messages",
  },
  discord_action_delete_message: {
    guildId: "discord_guilds",
    channelId: "discord_channels",
    userId: "discord_channel_members",
    userIds: "discord_channel_members",
    messageIds: "discord_messages",
  },
  discord_action_fetch_messages: {
    channelId: "discord_channels",
    guildId: "discord_guilds",
    filterAuthor: "discord_members",
  },
  discord_action_assign_role: {
    guildId: "discord_guilds",
    userId: "discord_members",
    roleId: "discord_roles",
  },
};

// Slack field mappings
const slackMappings: Record<string, FieldMapping> = {
  slack_action_send_message: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_send_direct_message: {
    user: "slack_users",
  },
  slack_action_get_user_info: {
    workspace: "slack_workspaces",
    user: "slack_users",
  },
  slack_action_add_reminder: {
    workspace: "slack_workspaces",
    userId: "slack_users",
  },
  slack_action_invite_users_to_channel: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
    users: "slack_users",
  },
  slack_action_remove_user_from_channel: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
    userId: "slack_users",
  },
  slack_action_create_channel: {
    workspace: "slack_workspaces",
    addPeople: "slack_users",
  },
  slack_action_get_messages: {
    channel: "slack_channels",
  },
  slack_action_add_reaction: {
    channel: "slack_channels",
    emoji: "slack_emoji_catalog",
  },
  slack_action_remove_reaction: {
    channel: "slack_channels",
    emoji: "slack_emoji_catalog",
  },
  slack_action_archive_channel: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_unarchive_channel: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_cancel_scheduled_message: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_delete_message: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
    user: "slack_users",
  },
  slack_action_get_channel_info: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_get_thread_messages: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_join_channel: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_leave_channel: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_list_scheduled_messages: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_pin_message: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_unpin_message: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_post_interactive: {
    channel: "slack_channels",
  },
  slack_action_rename_channel: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_schedule_message: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_set_channel_purpose: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_set_channel_topic: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_update_message: {
    workspace: "slack_workspaces",
    channel: "slack_channels",
  },
  slack_action_upload_file: {
    workspace: "slack_workspaces",
    channels: "slack_channels",
  },
  slack_action_download_file: {
    workspace: "slack_workspaces",
    fileId: "slack_files",
  },
  slack_action_get_file_info: {
    workspace: "slack_workspaces",
    fileId: "slack_files",
  },
  slack_action_list_users: {
    workspace: "slack_workspaces",
  },
  slack_action_list_channels: {
    workspace: "slack_workspaces",
  },
  slack_action_find_user: {
    workspace: "slack_workspaces",
    user: "slack_users",
  },
  slack_trigger_message_channels: {
    channel: "slack_public_channels",
  },
  slack_trigger_message_groups: {
    channel: "slack_private_channels",
  },
  slack_trigger_reaction_added: {
    channel: "slack_channels",
    emoji: "slack_emoji_catalog",
  },
  slack_trigger_reaction_removed: {
    channel: "slack_channels",
  },
  slack_trigger_member_joined_channel: {
    channel: "slack_channels",
  },
  slack_trigger_member_left_channel: {
    channel: "slack_channels",
  },
};

// Trello field mappings
const trelloMappings: Record<string, FieldMapping> = {
  trello_trigger_new_card: {
    boardId: "trello_boards",
    listId: "trello_lists",
  },
  trello_trigger_card_updated: {
    boardId: "trello_boards",
    listId: "trello_lists",
  },
  trello_trigger_card_moved: {
    boardId: "trello_boards",
    watchedLists: "trello_lists",
  },
  trello_trigger_comment_added: {
    boardId: "trello_boards",
    listId: "trello_lists",
    cardId: "trello_cards",
  },
  trello_trigger_member_changed: {
    boardId: "trello_boards",
  },
  trello_action_create_card: {
    boardId: "trello_boards",
    listId: "trello_lists",
    idMembers: "trello_board_members",
    idLabels: "trello_board_labels",
    idCardSource: "trello_all_cards",
  },
  trello_action_create_board: {
    template: "trello_board_templates",
    sourceBoardId: "trello_boards",
  },
  trello_action_create_list: {
    boardId: "trello_boards",
  },
  trello_action_move_card: {
    boardId: "trello_boards",
    cardId: "trello_cards",
    listId: "trello_lists",
  },
  trello_action_get_cards: {
    boardId: "trello_boards",
    listId: "trello_lists",
  },
  trello_action_update_card: {
    boardId: "trello_boards",
    cardId: "trello_cards",
    listId: "trello_lists",
  },
  trello_action_archive_card: {
    boardId: "trello_boards",
    cardId: "trello_cards",
  },
  trello_action_add_comment: {
    boardId: "trello_boards",
    cardId: "trello_cards",
  },
  trello_trigger_card_archived: {
    boardId: "trello_boards",
  },
  trello_action_add_label_to_card: {
    boardId: "trello_boards",
    cardId: "trello_cards",
    labelId: "trello_board_labels",
  },
  trello_action_add_checklist: {
    boardId: "trello_boards",
    cardId: "trello_cards",
  },
  trello_action_create_checklist_item: {
    boardId: "trello_boards",
    cardId: "trello_cards",
    checklistId: "trello_card_checklists",
  },
};

// Google Calendar field mappings
const googleCalendarMappings: Record<string, FieldMapping> = {
  google_calendar_action_create_event: {
    calendarId: "google-calendars",
    // Note: attendees is a simple email list, doesn't need dynamic loading
    // Removed mapping to avoid dependency on Gmail integration
  },
  google_calendar_action_move_event: {
    sourceCalendarId: "google-calendars",
    destinationCalendarId: "google-calendars",
  },
  google_calendar_trigger_new_event: {
    calendars: "google-calendars",
  },
  google_calendar_trigger_event_updated: {
    calendars: "google-calendars",
  },
  google_calendar_trigger_event_canceled: {
    calendars: "google-calendars",
  },
};

// Google Sheets field mappings
const googleSheetsMappings: Record<string, FieldMapping> = {
  // Triggers
  google_sheets_trigger_new_row: {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
    requiredColumns: "google-sheets_columns",
  },
  google_sheets_trigger_new_worksheet: {
    spreadsheetId: "google-sheets_spreadsheets",
  },
  google_sheets_trigger_updated_row: {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
    requiredColumns: "google-sheets_columns",
  },
  // Actions
  google_sheets_unified_action: {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  "google-sheets_action_create_row": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  "google-sheets_action_update_row": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
    matchColumn: "google-sheets_columns",
  },
  "google-sheets_action_delete_row": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
    matchColumn: "google-sheets_columns",
  },
  "google-sheets_action_list_rows": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
    filterColumn: "google-sheets_columns",
    filterValue: "google-sheets_column_values",
    sortColumn: "google-sheets_columns",
    dateColumn: "google-sheets_columns",
  },
  "google-sheets_action_export_sheet": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
    filterColumn: "google-sheets_columns",
    filterValue: "google-sheets_column_values",
    sortColumn: "google-sheets_columns",
    dateColumn: "google-sheets_columns",
  },
  "google_sheets_action_find_row": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
    searchColumn: "google-sheets_columns",
  },
  // Cell-level actions
  "google_sheets_action_update_cell": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  "google_sheets_action_get_cell_value": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  // Append row action
  "google_sheets_action_append_row": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  // Update row action (underscore version)
  "google_sheets_action_update_row": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  // Delete row action (underscore version)
  "google_sheets_action_delete_row": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  // Clear range action
  "google_sheets_action_clear_range": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  // Format range action
  "google_sheets_action_format_range": {
    spreadsheetId: "google-sheets_spreadsheets",
    sheetName: "google-sheets_sheets",
  },
  // Batch update action
  "google_sheets_action_batch_update": {
    spreadsheetId: "google-sheets_spreadsheets",
  },
  // Create spreadsheet action (no spreadsheet selector needed - creates new)
  "google_sheets_action_create_spreadsheet": {},
};

// Google Drive field mappings
const googleDriveMappings: Record<string, FieldMapping> = {
  "google-drive:new_file_in_folder": {
    folderId: "google-drive-folders",
    createdByEmail: "gmail-enhanced-recipients",
  },
  "google-drive:new_folder_in_folder": {
    folderId: "google-drive-folders",
    parentFolderId: "google-drive-folders",
  },
  "google-drive:upload_file": {
    folderId: "google-drive-folders",
  },
  "google-drive:create_folder": {
    parentFolderId: "google-drive-folders",
  },
  "google-drive:create_file": {
    folderId: "google-drive-folders",
  },
  "google-drive:file_updated": {
    fileId: "google-drive-files",
  },
  google_drive_action_upload_file: {
    folderId: "google-drive-folders",
  },
  "google-drive:get_file": {
    folderId: "google-drive-folders",
    fileId: "google-drive-files",
  },
  "google-drive:share_file": {
    fileId: "google-drive-files",
    emailAddress: "gmail-enhanced-recipients",
  },
  "google-drive:move_file": {
    fileId: "google-drive-files-and-folders",
    destinationFolderId: "google-drive-folders",
  },
  "google-drive:copy_file": {
    fileId: "google-drive-files",
    destinationFolderId: "google-drive-folders",
  },
  "google-drive:delete_file": {
    fileId: "google-drive-files-and-folders",
  },
  "google-drive:search_files": {
    searchPreview: "google-drive-search-preview",
  },
};

// Google Docs field mappings
const googleDocsMappings: Record<string, FieldMapping> = {
  google_docs_action_create_document: {
    folderId: "google-drive-folders",
  },
  google_docs_action_update_document: {
    documentId: "google-docs-documents",
  },
  google_docs_action_share_document: {
    documentId: "google-docs-documents",
  },
  google_docs_action_get_document: {
    documentId: "google-docs-documents",
  },
  google_docs_trigger_new_document: {
    folderId: "google-drive-folders",
  },
  google_docs_trigger_document_modified: {
    documentId: "google-docs-documents",
    folderId: "google-drive-folders",
  },
  google_docs_trigger_document_updated: {
    documentId: "google-docs-documents",
    folderId: "google-drive-folders",
  },
};

// Airtable field mappings
const airtableMappings: Record<string, FieldMapping> = {
  airtable_action_create_record: {
    baseId: "airtable_bases",
    tableName: "airtable_tables",
    draftName: "airtable_draft_names",
    designer: "airtable_designers",
    associatedProject: "airtable_projects",
    feedback: "airtable_feedback",
    tasks: "airtable_tasks",
  },
  airtable_action_create_multiple_records: {
    baseId: "airtable_bases",
    tableName: "airtable_tables",
    errorTableBase: "airtable_bases",
    errorTable: "airtable_tables",
    errorRecordNameField: "airtable_fields",
    errorMessageField: "airtable_fields",
    errorTimestampField: "airtable_fields",
  },
  airtable_action_update_record: {
    baseId: "airtable_bases",
    tableName: "airtable_tables",
  },
  airtable_action_list_records: {
    baseId: "airtable_bases",
    tableName: "airtable_tables",
    filterField: "airtable_fields",
    filterValue: "airtable_field_values",
  },
  airtable_action_find_record: {
    baseId: "airtable_bases",
    tableName: "airtable_tables",
    searchField: "airtable_fields",
    searchValue: "airtable_search_field_values",
  },
  airtable_trigger_new_record: {
    baseId: "airtable_bases",
    tableName: "airtable_tables",
  },
  airtable_trigger_record_updated: {
    baseId: "airtable_bases",
    tableName: "airtable_tables",
    watchedFieldIds: "airtable_fields",
  },
  airtable_trigger_table_deleted: {
    baseId: "airtable_bases",
    watchedTables: "airtable_tables",
  },
};

// Dropbox field mappings
const dropboxMappings: Record<string, FieldMapping> = {
  dropbox_action_upload_file: {
    path: "dropbox-folders",
  },
  dropbox_trigger_new_file: {
    path: "dropbox-folders",
  },
  dropbox_action_get_file: {
    path: "dropbox-folders",
    filePath: "dropbox-files",
  },
};

// Microsoft Outlook field mappings
const outlookMappings: Record<string, FieldMapping> = {
  // Email Triggers
  "microsoft-outlook_trigger_new_email": {
    from: "outlook-enhanced-recipients",
    folder: "outlook_folders",
  },
  "microsoft-outlook_trigger_email_sent": {
    to: "outlook-enhanced-recipients",
  },
  "microsoft-outlook_trigger_email_flagged": {
    folder: "outlook_folders",
  },

  // Calendar Triggers
  "microsoft-outlook_trigger_new_calendar_event": {
    calendarId: "outlook_calendars",
  },
  "microsoft-outlook_trigger_updated_calendar_event": {
    calendarId: "outlook_calendars",
  },
  "microsoft-outlook_trigger_deleted_calendar_event": {
    calendarId: "outlook_calendars",
  },
  "microsoft-outlook_trigger_calendar_event_start": {
    calendarId: "outlook_calendars",
  },

  // Contact Triggers
  "microsoft-outlook_trigger_new_contact": {},
  "microsoft-outlook_trigger_updated_contact": {},

  // Email Actions
  "microsoft-outlook_action_send_email": {
    to: "outlook-enhanced-recipients",
    cc: "outlook-enhanced-recipients",
    bcc: "outlook-enhanced-recipients",
  },
  "microsoft-outlook_action_reply_to_email": {
    emailId: "outlook_messages",
  },
  "microsoft-outlook_action_forward_email": {
    emailId: "outlook_messages",
    to: "outlook-enhanced-recipients",
    cc: "outlook-enhanced-recipients",
  },
  "microsoft-outlook_action_create_draft_email": {
    to: "outlook-enhanced-recipients",
    cc: "outlook-enhanced-recipients",
    bcc: "outlook-enhanced-recipients",
  },
  "microsoft-outlook_action_move_email": {
    emailId: "outlook_messages",
    destinationFolderId: "outlook_folders",
  },
  "microsoft-outlook_action_delete_email": {
    emailId: "outlook_messages",
  },
  "microsoft-outlook_action_add_categories": {
    emailId: "outlook_messages",
  },
  "microsoft-outlook_action_fetch_emails": {
    folderId: "outlook_folders",
  },

  // Calendar Actions
  "microsoft-outlook_action_create_calendar_event": {
    attendees: "outlook-enhanced-recipients",
    calendarId: "outlook_calendars",
  },
  "microsoft-outlook_action_update_calendar_event": {
    calendarId: "outlook_calendars",
    eventId: "outlook_calendar_events",
    attendees: "outlook-enhanced-recipients",
  },
  "microsoft-outlook_action_delete_calendar_event": {
    calendarId: "outlook_calendars",
    eventId: "outlook_calendar_events",
  },
  "microsoft-outlook_action_add_attendees": {
    calendarId: "outlook_calendars",
    eventId: "outlook_calendar_events",
    attendees: "outlook-enhanced-recipients",
  },
  "microsoft-outlook_action_get_calendar_events": {
    calendarId: "outlook_calendars",
  },

  // Contact Actions
  "microsoft-outlook_action_create_contact": {},
  "microsoft-outlook_action_update_contact": {
    contactId: "outlook_contacts",
  },
  "microsoft-outlook_action_delete_contact": {
    contactId: "outlook_contacts",
  },
  "microsoft-outlook_action_find_contact": {},

  // Attachment Actions
  "microsoft-outlook_action_get_attachment": {
    emailId: "outlook_messages",
  },
};

// Microsoft Teams field mappings
const teamsMappings: Record<string, FieldMapping> = {
  "teams_trigger_new_message": {
    teamId: "teams_teams",
    channelId: "teams_channels",
  },
  "teams_trigger_new_reply": {
    teamId: "teams_teams",
    channelId: "teams_channels",
  },
  "teams_trigger_channel_mention": {
    teamId: "teams_teams",
    channelId: "teams_channels",
  },
  "teams_trigger_new_chat_message": {
    chatId: "teams_chats",
  },
  "teams_trigger_new_channel": {
    teamId: "teams_teams",
  },
  "teams_trigger_user_joins_team": {
    teamId: "teams_teams",
  },
  "teams_action_send_message": {
    teamId: "teams_teams",
    channelId: "teams_channels",
  },
  "teams_action_send_chat_message": {
    chatId: "teams_chats",
  },
  "teams_action_create_channel": {
    teamId: "teams_teams",
  },
  "teams_action_add_member_to_team": {
    teamId: "teams_teams",
    userEmail: "teams_users",
  },
  "teams_action_send_adaptive_card": {
    teamId: "teams_teams",
    channelId: "teams_channels",
  },
  "teams_action_get_team_members": {
    teamId: "teams_teams",
  },
  "teams_action_reply_to_message": {
    teamId: "teams_teams",
    channelId: "teams_channels",
    messageId: "teams_messages",
  },
  "teams_action_edit_message": {
    teamId: "teams_teams",
    channelId: "teams_channels",
    chatId: "teams_chats",
    messageId: "teams_messages_own",
    chatMessageId: "teams_messages_own",
  },
  "teams_action_find_message": {
    teamId: "teams_teams",
    channelId: "teams_channels",
    chatId: "teams_chats",
    messageId: "teams_messages",
    chatMessageId: "teams_messages",
  },
  "teams_action_delete_message": {
    teamId: "teams_teams",
    channelId: "teams_channels",
    chatId: "teams_chats",
    messageId: "teams_messages_own",
    chatMessageId: "teams_messages_own",
  },
  "teams_action_get_channel_details": {
    teamId: "teams_teams",
    channelId: "teams_channels",
  },
  "teams_action_add_reaction": {
    teamId: "teams_teams",
    channelId: "teams_channels",
    chatId: "teams_chats",
    messageId: "teams_messages",
    chatMessageId: "teams_messages",
  },
  "teams_action_remove_reaction": {
    teamId: "teams_teams",
    channelId: "teams_channels",
    chatId: "teams_chats",
    messageId: "teams_messages",
    chatMessageId: "teams_messages",
  },
  "microsoft-teams_action_add_team_member": {
    userEmail: "outlook-enhanced-recipients",
    teamId: "teams_teams",
  },
  "teams_action_schedule_meeting": {
    attendees: "outlook-enhanced-recipients",
  },
  "teams_action_end_meeting": {
    meetingId: "teams_online_meetings",
  },
  "teams_action_update_meeting": {
    meetingId: "teams_online_meetings",
  },
};

// Microsoft OneNote field mappings
const onenoteMappings: Record<string, FieldMapping> = {
  "microsoft-onenote_action_create_page": {
    notebookId: "onenote_notebooks",
    sectionId: "onenote_sections",
  },
  "microsoft-onenote_action_create_section": {
    notebookId: "onenote_notebooks",
  },
  "microsoft-onenote_action_update_page": {
    notebookId: "onenote_notebooks",
    sectionId: "onenote_sections",
    pageId: "onenote_pages",
  },
  "microsoft-onenote_action_get_page_content": {
    notebookId: "onenote_notebooks",
    sectionId: "onenote_sections",
    pageId: "onenote_pages",
  },
  "microsoft-onenote_action_list_pages": {
    notebookId: "onenote_notebooks",
    sectionId: "onenote_sections",
  },
  "microsoft-onenote_action_copy_page": {
    sourceNotebookId: "onenote_notebooks",
    sourceSectionId: "onenote_sections",
    sourcePageId: "onenote_pages",
    targetNotebookId: "onenote_notebooks",
    targetSectionId: "onenote_sections",
  },
  "microsoft-onenote_action_delete_page": {
    notebookId: "onenote_notebooks",
    sectionId: "onenote_sections",
    pageId: "onenote_pages",
  },
  // NOTE: delete_section and delete_notebook are NOT supported by Microsoft Graph API
  "microsoft-onenote_action_list_sections": {
    notebookId: "onenote_notebooks",
  },
  "microsoft-onenote_action_get_notebook_details": {
    notebookId: "onenote_notebooks",
  },
  "microsoft-onenote_action_get_section_details": {
    notebookId: "onenote_notebooks",
    sectionId: "onenote_sections",
  },
};

// OneDrive field mappings
const onedriveMappings: Record<string, FieldMapping> = {
  "onedrive_action_upload_file": {
    folderId: "onedrive-folders",
  },
  "onedrive_trigger_new_file": {
    folderId: "onedrive-folders",
  },
  "onedrive_trigger_file_modified": {
    folderId: "onedrive-folders",
    fileId: "onedrive-files",
  },
  "onedrive_action_get_file": {
    folderId: "onedrive-folders",
    fileId: "onedrive-files",
  },
  "onedrive_action_create_folder": {
    parentFolderId: "onedrive-folders",
  },
  "onedrive_action_delete_item": {
    folderId: "onedrive-folders",
    fileId: "onedrive-files",
    folderIdToDelete: "onedrive-folders",
  },
  "onedrive_action_copy_item": {
    sourceFolderId: "onedrive-folders",
    sourceFileId: "onedrive-files",
    sourceFolderIdToCopy: "onedrive-folders",
    destinationFolderId: "onedrive-folders",
  },
  "onedrive_action_move_item": {
    sourceFolderId: "onedrive-folders",
    sourceFileId: "onedrive-files",
    sourceFolderIdToMove: "onedrive-folders",
    destinationFolderId: "onedrive-folders",
  },
  "onedrive_action_rename_item": {
    folderId: "onedrive-folders",
    fileId: "onedrive-files",
    folderIdToRename: "onedrive-folders",
  },
  "onedrive_action_create_sharing_link": {
    folderId: "onedrive-folders",
    fileId: "onedrive-files",
    folderIdToShare: "onedrive-folders",
  },
  "onedrive_action_send_sharing_invitation": {
    folderId: "onedrive-folders",
    fileId: "onedrive-files",
    folderIdToShare: "onedrive-folders",
  },
  "onedrive_action_search_files": {
    searchScope: "onedrive-folders",
  },
};

// Microsoft Excel field mappings
const microsoftExcelMappings: Record<string, FieldMapping> = {
  "microsoft-excel_action_export_sheet": {
    workbookId: "microsoft-excel_workbooks",
    worksheetName: "microsoft-excel_worksheets",
    filterColumn: "microsoft-excel_columns",
    filterValue: "microsoft-excel_column_values",
    sortColumn: "microsoft-excel_columns",
    dateColumn: "microsoft-excel_columns",
  },
  "microsoft_excel_action_create_workbook": {
    folderPath: "microsoft-excel_folders",
  },
  "microsoft_excel_action_add_row": {
    workbookId: "microsoft-excel_workbooks",
    worksheetName: "microsoft-excel_worksheets",
    columnMapping: "microsoft-excel_columns",
  },
  "microsoft_excel_trigger_new_row": {
    workbookId: "microsoft-excel_workbooks",
    worksheetName: "microsoft-excel_worksheets",
  },
  "microsoft_excel_trigger_new_worksheet": {
    workbookId: "microsoft-excel_workbooks",
  },
  "microsoft_excel_trigger_updated_row": {
    workbookId: "microsoft-excel_workbooks",
    worksheetName: "microsoft-excel_worksheets",
  },
  "microsoft_excel_trigger_new_table_row": {
    workbookId: "microsoft-excel_workbooks",
    tableName: "microsoft-excel_tables",
  },
  "microsoft_excel_action_add_table_row": {
    workbookId: "microsoft-excel_workbooks",
    tableName: "microsoft-excel_tables",
    columnMapping: "microsoft_excel_column_mapper",
  },
  "microsoft_excel_action_create_worksheet": {
    workbookId: "microsoft-excel_workbooks",
  },
  "microsoft_excel_action_rename_worksheet": {
    workbookId: "microsoft-excel_workbooks",
    worksheetName: "microsoft-excel_worksheets",
  },
  "microsoft_excel_action_delete_worksheet": {
    workbookId: "microsoft-excel_workbooks",
    worksheetName: "microsoft-excel_worksheets",
  },
  "microsoft_excel_action_add_multiple_rows": {
    workbookId: "microsoft-excel_workbooks",
    worksheetName: "microsoft-excel_worksheets",
    columnMapping: "microsoft_excel_column_mapper",
  },
};

// Facebook field mappings
const facebookMappings: Record<string, FieldMapping> = {
  facebook_action_create_post: {
    pageId: "facebook_pages",
    shareToGroups: "facebook_groups",
  },
  facebook_action_get_page_insights: {
    pageId: "facebook_pages",
  },
  facebook_action_send_message: {
    pageId: "facebook_pages",
    recipientId: "facebook_conversations",
  },
  facebook_action_comment_on_post: {
    pageId: "facebook_pages",
    postId: "facebook_posts",
  },
  facebook_action_delete_post: {
    pageId: "facebook_pages",
    postId: "facebook_posts",
  },
  facebook_action_update_post: {
    pageId: "facebook_pages",
    postId: "facebook_posts",
  },
  facebook_action_upload_photo: {
    pageId: "facebook_pages",
    targetAlbum: "facebook_albums",
  },
  facebook_action_upload_video: {
    pageId: "facebook_pages",
  },
};

// Box field mappings
const boxMappings: Record<string, FieldMapping> = {
  box_action_get_file: {
    folderId: "box-folders",
    fileId: "box-files",
  },
  box_action_upload_file: {
    path: "box-folders",
  },
};

// Mailchimp field mappings
const mailchimpMappings: Record<string, FieldMapping> = {
  // Triggers
  mailchimp_trigger_new_subscriber: {
    audienceId: "mailchimp_audiences",
  },
  mailchimp_trigger_link_clicked: {
    campaignId: "mailchimp_campaigns",
  },
  mailchimp_trigger_unsubscribed: {
    audienceId: "mailchimp_audiences",
  },
  mailchimp_trigger_new_campaign: {
    audienceId: "mailchimp_audiences",
  },
  mailchimp_trigger_campaign_created: {
    audienceId: "mailchimp_audiences",
  },
  mailchimp_trigger_subscriber_added_to_segment: {
    audienceId: "mailchimp_audiences",
    segmentId: "mailchimp_tag_segments",
  },
  mailchimp_trigger_subscriber_updated: {
    audienceId: "mailchimp_audiences",
  },
  mailchimp_trigger_segment_updated: {
    audienceId: "mailchimp_audiences",
    segmentId: "mailchimp_segments",
  },
  mailchimp_trigger_new_audience: {
    // No dynamic fields
  },
  mailchimp_trigger_email_opened: {
    campaignId: "mailchimp_campaigns",
  },

  // Actions
  mailchimp_action_get_subscribers: {
    audience_id: "mailchimp_audiences",
  },
  mailchimp_action_add_subscriber: {
    audience_id: "mailchimp_audiences",
  },
  mailchimp_action_add_note: {
    audience_id: "mailchimp_audiences",
  },
  mailchimp_action_update_subscriber: {
    audience_id: "mailchimp_audiences",
    subscriber_email: "mailchimp_subscribers",
  },
  mailchimp_action_remove_subscriber: {
    audience_id: "mailchimp_audiences",
  },
  mailchimp_action_add_tag: {
    audience_id: "mailchimp_audiences",
    tags: "mailchimp_tags",
  },
  mailchimp_action_remove_tag: {
    audience_id: "mailchimp_audiences",
    tags: "mailchimp_tags",
  },
  mailchimp_action_create_campaign: {
    audience_id: "mailchimp_audiences",
  },
  mailchimp_action_send_campaign: {
    campaign_id: "mailchimp_campaigns",
  },
  mailchimp_action_create_audience: {
    // No dynamic fields - creates new audience
  },
  mailchimp_action_create_event: {
    audience_id: "mailchimp_audiences",
  },
  mailchimp_action_get_subscriber: {
    audience_id: "mailchimp_audiences",
  },
  mailchimp_action_get_campaign: {
    campaign_id: "mailchimp_campaigns",
  },
  mailchimp_action_get_campaign_stats: {
    campaign_id: "mailchimp_campaigns",
  },
  mailchimp_action_schedule_campaign: {
    campaign_id: "mailchimp_campaigns",
  },
  mailchimp_action_unsubscribe_subscriber: {
    audience_id: "mailchimp_audiences",
  },
  mailchimp_action_create_segment: {
    audience_id: "mailchimp_audiences",
  },
};

// Monday.com field mappings
const mondayMappings: Record<string, FieldMapping> = {
  // Actions
  monday_action_create_item: {
    boardId: "monday_boards",
    groupId: "monday_groups",
  },
  monday_action_update_item: {
    boardId: "monday_boards",
    itemId: "monday_items",
    columnId: "monday_columns",
  },
  monday_action_create_update: {
    boardId: "monday_boards",
    itemId: "monday_items",
  },
  monday_action_move_item: {
    sourceBoardId: "monday_boards",
    itemId: "monday_items",
    targetBoardId: "monday_boards",
    targetGroupId: "monday_groups",
  },
  monday_action_duplicate_item: {
    boardId: "monday_boards",
    itemId: "monday_items",
    targetBoardId: "monday_boards",
    targetGroupId: "monday_groups",
  },
  monday_action_archive_item: {
    boardId: "monday_boards",
    itemId: "monday_items",
  },
  monday_action_delete_item: {
    boardId: "monday_boards",
    itemId: "monday_items",
  },
  monday_action_create_subitem: {
    boardId: "monday_boards",
    parentItemId: "monday_items",
  },
  monday_action_list_items: {
    boardId: "monday_boards",
    groupId: "monday_groups",
  },
  monday_action_list_subitems: {
    boardId: "monday_boards",
    parentItemId: "monday_items",
  },
  monday_action_list_updates: {
    boardId: "monday_boards",
    itemId: "monday_items",
  },
  monday_action_get_item: {
    boardId: "monday_boards",
    itemId: "monday_items",
  },
  monday_action_get_board: {
    boardId: "monday_boards",
  },
  monday_action_list_groups: {
    boardId: "monday_boards",
  },
  monday_action_create_group: {
    boardId: "monday_boards",
  },
  monday_action_duplicate_board: {
    boardId: "monday_boards",
  },
  monday_action_add_column: {
    boardId: "monday_boards",
  },
  monday_action_add_file: {
    boardId: "monday_boards",
    itemId: "monday_items",
    columnId: "monday_columns",
  },
  monday_action_download_file: {
    boardId: "monday_boards",
    itemId: "monday_items",
    columnId: "monday_file_columns",
  },
  monday_action_search_items: {
    boardId: "monday_boards",
    columnId: "monday_columns",
    groupId: "monday_groups",
  },
  // Triggers
  monday_trigger_new_item: {
    boardId: "monday_boards",
  },
  monday_trigger_column_changed: {
    boardId: "monday_boards",
    columnId: "monday_columns",
  },
  monday_trigger_item_moved: {
    boardId: "monday_boards",
    targetGroupId: "monday_groups",
  },
  monday_trigger_new_update: {
    boardId: "monday_boards",
    itemId: "monday_items",
  },
  monday_trigger_new_subitem: {
    boardId: "monday_boards",
    parentItemId: "monday_items",
  },
  monday_action_get_user: {
    userId: "monday_users",
  },
};

// HubSpot field mappings
const hubspotMappings: Record<string, FieldMapping> = {
  // Triggers
  hubspot_trigger_contact_created: {
    filterByOwner: "hubspot_owners",
  },
  hubspot_trigger_contact_updated: {
    propertyName: "hubspot_contact_properties",
  },
  hubspot_trigger_company_created: {
    filterByOwner: "hubspot_owners",
  },
  hubspot_trigger_company_updated: {
    propertyName: "hubspot_company_properties",
  },
  hubspot_trigger_deal_created: {
    filterByPipeline: "hubspot_pipelines",
  },
  hubspot_trigger_deal_updated: {
    propertyName: "hubspot_deal_properties",
  },
  hubspot_trigger_ticket_created: {
    filterByPipeline: "hubspot_ticket_pipelines",
  },
  hubspot_trigger_ticket_updated: {
    propertyName: "hubspot_ticket_properties",
    filterByPipeline: "hubspot_ticket_pipelines",
  },
  hubspot_trigger_ticket_deleted: {
    filterByPipeline: "hubspot_ticket_pipelines",
  },
  // Actions
  hubspot_action_create_contact: {
    associatedCompanyId: "hubspot_companies",
    jobtitle: "hubspot_job_titles",
    department: "hubspot_departments",
    industry: "hubspot_industries",
    hs_lead_status: "hubspot_lead_status_options",
    favorite_content_topics: "hubspot_content_topics_options",
    preferred_channels: "hubspot_preferred_channels_options",
    selectedProperties: "hubspot_contact_properties",
  },
  hubspot_action_create_deal: {
    associatedContactId: "hubspot_contacts",
    associatedCompanyId: "hubspot_companies",
  },
  hubspot_action_add_contact_to_list: {
    listId: "hubspot_lists",
  },
  hubspot_action_update_deal: {
    dealId: "hubspot_deals",
  },
  hubspot_action_update_contact: {
    contactId: "hubspot_contacts",
    hubspot_owner_id: "hubspot_owners",
    hs_lead_status: "hubspot_lead_status_options",
    selectedProperties: "hubspot_contact_properties"
  },
  hubspot_action_update_company: {
    companyId: "hubspot_companies",
    hubspot_owner_id: "hubspot_owners",
  },
  hubspot_action_get_tickets: {
    filterPipeline: "hubspot_ticket_pipelines",
    filterStage: "hubspot_ticket_stages",
    filterProperty: "hubspot_ticket_properties",
    properties: "hubspot_ticket_properties",
  },
  hubspot_action_get_owners: {
    email: "hubspot_owners",
  },
  hubspot_action_create_line_item: {
    dealId: "hubspot_deals",
    productId: "hubspot_products",
  },
  hubspot_action_update_line_item: {
    lineItemId: "hubspot_line_items",
  },
  hubspot_action_remove_line_item: {
    lineItemId: "hubspot_line_items",
  },
  hubspot_action_get_contacts: {
    filterProperty: "hubspot_contact_properties",
    properties: "hubspot_contact_properties",
  },
  hubspot_action_get_companies: {
    filterProperty: "hubspot_company_properties",
    properties: "hubspot_company_properties",
  },
  hubspot_action_get_deals: {
    filterProperty: "hubspot_deal_properties",
    sortProperty: "hubspot_deal_properties",
    advancedFilters: "hubspot_deal_properties",
    properties: "hubspot_deal_properties",
  },
  hubspot_action_get_products: {
    filterProperty: "hubspot_product_properties",
    properties: "hubspot_product_properties",
  },
  hubspot_action_update_product: {
    productId: "hubspot_products",
  },
  // Dynamic HubSpot object actions
  hubspot_action_create_object: {
    objectType: "hubspot_objects",
    properties: "hubspot_object_properties", // Dynamic based on objectType
  },
  hubspot_action_update_object: {
    objectType: "hubspot_objects",
    recordId: "hubspot_object_records", // Dynamic based on objectType
    properties: "hubspot_object_properties", // Dynamic based on objectType
  },
  hubspot_action_upsert_object: {
    objectType: "hubspot_objects",
    identifierProperty: "hubspot_object_identifier_properties", // Dynamic based on objectType
    properties: "hubspot_object_properties", // Dynamic based on objectType
  },
};

// AI Agent field mappings
const aiMappings: Record<string, FieldMapping> = {
  ai_agent: {
    inputNodeId: "previous_nodes",
    memoryIntegration: "connected_integrations",
    customMemoryIntegrations: "connected_integrations",
  },
};

// Notion field mappings
const notionMappings: Record<string, FieldMapping> = {
  notion_action_retrieve_page: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  // notion_action_archive_page: Removed - use notion_action_archive_database_item instead
  notion_action_query_database: {
    workspace: "notion_workspaces",
    database_id: "notion_databases",
  },
  notion_action_update_database: {
    workspace: "notion_workspaces",
    database_id: "notion_databases",
  },
  notion_action_append_blocks: {
    workspace: "notion_workspaces",
    page_id: "notion_pages",
    after: "notion_page_blocks",
  },
  notion_action_update_block: {
    workspace: "notion_workspaces",
    page_id: "notion_pages",
    block_id: "notion_page_blocks",
  },
  notion_action_delete_block: {
    workspace: "notion_workspaces",
    page_id: "notion_pages",
    block_id: "notion_page_blocks",
  },
  notion_action_retrieve_block_children: {
    block_id: "notion_blocks",
  },
  notion_action_list_users: {
    workspace: "notion_workspaces",
  },
  notion_action_retrieve_user: {
    workspace: "notion_workspaces",
    user_id: "notion_users",
  },
  notion_action_create_comment: {
    workspace: "notion_workspaces",
    page_id: "notion_pages",
    parent_id: "notion_blocks",
  },
  notion_action_retrieve_comments: {
    block_id: "notion_blocks",
  },
  notion_action_search: {
    workspace: "notion_workspaces",
  },
  notion_action_duplicate_page: {
    workspace: "notion_workspaces",
    source_page_id: "notion_pages",
    destination_page_id: "notion_pages",
    destination_database_id: "notion_databases",
  },
  notion_action_sync_database_entries: {
    workspace: "notion_workspaces",
    database_id: "notion_databases",
  },
  // Page Actions - separate page actions from unified actions
  notion_action_update_page: {
    workspace: "notion_workspaces",
    page: "notion_pages",
    pageFields: "notion_page_blocks",
  },
  notion_action_delete_page_content: {
    workspace: "notion_workspaces",
    page: "notion_pages",
    blocksToDelete: "notion_page_blocks_deletable",
  },
  notion_action_search_pages: {
    filter: "notion_filter_types",
  },
  // Single-purpose create-page action used by predefined templates and the
  // AI workflow generators. Parallel to notion_action_manage_page (unified
  // create/update/delete) — both are live; templates default to this simpler
  // shape because it has fewer required fields.
  notion_action_create_page: {
    workspace: "notion_workspaces",
    parentDatabase: "notion_databases",
    parentPage: "notion_pages",
  },
  notion_action_append_to_page: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  notion_action_get_page_details: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  // notion_action_archive_page: Removed - use notion_action_archive_database_item instead
  notion_action_duplicate_page: {
    workspace: "notion_workspaces",
    page: "notion_pages",
    destinationPage: "notion_pages",
  },
  // Unified Notion actions
  notion_action_manage_page: {
    workspace: "notion_workspaces",
    page: "notion_pages",
    database: "notion_databases",
    parentDatabase: "notion_databases",
    parentPage: "notion_pages",
    destinationPage: "notion_pages",
    pageFields: "notion_page_blocks",
  },
  notion_action_manage_database: {
    workspace: "notion_workspaces",
    database: "notion_databases",
  },
  // New separate database actions
  notion_action_create_database: {
    workspace: "notion_workspaces",
    parentPage: "notion_pages",
  },
  notion_action_update_database_info: {
    workspace: "notion_workspaces",
    database: "notion_databases",
  },
  notion_action_query_database: {
    workspace: "notion_workspaces",
    database: "notion_databases",
  },
  notion_action_find_or_create_item: {
    workspace: "notion_workspaces",
    database: "notion_databases",
    searchProperty: "notion_database_properties",
    createProperties: "notion_database_properties",
  },
  notion_action_update_database_item: {
    workspace: "notion_workspaces",
    database: "notion_databases",
    item: "notion_database_items",
    properties: "notion_database_properties",
  },
  notion_action_archive_database_item: {
    workspace: "notion_workspaces",
    database: "notion_databases",
    itemToArchive: "notion_database_items",
  },
  notion_action_restore_database_item: {
    workspace: "notion_workspaces",
    database: "notion_databases",
    itemToRestore: "notion_archived_items",
  },
  // New separate comment actions
  notion_action_create_comment: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  notion_action_list_comments: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  // New separate user actions
  notion_action_list_users: {
    workspace: "notion_workspaces",
  },
  notion_action_get_user: {
    workspace: "notion_workspaces",
    userId: "notion_users",
  },
  // New separate block actions
  notion_action_add_block: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  notion_action_get_block: {
    workspace: "notion_workspaces",
    page: "notion_pages",
    selectedBlock: "notion_page_blocks_selectable",
  },
  notion_action_get_block_children: {
    workspace: "notion_workspaces",
    page: "notion_pages",
    selectedBlock: "notion_page_blocks_selectable",
  },
  notion_action_get_page_with_children: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  notion_action_manage_users: {
    workspace: "notion_workspaces",
    userId: "notion_users",
  },
  notion_action_manage_comments: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  notion_action_search: {
    workspace: "notion_workspaces",
  },
  notion_action_get_page_details: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  notion_action_advanced_query: {
    workspace: "notion_workspaces",
    database: "notion_databases",
    sortProperty: "notion_database_properties",
  },
  notion_action_manage_blocks: {
    workspace: "notion_workspaces",
    targetPage: "notion_pages",
    pageForChildren: "notion_pages",
  },
  notion_action_get_page_property: {
    workspace: "notion_workspaces",
    page: "notion_pages",
  },
  notion_action_update_database_schema: {
    workspace: "notion_workspaces",
    database: "notion_databases",
  },
};

// HITL (Human-in-the-Loop) field mappings
const hitlMappings: Record<string, FieldMapping> = {
  hitl_conversation: {
    discordGuildId: "discord_guilds",
    discordChannelId: "discord_channels",
  },
};

// GitHub field mappings
const githubMappings: Record<string, FieldMapping> = {
  github_trigger_new_commit: {
    repository: "github_repositories",
    branch: "github_branches",
  },
  github_action_create_issue: {
    repository: "github_repositories",
    assignees: "github_assignees",
    labels: "github_labels",
    milestone: "github_milestones",
  },
  github_action_create_pull_request: {
    repository: "github_repositories",
    head: "github_branches",
    base: "github_branches",
  },
  github_action_add_comment: {
    repository: "github_repositories",
    issueNumber: "github_issues",
  },
};

// Twitter field mappings
const twitterMappings: Record<string, FieldMapping> = {
  twitter_action_reply_to_tweet: {
    tweetId: "twitter_mentions",
  },
  twitter_trigger_search_match: {},
  twitter_trigger_user_tweet: {},
};

// Stripe field mappings
const stripeMappings: Record<string, FieldMapping> = {
  // Triggers - all use stripe_account for multi-account support
  stripe_trigger_new_payment: {
    stripe_account: "stripe_accounts",
  },
  stripe_trigger_customer_created: {
    stripe_account: "stripe_accounts",
  },
  stripe_trigger_subscription_created: {
    stripe_account: "stripe_accounts",
  },
  stripe_trigger_subscription_deleted: {
    stripe_account: "stripe_accounts",
  },
  stripe_trigger_invoice_payment_failed: {
    stripe_account: "stripe_accounts",
  },
  stripe_trigger_new_dispute: {
    stripe_account: "stripe_accounts",
  },
  stripe_trigger_refunded_charge: {
    stripe_account: "stripe_accounts",
  },
  stripe_trigger_subscription_updated: {
    stripe_account: "stripe_accounts",
  },
  stripe_trigger_checkout_session_completed: {
    stripe_account: "stripe_accounts",
  },
  // Actions
  stripe_action_create_customer: {
    payment_method: "stripe_payment_methods",
  },
  stripe_action_update_customer: {
    customerId: "stripe_customers",
    payment_method: "stripe_payment_methods",
    invoice_settings_default_payment_method: "stripe_payment_methods",
  },
  stripe_action_cancel_subscription: {
    subscriptionId: "stripe_subscriptions",
  },
  stripe_action_find_customer: {
    customerId: "stripe_customers",
  },
  stripe_action_create_payment_intent: {
    customerId: "stripe_customers",
  },
  stripe_action_create_invoice: {
    customerId: "stripe_customers",
  },
  stripe_action_create_subscription: {
    customerId: "stripe_customers",
    priceId: "stripe_prices",
  },
  stripe_action_update_subscription: {
    subscriptionId: "stripe_subscriptions",
    priceId: "stripe_prices",
  },
  stripe_action_find_subscription: {
    subscriptionId: "stripe_subscriptions",
  },
  stripe_action_create_checkout_session: {
    customer: "stripe_customers",
  },
  stripe_action_create_refund: {
    paymentIntentId: "stripe_payment_intents",
  },
  stripe_action_find_payment_intent: {
    paymentIntentId: "stripe_payment_intents",
  },
};

// Google Analytics field mappings
// 100% Zapier feature parity + Make.com coverage
const googleAnalyticsMappings: Record<string, FieldMapping> = {
  google_analytics_trigger_goal_completion: {
    accountId: "google-analytics_accounts",
    propertyId: "google-analytics_properties",
    conversionEvent: "google-analytics_conversion_events",
  },
  google_analytics_action_send_event: {
    accountId: "google-analytics_accounts",
    propertyId: "google-analytics_properties",
    measurementId: "google-analytics_measurement_ids",
  },
  google_analytics_action_create_measurement_secret: {
    accountId: "google-analytics_accounts",
    propertyId: "google-analytics_properties",
  },
  google_analytics_action_run_report: {
    accountId: "google-analytics_accounts",
    propertyId: "google-analytics_properties",
  },
  google_analytics_action_find_conversion: {
    accountId: "google-analytics_accounts",
    propertyId: "google-analytics_properties",
  },
  google_analytics_action_create_conversion_event: {
    accountId: "google-analytics_accounts",
    propertyId: "google-analytics_properties",
  },
  google_analytics_action_run_pivot_report: {
    accountId: "google-analytics_accounts",
    propertyId: "google-analytics_properties",
  },
};

// Gumroad field mappings
const gumroadMappings: Record<string, FieldMapping> = {
  // Triggers
  gumroad_trigger_new_sale: {
    product: "gumroad_products",
  },
  gumroad_trigger_new_subscriber: {
    product: "gumroad_products",
  },
  gumroad_trigger_subscription_cancelled: {
    product: "gumroad_products",
  },
  gumroad_trigger_sale_refunded: {
    product: "gumroad_products",
  },
  gumroad_trigger_subscription_updated: {
    product: "gumroad_products",
  },
  gumroad_trigger_subscription_ended: {
    product: "gumroad_products",
  },
  gumroad_trigger_subscription_restarted: {
    product: "gumroad_products",
  },
  // Actions
  gumroad_action_get_product: {
    productId: "gumroad_products",
  },
  gumroad_action_enable_product: {
    productId: "gumroad_products",
  },
  gumroad_action_disable_product: {
    productId: "gumroad_products",
  },
  gumroad_action_delete_product: {
    productId: "gumroad_products",
  },
  gumroad_action_create_variant_category: {
    productId: "gumroad_products",
  },
  gumroad_action_create_offer_code: {
    productId: "gumroad_products",
  },
  gumroad_action_get_sales_analytics: {
    productId: "gumroad_products",
  },
  gumroad_action_list_sales: {
    productId: "gumroad_products",
  },
  gumroad_action_list_subscribers: {
    productId: "gumroad_products",
  },
};

// Shopify field mappings
const shopifyMappings: Record<string, FieldMapping> = {
  shopify_trigger_product_updated: {
    shopify_store: "shopify_stores",
    collection_id: "shopify_collections",
  },
  shopify_trigger_inventory_low: {
    shopify_store: "shopify_stores",
    location_id: "shopify_locations",
  },
  shopify_action_update_inventory: {
    shopify_store: "shopify_stores",
    location_id: "shopify_locations",
    inventory_item_id: "shopify_inventory_items",
  },
  shopify_action_update_product: {
    shopify_store: "shopify_stores",
    product_id: "shopify_products",
  },
  shopify_action_update_order_status: {
    shopify_store: "shopify_stores",
    order_id: "shopify_orders",
  },
  shopify_action_create_fulfillment: {
    shopify_store: "shopify_stores",
    order_id: "shopify_orders",
  },
  shopify_action_add_order_note: {
    shopify_store: "shopify_stores",
    order_id: "shopify_orders",
  },
  shopify_action_update_customer: {
    shopify_store: "shopify_stores",
    customer_id: "shopify_customers",
  },
  shopify_action_create_order: {
    shopify_store: "shopify_stores",
    line_items: "shopify_products", // Maps line_items field to load products
  },
  shopify_action_create_product_variant: {
    shopify_store: "shopify_stores",
    product_id: "shopify_products",
  },
  shopify_action_update_product_variant: {
    shopify_store: "shopify_stores",
    product_id: "shopify_products",
    variant_id: "shopify_variants",
  },
};

// Default field mappings for unmapped fields
const defaultMappings: FieldMapping = {
  channelId: "channels",
  folderId: "folders",
  fileId: "files",
  documentId: "documents",
  databaseId: "databases",
  from: "gmail-enhanced-recipients",
  to: "gmail-enhanced-recipients",
  // Removed attendees mapping - it shouldn't default to Gmail
  // attendees fields should be simple text inputs for email addresses
  labelIds: "gmail_labels",
  shopify_store: "shopify_stores", // Shopify store selector (used by all Shopify nodes)
  // Notion default mappings
  workspace: "notion_workspaces",
  workspaceId: "notion_workspaces",
  workspace_id: "notion_workspaces",
  database: "notion_databases",
  databaseId: "notion_databases",
  database_id: "notion_databases",
  page: "notion_pages",
  pageId: "notion_pages",
  page_id: "notion_pages",
  pageFields: "notion_page_blocks",
  blocksToDelete: "notion_page_blocks_deletable",
  userId: "notion_users",
  user_id: "notion_users",
};

// Combine all mappings
export const fieldToResourceMap: NodeFieldMappings = {
  ...gmailMappings,
  ...discordMappings,
  ...slackMappings,
  ...trelloMappings,
  ...googleCalendarMappings,
  ...googleSheetsMappings,
  ...googleDriveMappings,
  ...googleDocsMappings,
  ...googleAnalyticsMappings,
  ...airtableMappings,
  ...dropboxMappings,
  ...outlookMappings,
  ...teamsMappings,
  ...onenoteMappings,
  ...onedriveMappings,
  ...microsoftExcelMappings,
  ...facebookMappings,
  ...boxMappings,
  ...mailchimpMappings,
  ...mondayMappings,
  ...hubspotMappings,
  ...notionMappings,
  ...aiMappings,
  ...hitlMappings,
  ...githubMappings,
  ...twitterMappings,
  ...stripeMappings,
  ...gumroadMappings,
  ...shopifyMappings,
  default: defaultMappings,
};

/**
 * Get resource type for a field in a specific node
 */
export function getResourceTypeForField(fieldName: string, nodeType: string): string | null {
  // Debug logging for Gmail "from" field
  if (fieldName === 'from' && nodeType?.includes('gmail')) {
    logger.info('🔍 [FieldMapping] Checking Gmail from field:', { fieldName, nodeType });
    logger.info('🔍 [FieldMapping] Node mapping exists?:', !!fieldToResourceMap[nodeType]);
    logger.info('🔍 [FieldMapping] Field in node mapping?:', nodeType && fieldToResourceMap[nodeType] ? fieldName in fieldToResourceMap[nodeType] : false);
  }

  // Debug logging for Trello template field
  if (fieldName === 'template' && nodeType?.includes('trello')) {
    logger.info('[FieldMapping] Checking Trello template field:', { fieldName, nodeType });
  }

  // Special handling for Shopify line item variants (variants_for_item_0, variants_for_item_1, etc.)
  if (fieldName.startsWith('variants_for_item_') && nodeType === 'shopify_action_create_order') {
    return 'shopify_variants';
  }

  // First check node-specific mapping
  const nodeMapping = fieldToResourceMap[nodeType];
  if (nodeMapping && nodeMapping[fieldName]) {
    const resourceType = nodeMapping[fieldName];
    if (fieldName === 'template') {
      logger.info('[FieldMapping] Found resource type for template:', resourceType);
    }
    if (fieldName === 'from' && nodeType?.includes('gmail')) {
      logger.info('✅ [FieldMapping] Found Gmail from resource type:', resourceType);
    }
    return resourceType;
  }

  // Fall back to default mapping
  if (fieldToResourceMap.default[fieldName]) {
    const defaultResource = fieldToResourceMap.default[fieldName];
    if (fieldName === 'from' && nodeType?.includes('gmail')) {
      logger.info('⚠️ [FieldMapping] Using DEFAULT mapping for Gmail from:', defaultResource);
    }
    return defaultResource;
  }

  // No mapping found
  if (fieldName === 'template') {
    logger.info('[FieldMapping] No resource type found for template field in:', nodeType);
  }
  if (fieldName === 'from' && nodeType?.includes('gmail')) {
    logger.info('❌ [FieldMapping] NO mapping found for Gmail from field!');
  }
  return null;
}
