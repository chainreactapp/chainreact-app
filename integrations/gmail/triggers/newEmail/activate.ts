import { refreshAndRetry } from "@/services/oauth/refreshAndRetry";
import type { ActivationFn } from "@/services/triggers/activationRegistry";
import { usersGetProfile } from "../../api/usersGetProfile";

/**
 * Gmail new_email activation hook.
 *
 * Slice 2e: replaces V1's `users.watch()` Pub/Sub setup
 * (GoogleApisTriggerLifecycle.ts:323-351). Since V2 polls instead of
 * receiving push notifications, the activation work is just "fetch the
 * current historyId and store it as the polling baseline".
 *
 * This call is required by the V1 CLAUDE.md "first poll miss" rule —
 * without a baseline historyId, the first poll would call
 * users.history.list with no startHistoryId, get nothing useful, and
 * silently drop any messages that arrived between activation and the
 * first poll.
 *
 * The handler runs at workflow activate time, BEFORE the
 * trigger_resources row is upserted. A throw here aborts the activate
 * transition — the orchestrator wraps it as TRIGGER_REGISTRATION_FAILED
 * and the user sees a clear "we couldn't reach Gmail right now" error
 * rather than an active-but-broken trigger.
 */

export const activate: ActivationFn = async ({ integration }) => {
  const profile = await refreshAndRetry({
    userId: integration.userId,
    provider: "gmail",
    accountId: integration.providerAccountId,
    apiCall: async (accessToken) => usersGetProfile({ accessToken }),
  });

  return {
    pollingEnabled: true,
    snapshot: {
      historyId: profile.historyId,
      capturedAt: new Date().toISOString(),
    },
  };
};
