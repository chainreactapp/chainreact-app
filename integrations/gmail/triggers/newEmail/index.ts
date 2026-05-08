import { registerActivation } from "@/services/triggers/activationRegistry";
import { registerPollingHandler } from "@/services/triggers/pollingRegistry";
import { activate } from "./activate";
import { gmailNewEmailPollingHandler } from "./poll";

/**
 * Module-init registration for the Gmail "new_email" polling trigger.
 *
 * Slice 2e: importing this module registers BOTH the activation hook and
 * the polling handler. The cron route (app/api/cron/poll-triggers/route.ts)
 * imports `integrations/_registry` which transitively imports this module,
 * so registration happens before the first poll executes.
 *
 * Re-exports kept thin — the orchestration entry points (activate,
 * pollingHandler) are the only public API of this module.
 */

registerActivation("gmail", "new_email", activate);
registerPollingHandler(gmailNewEmailPollingHandler);

export { activate, gmailNewEmailPollingHandler };
