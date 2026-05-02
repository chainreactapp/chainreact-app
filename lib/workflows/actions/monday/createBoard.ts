import {
  getDecryptedAccessToken,
  resolveValue,
  ActionResult,
} from '@/lib/workflows/actions/core'
import { requireExplicitField } from '@/lib/workflows/actions/core/requireExplicitField'
import { logger } from '@/lib/utils/logger'

/**
 * Create a new board in Monday.com
 */
export async function createMondayBoard(
  config: Record<string, any>,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Q11 — boardKind controls workspace-wide board visibility (public
    // exposes the board to the entire workspace). Previous silent default
    // `'public'` removed; workflow author must explicitly choose
    // `public` / `private` / `share`.
    const missingRequired = requireExplicitField(config, 'boardKind')
    if (missingRequired) return missingRequired as unknown as ActionResult

    // Resolve configuration values
    const boardName = await resolveValue(config.boardName, input)
    const boardKind = await resolveValue(config.boardKind, input)
    const description = config.description
      ? await resolveValue(config.description, input)
      : undefined

    // Validate required fields
    if (!boardName) {
      throw new Error('Board name is required')
    }

    // Get access token
    const accessToken = await getDecryptedAccessToken(userId, 'monday')

    // Build GraphQL mutation
    let mutation = `
      mutation($boardName: String!, $boardKind: BoardKind!) {
        create_board(board_name: $boardName, board_kind: $boardKind) {
          id
          name
          description
          board_kind
        }
      }
    `

    const variables: Record<string, any> = {
      boardName: boardName.toString(),
      boardKind: boardKind
    }

    // Add description if provided
    if (description) {
      mutation = `
        mutation($boardName: String!, $boardKind: BoardKind!, $description: String!) {
          create_board(board_name: $boardName, board_kind: $boardKind, description: $description) {
            id
            name
            description
            board_kind
          }
        }
      `
      variables.description = description.toString()
    }

    // Make API request
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'API-Version': '2024-01'
      },
      body: JSON.stringify({ query: mutation, variables })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Monday.com API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    if (data.errors && data.errors.length > 0) {
      const errorMessages = data.errors.map((e: any) => e.message).join(', ')
      throw new Error(`Monday.com error: ${errorMessages}`)
    }

    const board = data.data?.create_board

    if (!board) {
      throw new Error('Failed to create board: No data returned')
    }

    logger.info('✅ Monday.com board created successfully', { boardId: board.id, userId })

    return {
      success: true,
      output: {
        boardId: board.id,
        boardName: board.name,
        description: board.description,
        boardKind: board.board_kind || boardKind,
        createdAt: new Date().toISOString()
      },
      message: `Board "${boardName}" created successfully in Monday.com`
    }

  } catch (error: any) {
    logger.error('❌ Monday.com create board error:', error)
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to create Monday.com board'
    }
  }
}
