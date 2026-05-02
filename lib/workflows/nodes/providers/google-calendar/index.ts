import { Calendar } from "lucide-react"
import { NodeComponent } from "../../types"

// Get user's current timezone, fallback to America/New_York
const getUserTimeZone = (): string => {
  try {
    if (typeof window !== 'undefined') {
      const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      // Verify it's a valid timezone by checking if it exists in our options
      const validTimezones = [
        "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
        "America/Anchorage", "Pacific/Honolulu", "UTC", "Europe/London",
        "Europe/Paris", "Europe/Berlin", "Europe/Moscow", "Asia/Tokyo",
        "Asia/Shanghai", "Asia/Dubai", "Asia/Kolkata", "Australia/Sydney",
        "Pacific/Auckland"
      ]
      return validTimezones.includes(detectedTimeZone) ? detectedTimeZone : "America/New_York"
    }
  } catch (error) {
    console.error('Failed to detect timezone:', error)
  }
  return "America/New_York"
}

export const googleCalendarNodes: NodeComponent[] = [
  {
    type: "google_calendar_trigger_new_event",
    title: "New Event",
    description: "Triggers when a new event is created",
    icon: Calendar,
    isTrigger: true,
    providerId: "google-calendar",
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendars",
        label: "Calendars",
        type: "multiselect",
        multiple: true,
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true,
      },
      {
        name: "eventTypes",
        label: "Event Types",
        type: "select",
        defaultValue: "all",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        options: [
          { value: "all", label: "All Events" },
          { value: "regular", label: "Regular Events Only" },
          { value: "all_day", label: "All-Day Events Only" },
          { value: "recurring", label: "Recurring Events Only" },
          { value: "non_recurring", label: "Non-Recurring Events Only" }
        ],
        description: "Filter events by their type",
        tooltip: "Choose which type of events should trigger this workflow"
      },
      {
        name: "includeEventsWith",
        label: "Only Include Events With",
        type: "multiselect",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        placeholder: "All events (no requirements)",
        options: [
          { value: "attendees", label: "Attendees" },
          { value: "location", label: "Location" },
          { value: "meet_link", label: "Google Meet Link" },
          { value: "attachments", label: "Attachments" },
          { value: "description", label: "Description" }
        ],
        description: "Only trigger for events that have these properties",
        tooltip: "Leave empty to include all events regardless of their properties"
      },
      {
        name: "timeRange",
        label: "Time Range",
        type: "select",
        defaultValue: "any",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        options: [
          { value: "any", label: "Any Time" },
          { value: "work_hours", label: "During Work Hours (9am-5pm)" },
          { value: "after_hours", label: "After Hours (before 9am or after 5pm)" },
          { value: "weekdays", label: "Weekdays Only (Mon-Fri)" },
          { value: "weekends", label: "Weekends Only (Sat-Sun)" }
        ],
        description: "Filter events by when they occur",
        tooltip: "Based on event start time in your local timezone"
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "Unique identifier for the event"
      },
      {
        name: "summary",
        label: "Event Title",
        type: "string",
        description: "Title/summary of the event"
      },
      {
        name: "description",
        label: "Description",
        type: "string",
        description: "Event description"
      },
      {
        name: "location",
        label: "Location",
        type: "string",
        description: "Event location"
      },
      {
        name: "start",
        label: "Start Time",
        type: "object",
        description: "Event start date and time"
      },
      {
        name: "end",
        label: "End Time",
        type: "object",
        description: "Event end date and time"
      },
      {
        name: "attendees",
        label: "Attendees",
        type: "array",
        description: "List of event attendees"
      },
      {
        name: "organizer",
        label: "Organizer",
        type: "object",
        description: "Event organizer information"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Link to the event in Google Calendar"
      },
      {
        name: "hangoutLink",
        label: "Meet Link",
        type: "string",
        description: "Google Meet link if attached"
      },
      {
        name: "createdTime",
        label: "Created Time",
        type: "string",
        description: "ISO timestamp when event was created"
      }
    ],
  },
  {
    type: "google_calendar_trigger_event_updated",
    title: "Event Updated",
    description: "Triggers when an existing event is updated",
    icon: Calendar,
    isTrigger: true,
    providerId: "google-calendar",
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendars",
        label: "Calendars",
        type: "multiselect",
        multiple: true,
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true,
      },
      {
        name: "eventTypes",
        label: "Event Types",
        type: "select",
        defaultValue: "all",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        options: [
          { value: "all", label: "All Events" },
          { value: "regular", label: "Regular Events Only" },
          { value: "all_day", label: "All-Day Events Only" },
          { value: "recurring", label: "Recurring Events Only" },
          { value: "non_recurring", label: "Non-Recurring Events Only" }
        ],
        description: "Filter events by their type",
        tooltip: "Choose which type of events should trigger this workflow"
      },
      {
        name: "includeEventsWith",
        label: "Only Include Events With",
        type: "multiselect",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        placeholder: "All events (no requirements)",
        options: [
          { value: "attendees", label: "Attendees" },
          { value: "location", label: "Location" },
          { value: "meet_link", label: "Google Meet Link" },
          { value: "attachments", label: "Attachments" },
          { value: "description", label: "Description" }
        ],
        description: "Only trigger for events that have these properties",
        tooltip: "Leave empty to include all events regardless of their properties"
      },
      {
        name: "timeRange",
        label: "Time Range",
        type: "select",
        defaultValue: "any",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        options: [
          { value: "any", label: "Any Time" },
          { value: "work_hours", label: "During Work Hours (9am-5pm)" },
          { value: "after_hours", label: "After Hours (before 9am or after 5pm)" },
          { value: "weekdays", label: "Weekdays Only (Mon-Fri)" },
          { value: "weekends", label: "Weekends Only (Sat-Sun)" }
        ],
        description: "Filter events by when they occur",
        tooltip: "Based on event start time in your local timezone"
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "Unique identifier for the updated event"
      },
      {
        name: "summary",
        label: "Event Title",
        type: "string",
        description: "Updated title/summary of the event"
      },
      {
        name: "description",
        label: "Description",
        type: "string",
        description: "Updated event description"
      },
      {
        name: "location",
        label: "Location",
        type: "string",
        description: "Updated event location"
      },
      {
        name: "start",
        label: "Start Time",
        type: "object",
        description: "Updated event start date and time"
      },
      {
        name: "end",
        label: "End Time",
        type: "object",
        description: "Updated event end date and time"
      },
      {
        name: "attendees",
        label: "Attendees",
        type: "array",
        description: "Updated list of event attendees"
      },
      {
        name: "organizer",
        label: "Organizer",
        type: "object",
        description: "Event organizer information"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Link to the event in Google Calendar"
      },
      {
        name: "hangoutLink",
        label: "Meet Link",
        type: "string",
        description: "Google Meet link if attached"
      },
      {
        name: "updatedTime",
        label: "Updated Time",
        type: "string",
        description: "ISO timestamp when event was last updated"
      },
      {
        name: "changes",
        label: "Changes",
        type: "object",
        description: "Object describing what fields were changed"
      }
    ],
  },
  {
    type: "google_calendar_trigger_event_canceled",
    title: "Event Canceled",
    description: "Triggers when an event is canceled",
    icon: Calendar,
    isTrigger: true,
    providerId: "google-calendar",
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendars",
        label: "Calendars",
        type: "multiselect",
        multiple: true,
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true,
      },
      {
        name: "eventTypes",
        label: "Event Types",
        type: "select",
        defaultValue: "all",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        options: [
          { value: "all", label: "All Events" },
          { value: "regular", label: "Regular Events Only" },
          { value: "all_day", label: "All-Day Events Only" },
          { value: "recurring", label: "Recurring Events Only" },
          { value: "non_recurring", label: "Non-Recurring Events Only" }
        ],
        description: "Filter events by their type",
        tooltip: "Choose which type of events should trigger this workflow"
      },
      {
        name: "includeEventsWith",
        label: "Only Include Events With",
        type: "multiselect",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        placeholder: "All events (no requirements)",
        options: [
          { value: "attendees", label: "Attendees" },
          { value: "location", label: "Location" },
          { value: "meet_link", label: "Google Meet Link" },
          { value: "attachments", label: "Attachments" },
          { value: "description", label: "Description" }
        ],
        description: "Only trigger for events that have these properties",
        tooltip: "Leave empty to include all events regardless of their properties"
      },
      {
        name: "timeRange",
        label: "Time Range",
        type: "select",
        defaultValue: "any",
        required: false,
        dependsOn: "calendars",
        hidden: {
          $deps: ["calendars"],
          $condition: { calendars: { $exists: false } }
        },
        options: [
          { value: "any", label: "Any Time" },
          { value: "work_hours", label: "During Work Hours (9am-5pm)" },
          { value: "after_hours", label: "After Hours (before 9am or after 5pm)" },
          { value: "weekdays", label: "Weekdays Only (Mon-Fri)" },
          { value: "weekends", label: "Weekends Only (Sat-Sun)" }
        ],
        description: "Filter events by when they occur",
        tooltip: "Based on event start time in your local timezone"
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "Unique identifier for the canceled event"
      },
      {
        name: "summary",
        label: "Event Title",
        type: "string",
        description: "Title/summary of the canceled event"
      },
      {
        name: "description",
        label: "Description",
        type: "string",
        description: "Event description"
      },
      {
        name: "location",
        label: "Location",
        type: "string",
        description: "Event location"
      },
      {
        name: "start",
        label: "Start Time",
        type: "object",
        description: "Original event start date and time"
      },
      {
        name: "end",
        label: "End Time",
        type: "object",
        description: "Original event end date and time"
      },
      {
        name: "attendees",
        label: "Attendees",
        type: "array",
        description: "List of event attendees who were invited"
      },
      {
        name: "organizer",
        label: "Organizer",
        type: "object",
        description: "Event organizer information"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Link to the event in Google Calendar"
      },
      {
        name: "canceledTime",
        label: "Canceled Time",
        type: "string",
        description: "ISO timestamp when event was canceled"
      },
      {
        name: "status",
        label: "Status",
        type: "string",
        description: "Event status (will be 'cancelled')"
      }
    ],
  },
  {
    type: "google_calendar_action_create_event",
    title: "Create Event",
    description: "Create a new calendar event with comprehensive features",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    producesOutput: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar"],
    category: "Productivity",
    configSchema: [
      // ========== EVENT TITLE ==========
      {
        name: "title",
        label: "Event Title",
        type: "text",
        placeholder: "Add title",
        required: true
      },

      // ========== ALL DAY TOGGLE ==========
      {
        name: "allDay",
        label: "All day",
        type: "boolean",
        defaultValue: false,
        description: "Event lasts all day"
      },

      // ========== DATE & TIME SECTION ==========
      {
        name: "startDate",
        label: "Start Date",
        type: "date",
        required: false,
        defaultValue: "{{currentDate}}",
        toggleLabel: "Use current date when action runs",
        toggleField: "useCurrentStartDate"
      },

      {
        name: "startTime",
        label: "Start Time",
        type: "google-time-picker",
        required: false,
        defaultValue: "{{roundedCurrentTime}}",
        toggleLabel: "Use current time when action runs",
        toggleField: "useCurrentStartTime",
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        }
      },

      {
        name: "endDate",
        label: "End Date",
        type: "date",
        required: false,
        defaultValue: "{{currentDate}}",
        toggleLabel: "Use current date when action runs",
        toggleField: "useCurrentEndDate"
      },

      {
        name: "endTime",
        label: "End Time",
        type: "google-time-picker",
        required: false,
        defaultValue: "{{roundedCurrentTimePlusOneHour}}",
        toggleLabel: "Use current time when action runs",
        toggleField: "useCurrentEndTime",
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        }
      },

      {
        name: "recurrence",
        label: "Repeat",
        type: "select",
        defaultValue: "none",
        placeholder: "Does not repeat",
        options: [
          { value: "none", label: "Does not repeat" },
          { value: "RRULE:FREQ=DAILY", label: "Daily" },
          { value: "RRULE:FREQ=WEEKLY", label: "Weekly" },
          { value: "RRULE:FREQ=MONTHLY", label: "Monthly" },
          { value: "RRULE:FREQ=YEARLY", label: "Annually" },
          { value: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "Every weekday (Monday to Friday)" }
        ],
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        }
      },

      {
        name: "separateTimezones",
        label: "Use separate start and end time zones",
        type: "boolean",
        defaultValue: false,
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        }
      },

      {
        name: "startTimeZone",
        label: "Event Start Time Zone",
        type: "select",
        defaultValue: getUserTimeZone(),
        required: false,
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        },
        options: [
          { value: "America/New_York", label: "Eastern Time (ET)" },
          { value: "America/Chicago", label: "Central Time (CT)" },
          { value: "America/Denver", label: "Mountain Time (MT)" },
          { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
          { value: "America/Anchorage", label: "Alaska Time (AKT)" },
          { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
          { value: "UTC", label: "UTC (Coordinated Universal Time)" },
          { value: "Europe/London", label: "London (GMT/BST)" },
          { value: "Europe/Paris", label: "Paris (CET/CEST)" },
          { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
          { value: "Europe/Moscow", label: "Moscow (MSK)" },
          { value: "Asia/Tokyo", label: "Tokyo (JST)" },
          { value: "Asia/Shanghai", label: "Shanghai (CST)" },
          { value: "Asia/Dubai", label: "Dubai (GST)" },
          { value: "Asia/Kolkata", label: "Mumbai (IST)" },
          { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
          { value: "Pacific/Auckland", label: "Auckland (NZDT/NZST)" }
        ]
      },

      {
        name: "endTimeZone",
        label: "Event End Time Zone",
        type: "select",
        defaultValue: getUserTimeZone(),
        required: false,
        hidden: {
          $deps: ["separateTimezones", "allDay"],
          $condition: {
            $or: [
              { separateTimezones: { $eq: false } },
              { separateTimezones: { $exists: false } },
              { allDay: { $eq: true } }
            ]
          }
        },
        options: [
          { value: "America/New_York", label: "Eastern Time (ET)" },
          { value: "America/Chicago", label: "Central Time (CT)" },
          { value: "America/Denver", label: "Mountain Time (MT)" },
          { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
          { value: "America/Anchorage", label: "Alaska Time (AKT)" },
          { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
          { value: "UTC", label: "UTC (Coordinated Universal Time)" },
          { value: "Europe/London", label: "London (GMT/BST)" },
          { value: "Europe/Paris", label: "Paris (CET/CEST)" },
          { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
          { value: "Europe/Moscow", label: "Moscow (MSK)" },
          { value: "Asia/Tokyo", label: "Tokyo (JST)" },
          { value: "Asia/Shanghai", label: "Shanghai (CST)" },
          { value: "Asia/Dubai", label: "Dubai (GST)" },
          { value: "Asia/Kolkata", label: "Mumbai (IST)" },
          { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
          { value: "Pacific/Auckland", label: "Auckland (NZDT/NZST)" }
        ]
      },

      // ========== EVENT DETAILS SECTION ==========
      {
        name: "googleMeet",
        label: "Add Google Meet video conferencing",
        type: "boolean",
        defaultValue: false,
        description: "Automatically create a Google Meet link for this event"
      },

      {
        name: "location",
        label: "Add location",
        type: "google-places-autocomplete",
        placeholder: "Enter location or address"
      },

      {
        name: "notifications",
        label: "Notifications",
        type: "notification-builder",
        defaultValue: [
          { method: "popup", minutes: 1440, time: "09:00" }
        ],
        description: "Add multiple notifications with different timing"
      },

      {
        name: "calendarId",
        label: "Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true
      },

      {
        name: "colorId",
        label: "Color",
        type: "select",
        defaultValue: "default",
        placeholder: "Calendar color",
        showColorPreview: true,
        options: [
          { value: "default", label: "Calendar color", color: "#808080" },
          { value: "1", label: "Lavender", color: "#a4bdfc" },
          { value: "2", label: "Sage", color: "#7ae7bf" },
          { value: "3", label: "Grape", color: "#dbadff" },
          { value: "4", label: "Flamingo", color: "#ff887c" },
          { value: "5", label: "Banana", color: "#fbd75b" },
          { value: "6", label: "Tangerine", color: "#ffb878" },
          { value: "7", label: "Peacock", color: "#46d6db" },
          { value: "8", label: "Graphite", color: "#e1e1e1" },
          { value: "9", label: "Blueberry", color: "#5484ed" },
          { value: "10", label: "Basil", color: "#51b749" },
          { value: "11", label: "Tomato", color: "#dc2127" }
        ]
      },

      {
        name: "transparency",
        label: "Show as",
        type: "select",
        defaultValue: "opaque",
        options: [
          { value: "transparent", label: "Free" },
          { value: "opaque", label: "Busy" }
        ]
      },

      {
        name: "visibility",
        label: "Visibility",
        type: "select",
        defaultValue: "default",
        options: [
          { value: "default", label: "Default visibility" },
          { value: "public", label: "Public" },
          { value: "private", label: "Private" }
        ]
      },

      {
        name: "description",
        label: "Add description",
        type: "textarea",
        placeholder: "Add description"
      },

      // ========== GUESTS SECTION ==========
      {
        name: "attendees",
        label: "Add guests",
        type: "contact-picker",
        dynamic: "gmail-recent-recipients",
        loadOnMount: true,
        placeholder: "Type email addresses or names"
      },

      {
        name: "sendNotifications",
        label: "Send invitations",
        type: "select",
        required: true,
        description: "Required (Q11). Recommended: \"Don't send\" — emails real attendees on event creation.",
        options: [
          { value: "all", label: "Send to all guests" },
          { value: "externalOnly", label: "Send to guests outside your organization" },
          { value: "none", label: "Don't send" }
        ],
        visibilityCondition: {
          field: "attendees",
          operator: "equals",
          value: true // Will show when attendees has any truthy value
        }
      },

      {
        name: "guestsCanInviteOthers",
        label: "Guests can invite others",
        type: "boolean",
        required: true,
        description: "Required (Q11). Recommended: false — guests inviting more guests expands the invite list beyond the workflow author's configuration.",
        visibilityCondition: {
          field: "attendees",
          operator: "equals",
          value: true // Will show when attendees has any truthy value
        }
      },

      {
        name: "guestsCanSeeOtherGuests",
        label: "Guests can see guest list",
        type: "boolean",
        required: true,
        description: "Required (Q11). Recommended: false — exposes attendee email PII to other attendees.",
        visibilityCondition: {
          field: "attendees",
          operator: "equals",
          value: true // Will show when attendees has any truthy value
        }
      },

      {
        name: "guestsCanModify",
        label: "Guests can modify event",
        type: "boolean",
        defaultValue: false,
        visibilityCondition: {
          field: "attendees",
          operator: "equals",
          value: true // Will show when attendees has any truthy value
        }
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "Unique identifier for the created event"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Direct link to the event in Google Calendar"
      },
      {
        name: "start",
        label: "Start Time",
        type: "object",
        description: "Event start date and time information"
      },
      {
        name: "end",
        label: "End Time",
        type: "object",
        description: "Event end date and time information"
      },
      {
        name: "meetLink",
        label: "Google Meet Link",
        type: "string",
        description: "Google Meet video conference link (if video conferencing was enabled)"
      },
      {
        name: "attendees",
        label: "Attendees",
        type: "array",
        description: "List of event attendees with their response status"
      },
      {
        name: "status",
        label: "Status",
        type: "string",
        description: "Current status of the event"
      }
    ],
  },
  {
    type: "google_calendar_action_update_event",
    title: "Update Event",
    description: "Update an existing calendar event",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    producesOutput: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar"],
    category: "Productivity",
    configSchema: [
      // ========== CALENDAR & EVENT ID ==========
      {
        name: "calendarId",
        label: "Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true
      },
      {
        name: "eventId",
        label: "Event ID",
        type: "text",
        placeholder: "Event ID to update",
        required: true,
        description: "The ID of the event to update"
      },

      // ========== EVENT TITLE ==========
      {
        name: "title",
        label: "Event Title",
        type: "text",
        placeholder: "Leave empty to keep current title",
        required: false
      },

      // ========== ALL DAY TOGGLE ==========
      {
        name: "allDay",
        label: "All day",
        type: "boolean",
        defaultValue: false,
        description: "Event lasts all day"
      },

      // ========== DATE & TIME SECTION ==========
      {
        name: "startDate",
        label: "Start Date",
        type: "date",
        required: false,
        defaultValue: "{{currentDate}}",
        toggleLabel: "Use current date when action runs",
        toggleField: "useCurrentStartDate"
      },

      {
        name: "startTime",
        label: "Start Time",
        type: "google-time-picker",
        required: false,
        defaultValue: "{{roundedCurrentTime}}",
        toggleLabel: "Use current time when action runs",
        toggleField: "useCurrentStartTime",
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        }
      },

      {
        name: "endDate",
        label: "End Date",
        type: "date",
        required: false,
        defaultValue: "{{currentDate}}",
        toggleLabel: "Use current date when action runs",
        toggleField: "useCurrentEndDate"
      },

      {
        name: "endTime",
        label: "End Time",
        type: "google-time-picker",
        required: false,
        defaultValue: "{{roundedCurrentTimePlusOneHour}}",
        toggleLabel: "Use current time when action runs",
        toggleField: "useCurrentEndTime",
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        }
      },

      {
        name: "separateTimezones",
        label: "Use separate start and end time zones",
        type: "boolean",
        defaultValue: false,
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        }
      },

      {
        name: "startTimeZone",
        label: "Event Start Time Zone",
        type: "select",
        defaultValue: getUserTimeZone(),
        required: false,
        hidden: {
          $deps: ["allDay"],
          $condition: { allDay: { $eq: true } }
        },
        options: [
          { value: "America/New_York", label: "Eastern Time (ET)" },
          { value: "America/Chicago", label: "Central Time (CT)" },
          { value: "America/Denver", label: "Mountain Time (MT)" },
          { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
          { value: "America/Anchorage", label: "Alaska Time (AKT)" },
          { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
          { value: "UTC", label: "UTC (Coordinated Universal Time)" },
          { value: "Europe/London", label: "London (GMT/BST)" },
          { value: "Europe/Paris", label: "Paris (CET/CEST)" },
          { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
          { value: "Europe/Moscow", label: "Moscow (MSK)" },
          { value: "Asia/Tokyo", label: "Tokyo (JST)" },
          { value: "Asia/Shanghai", label: "Shanghai (CST)" },
          { value: "Asia/Dubai", label: "Dubai (GST)" },
          { value: "Asia/Kolkata", label: "Mumbai (IST)" },
          { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
          { value: "Pacific/Auckland", label: "Auckland (NZDT/NZST)" }
        ]
      },

      {
        name: "endTimeZone",
        label: "Event End Time Zone",
        type: "select",
        defaultValue: getUserTimeZone(),
        required: false,
        hidden: {
          $deps: ["separateTimezones", "allDay"],
          $condition: {
            $or: [
              { separateTimezones: { $eq: false } },
              { separateTimezones: { $exists: false } },
              { allDay: { $eq: true } }
            ]
          }
        },
        options: [
          { value: "America/New_York", label: "Eastern Time (ET)" },
          { value: "America/Chicago", label: "Central Time (CT)" },
          { value: "America/Denver", label: "Mountain Time (MT)" },
          { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
          { value: "America/Anchorage", label: "Alaska Time (AKT)" },
          { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
          { value: "UTC", label: "UTC (Coordinated Universal Time)" },
          { value: "Europe/London", label: "London (GMT/BST)" },
          { value: "Europe/Paris", label: "Paris (CET/CEST)" },
          { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
          { value: "Europe/Moscow", label: "Moscow (MSK)" },
          { value: "Asia/Tokyo", label: "Tokyo (JST)" },
          { value: "Asia/Shanghai", label: "Shanghai (CST)" },
          { value: "Asia/Dubai", label: "Dubai (GST)" },
          { value: "Asia/Kolkata", label: "Mumbai (IST)" },
          { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
          { value: "Pacific/Auckland", label: "Auckland (NZDT/NZST)" }
        ]
      },

      // ========== EVENT DETAILS SECTION ==========
      {
        name: "googleMeet",
        label: "Add Google Meet video conferencing",
        type: "boolean",
        defaultValue: false,
        description: "Automatically create a Google Meet link for this event"
      },

      {
        name: "location",
        label: "Add location",
        type: "google-places-autocomplete",
        placeholder: "Leave empty to keep current location"
      },

      {
        name: "notifications",
        label: "Notifications",
        type: "notification-builder",
        description: "Add multiple notifications with different timing"
      },

      {
        name: "colorId",
        label: "Color",
        type: "select",
        placeholder: "Calendar color",
        showColorPreview: true,
        options: [
          { value: "default", label: "Keep current", color: "#808080" },
          { value: "1", label: "Lavender", color: "#a4bdfc" },
          { value: "2", label: "Sage", color: "#7ae7bf" },
          { value: "3", label: "Grape", color: "#dbadff" },
          { value: "4", label: "Flamingo", color: "#ff887c" },
          { value: "5", label: "Banana", color: "#fbd75b" },
          { value: "6", label: "Tangerine", color: "#ffb878" },
          { value: "7", label: "Peacock", color: "#46d6db" },
          { value: "8", label: "Graphite", color: "#e1e1e1" },
          { value: "9", label: "Blueberry", color: "#5484ed" },
          { value: "10", label: "Basil", color: "#51b749" },
          { value: "11", label: "Tomato", color: "#dc2127" }
        ]
      },

      {
        name: "transparency",
        label: "Show as",
        type: "select",
        options: [
          { value: "transparent", label: "Free" },
          { value: "opaque", label: "Busy" }
        ]
      },

      {
        name: "visibility",
        label: "Visibility",
        type: "select",
        options: [
          { value: "default", label: "Default visibility" },
          { value: "public", label: "Public" },
          { value: "private", label: "Private" }
        ]
      },

      {
        name: "description",
        label: "Add description",
        type: "textarea",
        placeholder: "Leave empty to keep current description"
      },

      // ========== GUESTS SECTION ==========
      {
        name: "attendees",
        label: "Add guests",
        type: "contact-picker",
        dynamic: "gmail-recent-recipients",
        loadOnMount: true,
        placeholder: "Leave empty to keep current attendees",
        description: "Replaces all attendees with new list"
      },

      {
        name: "sendNotifications",
        label: "Send invitations",
        type: "select",
        required: true,
        description: "Required (Q11). Recommended: \"Don't send\" — emails real attendees when changed.",
        options: [
          { value: "all", label: "Send to all guests" },
          { value: "externalOnly", label: "Send to guests outside your organization" },
          { value: "none", label: "Don't send" }
        ],
        visibilityCondition: {
          field: "attendees",
          operator: "equals",
          value: true
        }
      },

      {
        name: "guestsCanInviteOthers",
        label: "Guests can invite others",
        type: "boolean",
        defaultValue: true,
        visibilityCondition: {
          field: "attendees",
          operator: "equals",
          value: true
        }
      },

      {
        name: "guestsCanSeeOtherGuests",
        label: "Guests can see guest list",
        type: "boolean",
        defaultValue: true,
        visibilityCondition: {
          field: "attendees",
          operator: "equals",
          value: true
        }
      },

      {
        name: "guestsCanModify",
        label: "Guests can modify event",
        type: "boolean",
        defaultValue: false,
        visibilityCondition: {
          field: "attendees",
          operator: "equals",
          value: true
        }
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "Unique identifier for the updated event"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Direct link to the event in Google Calendar"
      },
      {
        name: "summary",
        label: "Title",
        type: "string",
        description: "Updated event title"
      },
      {
        name: "description",
        label: "Description",
        type: "string",
        description: "Updated event description"
      },
      {
        name: "location",
        label: "Location",
        type: "string",
        description: "Updated event location"
      },
      {
        name: "start",
        label: "Start Time",
        type: "object",
        description: "Updated event start date and time information"
      },
      {
        name: "end",
        label: "End Time",
        type: "object",
        description: "Updated event end date and time information"
      },
      {
        name: "attendees",
        label: "Attendees",
        type: "array",
        description: "Updated list of event attendees"
      },
      {
        name: "status",
        label: "Status",
        type: "string",
        description: "Event status"
      },
      {
        name: "updated",
        label: "Last Updated",
        type: "string",
        description: "ISO timestamp when event was last updated"
      }
    ],
  },
  {
    type: "google_calendar_action_delete_event",
    title: "Delete Event",
    description: "Delete a calendar event",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    producesOutput: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar"],
    category: "Productivity",
    configSchema: [
      {
        name: "calendarId",
        label: "Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true
      },
      {
        name: "eventId",
        label: "Event ID",
        type: "text",
        placeholder: "Event ID to delete",
        required: true,
        description: "The ID of the event to delete"
      },
      {
        name: "sendNotifications",
        label: "Send cancellation notifications",
        type: "select",
        required: true,
        description: "Required (Q11). Recommended: \"Don't send\" — emails real attendees on event delete.",
        options: [
          { value: "all", label: "Send to all guests" },
          { value: "externalOnly", label: "Send to guests outside your organization" },
          { value: "none", label: "Don't send" }
        ]
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "ID of the deleted event"
      },
      {
        name: "deleted",
        label: "Deleted",
        type: "boolean",
        description: "Confirmation that event was deleted"
      },
      {
        name: "deletedAt",
        label: "Deleted At",
        type: "string",
        description: "ISO timestamp when event was deleted"
      },
      {
        name: "eventTitle",
        label: "Event Title",
        type: "string",
        description: "Title of the deleted event"
      },
      {
        name: "eventStart",
        label: "Event Start",
        type: "object",
        description: "Start time of the deleted event"
      },
      {
        name: "eventEnd",
        label: "Event End",
        type: "object",
        description: "End time of the deleted event"
      },
      {
        name: "calendarId",
        label: "Calendar ID",
        type: "string",
        description: "ID of the calendar the event was deleted from"
      }
    ],
  },
  {
    type: "google_calendar_action_get_event",
    title: "Get Event",
    description: "Retrieve details of a specific calendar event",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendarId",
        label: "Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true
      },
      {
        name: "eventId",
        label: "Event ID",
        type: "text",
        placeholder: "Enter event ID",
        required: true,
        description: "The ID of the event to retrieve"
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "Unique identifier for the event"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Direct link to the event in Google Calendar"
      },
      {
        name: "summary",
        label: "Title",
        type: "string",
        description: "Event title"
      },
      {
        name: "description",
        label: "Description",
        type: "string",
        description: "Event description"
      },
      {
        name: "location",
        label: "Location",
        type: "string",
        description: "Event location"
      },
      {
        name: "start",
        label: "Start Time",
        type: "object",
        description: "Event start date and time"
      },
      {
        name: "end",
        label: "End Time",
        type: "object",
        description: "Event end date and time"
      },
      {
        name: "attendees",
        label: "Attendees",
        type: "array",
        description: "List of event attendees with response status"
      },
      {
        name: "organizer",
        label: "Organizer",
        type: "object",
        description: "Event organizer information"
      },
      {
        name: "creator",
        label: "Creator",
        type: "object",
        description: "Event creator information"
      },
      {
        name: "created",
        label: "Created At",
        type: "string",
        description: "ISO timestamp when event was created"
      },
      {
        name: "updated",
        label: "Last Updated",
        type: "string",
        description: "ISO timestamp when event was last updated"
      },
      {
        name: "status",
        label: "Status",
        type: "string",
        description: "Event status (confirmed, tentative, cancelled)"
      },
      {
        name: "hangoutLink",
        label: "Hangout Link",
        type: "string",
        description: "Google Meet/Hangouts link if attached"
      },
      {
        name: "meetLink",
        label: "Meet Link",
        type: "string",
        description: "Google Meet video conference link"
      },
      {
        name: "conferenceData",
        label: "Conference Data",
        type: "object",
        description: "Full conference data object"
      },
      {
        name: "colorId",
        label: "Color ID",
        type: "string",
        description: "Event color ID"
      },
      {
        name: "transparency",
        label: "Transparency",
        type: "string",
        description: "Whether event blocks time (opaque/transparent)"
      },
      {
        name: "visibility",
        label: "Visibility",
        type: "string",
        description: "Event visibility (default/public/private)"
      },
      {
        name: "recurrence",
        label: "Recurrence Rules",
        type: "array",
        description: "RRULE recurrence rules if recurring event"
      },
      {
        name: "recurringEventId",
        label: "Recurring Event ID",
        type: "string",
        description: "ID of recurring event if this is an instance"
      },
      {
        name: "reminders",
        label: "Reminders",
        type: "object",
        description: "Event reminder settings"
      },
      {
        name: "attachments",
        label: "Attachments",
        type: "array",
        description: "File attachments on the event"
      },
      {
        name: "guestsCanInviteOthers",
        label: "Guests Can Invite Others",
        type: "boolean",
        description: "Whether attendees can invite others"
      },
      {
        name: "guestsCanModify",
        label: "Guests Can Modify",
        type: "boolean",
        description: "Whether attendees can modify the event"
      },
      {
        name: "guestsCanSeeOtherGuests",
        label: "Guests Can See Others",
        type: "boolean",
        description: "Whether attendees can see other guests"
      },
      {
        name: "eventType",
        label: "Event Type",
        type: "string",
        description: "Type of event (default, outOfOffice, etc.)"
      }
    ],
  },
  {
    type: "google_calendar_action_list_events",
    title: "List Events",
    description: "Get events from a calendar within a date range",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendarId",
        label: "Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true
      },
      {
        name: "timeMin",
        label: "Start Date/Time",
        type: "datetime-local",
        placeholder: "Select start date and time",
        required: false
      },
      {
        name: "timeMax",
        label: "End Date/Time",
        type: "datetime-local",
        placeholder: "Select end date and time",
        required: false
      },
      {
        name: "maxResults",
        label: "Max Results",
        type: "number",
        defaultValue: 250,
        required: false,
        description: "Maximum number of events to return (max 2500)"
      },
      {
        name: "orderBy",
        label: "Order By",
        type: "select",
        defaultValue: "startTime",
        options: [
          { value: "startTime", label: "Start Time" },
          { value: "updated", label: "Last Updated" }
        ],
        description: "Sort order for results"
      },
      {
        name: "singleEvents",
        label: "Expand Recurring Events",
        type: "boolean",
        defaultValue: true,
        description: "Whether to expand recurring events into individual instances"
      },
      {
        name: "showDeleted",
        label: "Include Deleted Events",
        type: "boolean",
        defaultValue: false,
        description: "Whether to include deleted events"
      },
      {
        name: "query",
        label: "Search Query",
        type: "text",
        placeholder: "Search events by text",
        required: false,
        description: "Free text search terms to find events"
      }
    ],
    outputSchema: [
      {
        name: "events",
        label: "Events",
        type: "array",
        description: "Array of calendar events",
        properties: [
          {
            name: "eventId",
            label: "Event ID",
            type: "string",
            description: "Unique identifier for the event"
          },
          {
            name: "htmlLink",
            label: "Event Link",
            type: "string",
            description: "Direct link to the event in Google Calendar"
          },
          {
            name: "summary",
            label: "Event Title",
            type: "string",
            description: "Title of the event"
          },
          {
            name: "description",
            label: "Description",
            type: "string",
            description: "Event description"
          },
          {
            name: "location",
            label: "Location",
            type: "string",
            description: "Event location"
          },
          {
            name: "start",
            label: "Start Time",
            type: "object",
            description: "Event start date and time"
          },
          {
            name: "end",
            label: "End Time",
            type: "object",
            description: "Event end date and time"
          },
          {
            name: "attendees",
            label: "Attendees",
            type: "array",
            description: "List of event attendees"
          },
          {
            name: "organizer",
            label: "Organizer",
            type: "object",
            description: "Event organizer information"
          },
          {
            name: "status",
            label: "Status",
            type: "string",
            description: "Event status (confirmed, tentative, cancelled)"
          },
          {
            name: "meetLink",
            label: "Google Meet Link",
            type: "string",
            description: "Google Meet video conference link if attached"
          }
        ]
      },
      {
        name: "count",
        label: "Event Count",
        type: "number",
        description: "Number of events returned"
      },
      {
        name: "firstEventId",
        label: "First Event ID",
        type: "string",
        description: "Event ID of the first event in the list (null if no events). Use {{node.firstEventId}} to quickly reference the first event."
      },
      {
        name: "lastEventId",
        label: "Last Event ID",
        type: "string",
        description: "Event ID of the last event in the list (null if no events). Use {{node.lastEventId}} to quickly reference the last event."
      },
      {
        name: "firstEvent",
        label: "First Event",
        type: "object",
        description: "Complete details of the first event in the list (null if no events)"
      },
      {
        name: "lastEvent",
        label: "Last Event",
        type: "object",
        description: "Complete details of the last event in the list (null if no events)"
      },
      {
        name: "nextPageToken",
        label: "Next Page Token",
        type: "string",
        description: "Token for pagination if more results available"
      },
      {
        name: "nextSyncToken",
        label: "Next Sync Token",
        type: "string",
        description: "Token for incremental sync"
      },
      {
        name: "calendarId",
        label: "Calendar ID",
        type: "string",
        description: "ID of the calendar queried"
      },
      {
        name: "timeMin",
        label: "Start Time",
        type: "string",
        description: "Lower bound used in query"
      },
      {
        name: "timeMax",
        label: "End Time",
        type: "string",
        description: "Upper bound used in query"
      }
    ],
  },
  {
    type: "google_calendar_action_quick_add_event",
    title: "Quick Add Event",
    description: "Create an event from natural language text",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar"],
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendarId",
        label: "Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true
      },
      {
        name: "text",
        label: "Natural Language Text",
        type: "textarea",
        placeholder: "e.g., 'Lunch with John tomorrow at noon' or 'Meeting next Monday 2pm-3pm'",
        required: true,
        description: "Describe the event in natural language - Google will parse dates, times, and details"
      },
      {
        name: "sendNotifications",
        label: "Send invitations",
        type: "select",
        required: true,
        description: "Required (Q11). Recommended: \"Don't send\" — quickAdd may parse attendees from natural-language text.",
        options: [
          { value: "all", label: "Send to all guests" },
          { value: "externalOnly", label: "Send to guests outside your organization" },
          { value: "none", label: "Don't send" }
        ]
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "Unique identifier for the created event"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Direct link to the event in Google Calendar"
      },
      {
        name: "summary",
        label: "Title",
        type: "string",
        description: "Parsed event title"
      },
      {
        name: "description",
        label: "Description",
        type: "string",
        description: "Parsed event description"
      },
      {
        name: "location",
        label: "Location",
        type: "string",
        description: "Parsed event location"
      },
      {
        name: "start",
        label: "Start Time",
        type: "object",
        description: "Parsed event start date and time"
      },
      {
        name: "end",
        label: "End Time",
        type: "object",
        description: "Parsed event end date and time"
      },
      {
        name: "attendees",
        label: "Attendees",
        type: "array",
        description: "Parsed list of attendees"
      },
      {
        name: "organizer",
        label: "Organizer",
        type: "object",
        description: "Event organizer information"
      },
      {
        name: "status",
        label: "Status",
        type: "string",
        description: "Event status"
      },
      {
        name: "created",
        label: "Created At",
        type: "string",
        description: "ISO timestamp when event was created"
      },
      {
        name: "originalText",
        label: "Original Text",
        type: "string",
        description: "The original natural language input"
      }
    ],
  },
  {
    type: "google_calendar_action_add_attendees",
    title: "Add Attendees",
    description: "Add attendees to an existing event",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar"],
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendarId",
        label: "Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true
      },
      {
        name: "eventId",
        label: "Event ID",
        type: "text",
        placeholder: "Event ID",
        required: true,
        description: "The ID of the event to add attendees to"
      },
      {
        name: "attendees",
        label: "Attendees to Add",
        type: "contact-picker",
        dynamic: "gmail-recent-recipients",
        loadOnMount: true,
        placeholder: "Enter email addresses",
        required: true,
        description: "Email addresses of attendees to add (existing attendees won't be duplicated)"
      },
      {
        name: "sendNotifications",
        label: "Send invitations",
        type: "select",
        required: true,
        description: "Required (Q11). Recommended: \"Don't send\" — emails real attendees when added.",
        options: [
          { value: "all", label: "Send to all guests" },
          { value: "externalOnly", label: "Send to guests outside your organization" },
          { value: "none", label: "Don't send" }
        ]
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "ID of the updated event"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Direct link to the event"
      },
      {
        name: "summary",
        label: "Event Title",
        type: "string",
        description: "Title of the event"
      },
      {
        name: "attendees",
        label: "All Attendees",
        type: "array",
        description: "Complete list of event attendees after adding"
      },
      {
        name: "addedAttendees",
        label: "Added Attendees",
        type: "array",
        description: "List of attendees that were actually added"
      },
      {
        name: "existingAttendees",
        label: "Previous Attendee Count",
        type: "number",
        description: "Number of attendees before adding"
      },
      {
        name: "totalAttendees",
        label: "Total Attendees",
        type: "number",
        description: "Total number of attendees after adding"
      },
      {
        name: "actuallyAdded",
        label: "Count Added",
        type: "number",
        description: "Number of new attendees actually added (excludes duplicates)"
      }
    ],
  },
  {
    type: "google_calendar_action_remove_attendees",
    title: "Remove Attendees",
    description: "Remove attendees from an existing event",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar"],
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendarId",
        label: "Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true
      },
      {
        name: "eventId",
        label: "Event ID",
        type: "text",
        placeholder: "Event ID",
        required: true,
        description: "The ID of the event to remove attendees from"
      },
      {
        name: "removeAllAttendees",
        label: "Remove all attendees",
        type: "toggle",
        defaultValue: false,
        description: "When enabled, removes all attendees from the event"
      },
      {
        name: "attendeesToRemove",
        label: "Attendees to Remove",
        type: "tags",
        placeholder: "Type email and press Enter",
        required: true,
        description: "Email addresses of attendees to remove",
        tooltip: "Press Enter after typing each email to add it as a pill",
        hidden: {
          $deps: ["removeAllAttendees"],
          $condition: { removeAllAttendees: true }
        }
      },
      {
        name: "sendNotifications",
        label: "Send cancellation notifications",
        type: "select",
        required: true,
        description: "Required (Q11). Recommended: \"Don't send\" — emails real attendees on attendee removal.",
        options: [
          { value: "all", label: "Send to all guests" },
          { value: "externalOnly", label: "Send to guests outside your organization" },
          { value: "none", label: "Don't send" }
        ]
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "ID of the updated event"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Direct link to the event"
      },
      {
        name: "summary",
        label: "Event Title",
        type: "string",
        description: "Title of the event"
      },
      {
        name: "remainingAttendees",
        label: "Remaining Attendees",
        type: "array",
        description: "List of attendees after removal"
      },
      {
        name: "previousAttendeeCount",
        label: "Previous Attendee Count",
        type: "number",
        description: "Number of attendees before removal"
      },
      {
        name: "removedCount",
        label: "Removed Count",
        type: "number",
        description: "Number of attendees actually removed"
      },
      {
        name: "currentAttendeeCount",
        label: "Current Attendee Count",
        type: "number",
        description: "Number of attendees after removal"
      }
    ],
  },
  {
    type: "google_calendar_action_move_event",
    title: "Move Event",
    description: "Move an event to a different calendar",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar"],
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "sourceCalendarId",
        label: "Source Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true,
        description: "Calendar where the event currently exists"
      },
      {
        name: "eventId",
        label: "Event ID",
        type: "text",
        placeholder: "Event ID to move",
        required: true,
        description: "The ID of the event to move"
      },
      {
        name: "destinationCalendarId",
        label: "Destination Calendar",
        type: "select",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true,
        description: "Calendar to move the event to"
      },
      {
        name: "sendNotifications",
        label: "Send notifications",
        type: "select",
        required: true,
        description: "Required (Q11). Recommended: \"Don't send\" — emails real attendees on event move.",
        options: [
          { value: "all", label: "Send to all guests" },
          { value: "externalOnly", label: "Send to guests outside your organization" },
          { value: "none", label: "Don't send" }
        ]
      }
    ],
    outputSchema: [
      {
        name: "eventId",
        label: "Event ID",
        type: "string",
        description: "ID of the moved event"
      },
      {
        name: "htmlLink",
        label: "Event Link",
        type: "string",
        description: "Direct link to the event in its new calendar"
      },
      {
        name: "summary",
        label: "Event Title",
        type: "string",
        description: "Title of the event"
      },
      {
        name: "description",
        label: "Description",
        type: "string",
        description: "Event description"
      },
      {
        name: "location",
        label: "Location",
        type: "string",
        description: "Event location"
      },
      {
        name: "start",
        label: "Start Time",
        type: "object",
        description: "Event start date and time"
      },
      {
        name: "end",
        label: "End Time",
        type: "object",
        description: "Event end date and time"
      },
      {
        name: "sourceCalendarId",
        label: "Source Calendar ID",
        type: "string",
        description: "ID of the calendar the event was moved from"
      },
      {
        name: "destinationCalendarId",
        label: "Destination Calendar ID",
        type: "string",
        description: "ID of the calendar the event was moved to"
      },
      {
        name: "movedAt",
        label: "Moved At",
        type: "string",
        description: "ISO timestamp when event was moved"
      },
      {
        name: "status",
        label: "Status",
        type: "string",
        description: "Event status after move"
      }
    ],
  },
  {
    type: "google_calendar_action_get_free_busy",
    title: "Get Free/Busy",
    description: "Check availability across calendars",
    icon: Calendar,
    isTrigger: false,
    testable: true,
    providerId: "google-calendar",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    category: "Productivity",
    producesOutput: true,
    configSchema: [
      {
        name: "calendarIds",
        label: "Calendars",
        type: "multiselect",
        dynamic: "google-calendars",
        loadOnMount: true,
        required: true,
        description: "Calendars to check availability for"
      },
      {
        name: "timeMin",
        label: "Start Time",
        type: "text",
        placeholder: "today, tomorrow, or ISO date",
        required: true,
        description: "Start of time range to query (use 'today', 'tomorrow', or ISO date)"
      },
      {
        name: "timeMax",
        label: "End Time",
        type: "text",
        placeholder: "next_week, or ISO date",
        required: true,
        description: "End of time range to query (use 'next_week' or ISO date)"
      },
      {
        name: "timeZone",
        label: "Time Zone",
        type: "select",
        defaultValue: "UTC",
        options: [
          { value: "UTC", label: "UTC" },
          { value: "America/New_York", label: "Eastern Time (ET)" },
          { value: "America/Chicago", label: "Central Time (CT)" },
          { value: "America/Denver", label: "Mountain Time (MT)" },
          { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
          { value: "Europe/London", label: "London (GMT/BST)" },
          { value: "Europe/Paris", label: "Paris (CET/CEST)" },
          { value: "Asia/Tokyo", label: "Tokyo (JST)" },
          { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" }
        ],
        description: "Time zone for the query"
      }
    ],
    outputSchema: [
      {
        name: "calendars",
        label: "Calendars",
        type: "object",
        description: "Object containing free/busy data for each calendar"
      },
      {
        name: "timeMin",
        label: "Query Start Time",
        type: "string",
        description: "Start time used in the query"
      },
      {
        name: "timeMax",
        label: "Query End Time",
        type: "string",
        description: "End time used in the query"
      },
      {
        name: "timeZone",
        label: "Time Zone",
        type: "string",
        description: "Time zone used in the query"
      },
      {
        name: "queriedCalendars",
        label: "Queried Calendars",
        type: "array",
        description: "List of calendar IDs that were queried"
      },
      {
        name: "calendarCount",
        label: "Calendar Count",
        type: "number",
        description: "Number of calendars queried"
      }
    ],
  },
]
