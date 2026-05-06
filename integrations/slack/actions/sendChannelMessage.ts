import { decryptToken } from "@/core/encryption/tokens";
import { getActiveForExecution } from "@/repositories/integrations";
import type { ActionHandler } from "@/services/execution/handlers/types";
import { chatPostMessage } from "../api/chatPostMessage";
import { SendChannelMessageConfigSchema } from "./sendChannelMessage.schema";

/**
 * Slack `chat.postMessage` action handler.
 *
 * Per docs/rules/variable-resolver.md §"Allowed flows":
 *   - The engine has already resolved every `{{...}}` template in the
 *     incoming `config`. The handler receives concrete strings only.
 *   - The handler validates against the per-action Zod schema for
 *     defense-in-depth (covers the "engine bug" + "stale workflow saved
 *     before the schema existed" cases).
 *
 * Token lookup:
 *   - Uses the trigger event's accountId (Slack team_id) when present so
 *     multi-workspace users dispatch to the correct workspace. Falls back
 *     to the first active Slack integration for the user when no
 *     accountId is available (manual / scheduled triggers, future).
 *   - Decrypts the access token via core/encryption/tokens.decryptToken.
 *
 * Output shape (becomes `variables[nodeId]` for downstream nodes):
 *   { channel, ts, message } — channel id Slack resolved to,
 *   the server-assigned message timestamp (Slack's message id), and the
 *   echoed message payload. Downstream templates can reference
 *   `{{<nodeId>.ts}}` or `{{<nodeId>.channel}}`.
 */
export const sendChannelMessage: ActionHandler = async (input) => {
  const config = SendChannelMessageConfigSchema.parse(input.config);

  const accountId =
    input.triggerEvent.provider === "slack"
      ? input.triggerEvent.accountId
      : null;

  const integration = await getActiveForExecution(input.userId, "slack", accountId);
  if (!integration) {
    throw new Error(
      accountId
        ? `No active Slack integration found for workspace ${accountId}.`
        : "No active Slack integration found for this user.",
    );
  }

  const botToken = decryptToken(integration.accessTokenEncrypted);

  const result = await chatPostMessage({
    botToken,
    channel: config.channel,
    text: config.text,
  });

  return {
    output: {
      channel: result.channel,
      ts: result.ts,
      message: result.message,
    },
  };
};
