import { getDecryptedAccessToken } from '../core/getDecryptedAccessToken'
import { resolveValue } from '../core/resolveValue'
import { ActionResult } from '../core/executeWait'
import type { HandlerExecutionMeta } from '../core/idempotencyKey'
import { resolveTimezoneAndLocale } from '../core/resolveContextDefaults'
import { google } from 'googleapis'

import { logger } from '@/lib/utils/logger'

/**
 * Parse CSV-like initial data into rows
 */
function parseInitialData(data: string): string[][] {
  if (!data || typeof data !== 'string') return []

  const lines = data.trim().split('\n')
  return lines.map(line => {
    // Simple CSV parsing - split by comma but handle basic quoting
    const values: string[] = []
    let current = ''
    let inQuotes = false

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    values.push(current.trim())
    return values
  })
}

/**
 * Get template data based on template type
 */
function getTemplateData(template: string): { headers: string[], sampleRows?: string[][] } {
  switch (template) {
    case 'budget':
      return {
        headers: ['Date', 'Category', 'Description', 'Amount', 'Type', 'Balance'],
        sampleRows: [
          ['', 'Income', 'Salary', '', 'Income', ''],
          ['', 'Housing', 'Rent/Mortgage', '', 'Expense', ''],
          ['', 'Food', 'Groceries', '', 'Expense', '']
        ]
      }
    case 'project':
      return {
        headers: ['Task', 'Assignee', 'Status', 'Priority', 'Due Date', 'Notes'],
        sampleRows: [
          ['', '', 'To Do', 'Medium', '', ''],
          ['', '', 'In Progress', 'High', '', ''],
          ['', '', 'Done', 'Low', '', '']
        ]
      }
    case 'crm':
      return {
        headers: ['Name', 'Email', 'Phone', 'Company', 'Status', 'Last Contact', 'Notes'],
        sampleRows: []
      }
    case 'inventory':
      return {
        headers: ['SKU', 'Product Name', 'Category', 'Quantity', 'Price', 'Reorder Level', 'Supplier'],
        sampleRows: []
      }
    case 'calendar':
      return {
        headers: ['Date', 'Title', 'Platform', 'Status', 'Content', 'Link', 'Notes'],
        sampleRows: []
      }
    default:
      return { headers: [], sampleRows: [] }
  }
}

/**
 * Create a new Google Sheets spreadsheet
 */
