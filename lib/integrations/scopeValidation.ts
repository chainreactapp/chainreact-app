import { db } from "@/lib/db"
import { validateScopes } from "./integrationScopes"
import { CONNECTED_STATUSES_LIST } from "./connectionStatus"

/**
 * Validates the scopes for an integration. Does not persist results.
 *
 * @param integrationId The ID of the integration to validate
 * @param grantedScopes Array of scopes granted by the OAuth provider
 * @returns Object containing validation results
 */
export async function validateAndUpdateIntegrationScopes(
  integrationId: string,
  grantedScopes: string[],
): Promise<{
  valid: boolean
  missing: string[]
  granted: string[]
  status: "valid" | "invalid" | "partial"
  integration: any
}> {
  const { data: integration, error } = await db
    .from("integrations")
    .select("*")
    .eq("id", integrationId)
    .single()

  if (error || !integration) {
    throw new Error(`Integration with ID ${integrationId} not found`)
  }

  const validation = validateScopes(integration.provider, grantedScopes)

  return {
    integration,
    valid: validation.valid,
    missing: validation.missing,
    granted: validation.granted,
    status: validation.status,
  }
}

/**
 * Validates all integrations for a user. Granted scopes are not persisted on
 * the integrations row, so validation runs against an empty granted list and
 * surfaces missing required scopes rather than reading historical state.
 *
 * @param userId The user ID to validate integrations for
 * @returns Array of validation results
 */
export async function validateAllIntegrations(userId: string): Promise<any[]> {
  const { data: integrations, error } = await db
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .in("status", CONNECTED_STATUSES_LIST)

  if (error || !integrations) {
    throw new Error(`Failed to fetch integrations: ${error?.message || "Unknown error"}`)
  }

  return integrations.map((integration: any) => ({
    ...integration,
    scopeValidation: validateScopes(integration.provider, []),
  }))
}
