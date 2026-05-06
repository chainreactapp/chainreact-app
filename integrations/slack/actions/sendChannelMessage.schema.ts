import { z } from "zod";

/**
 * Resolved-config schema for the Slack send_channel_message action.
 *
 * The engine pre-resolves all `{{...}}` references via the variable
 * resolver before dispatching the handler (rule §"Engine pre-resolution"),
 * so by the time this schema runs every value is already a concrete string.
 *
 * `channel` accepts either a Slack id (`C…`, `D…`) or a `#name` form —
 * Slack resolves names server-side. Both are non-empty strings.
 */
export const SendChannelMessageConfigSchema = z.object({
  channel: z.string().min(1, "Slack channel is required."),
  text: z.string().min(1, "Message text is required."),
});
export type SendChannelMessageConfig = z.infer<typeof SendChannelMessageConfigSchema>;
