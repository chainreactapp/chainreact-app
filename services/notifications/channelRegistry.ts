import type { NotificationChannel } from "./channel";
import { inAppChannel } from "./channels/inApp";

/**
 * Channel registry — resolves the set of enabled channels for a user's
 * workflow-failure notifications.
 *
 * Slice 1: hardcoded to in-app only. In-app is always-on with no opt-out
 * (per V2 notifications platform plan §4 — preferences table is deferred
 * until the first additional channel ships).
 *
 * Slice 2: this function reads from notification_preferences and returns
 * the channel impls whose toggles are enabled for the user. Adding a
 * channel then = (a) implement it under channels/, (b) add to the
 * SLICE_2_REGISTRY array referenced from this function.
 */

const SLICE_1_CHANNELS: readonly NotificationChannel[] = [inAppChannel];

export function getEnabledChannelsForUser(
  _userId: string,
): readonly NotificationChannel[] {
  // userId param is intentionally unused in Slice 1 — preserved in the
  // signature so adding preferences in Slice 2 doesn't change call sites.
  return SLICE_1_CHANNELS;
}