export async function createGoogleSpreadsheet(
  config: any,
  userId: string,
  input: Record<string, any>,
  meta?: HandlerExecutionMeta,
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    const {
      title = 'New Spreadsheet',
      description,
      sheets: customSheets,
      sheetNames = ['Sheet1'],
      template = 'blank',
      initialData,
      folder,
      locale: configLocale,
      timeZone: configTimeZone,
    } = resolvedConfig

    // Q12 — resolve locale and timezone via workspace → user → en_US/UTC.
    // Replaces the prior hardcoded 'en_US' / 'America/New_York' fallbacks
    // (audit createSpreadsheet.ts:97-98). Explicit config values still
    // win — only the fallback layer is replaced.
    const resolved = await resolveTimezoneAndLocale({
      workspaceId: meta?.workspaceId,
      userId,
    })
    const locale = configLocale || resolved.locale
    const timeZone = configTimeZone || resolved.timezone

    logger.info('[Create Spreadsheet] Config:', {
      title,
      description,
      template,
      hasInitialData: !!initialData,
      initialDataLength: initialData?.length,
      userId
    })

    // Get access token
    let accessToken: string
    try {
      accessToken = await getDecryptedAccessToken(userId, "google-sheets")
    } catch (tokenError: any) {
      logger.error('[Create Spreadsheet] Failed to get access token:', {
        error: tokenError.message,
        userId
      })
      throw new Error(`Authentication failed: ${tokenError.message}`)
    }

    // Initialize Sheets API
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client })
    const drive = google.drive({ version: 'v3', auth: oauth2Client })

    // Determine sheet names
    let finalSheetNames: string[] = sheetNames
    if (customSheets && Array.isArray(customSheets) && customSheets.length > 0) {
      finalSheetNames = customSheets.map((s: any) => typeof s === 'string' ? s : s.name || 'Sheet')
    }

    // Create spreadsheet with sheets
    let spreadsheet
    try {
      spreadsheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title,
            locale,
            timeZone
          },
          sheets: finalSheetNames.map((name: string, index: number) => ({
            properties: {
              sheetId: index,
              title: name,
              index: index,
              gridProperties: {
                rowCount: 1000,
                columnCount: 26
              }
            }
          }))
        }
      })
    } catch (apiError: any) {
      logger.error('[Create Spreadsheet] Google API error:', {
        error: apiError.message,
        code: apiError.code,
        status: apiError.status,
        details: apiError.errors
      })
      throw new Error(`Google Sheets API error: ${apiError.message}`)
    }

    if (!spreadsheet.data.spreadsheetId) {
      throw new Error('Failed to create spreadsheet - no ID returned')
    }

    const spreadsheetId = spreadsheet.data.spreadsheetId

    // Populate with template data or initial data
    let dataToAdd: string[][] = []

    if (template && template !== 'blank') {
      const templateData = getTemplateData(template)
      if (templateData.headers.length > 0) {
        dataToAdd.push(templateData.headers)
        if (templateData.sampleRows) {
          dataToAdd.push(...templateData.sampleRows)
        }
      }
    }

    // Initial data overrides template data
    if (initialData) {
      const parsedData = parseInitialData(initialData)
      if (parsedData.length > 0) {
        dataToAdd = parsedData
      }
    }

    // Write initial data to Sheet1 if we have any
    if (dataToAdd.length > 0) {
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${finalSheetNames[0]}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: dataToAdd
          }
        })
        logger.info('[Create Spreadsheet] Added initial data:', {
          rows: dataToAdd.length,
          columns: dataToAdd[0]?.length || 0
        })
      } catch (dataError: any) {
        logger.warn('[Create Spreadsheet] Failed to add initial data:', dataError.message)
        // Don't fail the entire operation if initial data fails
      }
    }

    // Add description as a note to cell A1 or as document property (workaround since Sheets API doesn't support description)
    if (description) {
      try {
        // Add a note to cell A1 with the description
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              updateCells: {
                rows: [{
                  values: [{
                    note: `Description: ${description}`
                  }]
                }],
                fields: 'note',
                start: {
                  sheetId: 0,
                  rowIndex: 0,
                  columnIndex: 0
                }
              }
            }]
          }
        })
      } catch (descError: any) {
        logger.warn('[Create Spreadsheet] Failed to add description:', descError.message)
        // Don't fail if description note fails
      }
    }

    // Move to folder if specified
    if (folder) {
      try {
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: folder,
          fields: 'id, parents'
        })
      } catch (error) {
        logger.warn('Failed to move spreadsheet to folder:', error)
        // Don't fail the entire operation if folder move fails
      }
    }

    return {
      success: true,
      type: 'google_sheets_create_spreadsheet',
      status: 'success',
      output: {
        spreadsheetId,
        spreadsheetUrl: spreadsheet.data.spreadsheetUrl,
        title: spreadsheet.data.properties?.title,
        sheetsCreated: spreadsheet.data.sheets?.length || 1,
        sheets: spreadsheet.data.sheets?.map(sheet => ({
          sheetId: sheet.properties?.sheetId,
          title: sheet.properties?.title
        }))
      }
    }

  } catch (error: any) {
    logger.error('Create Google Spreadsheet error:', {
      message: error.message,
      stack: error.stack
    })
    return {
      success: false,
      type: 'google_sheets_create_spreadsheet',
      status: 'error',
      error: error.message || 'Failed to create spreadsheet',
      message: error.message || 'Failed to create spreadsheet'
    }
  }
}