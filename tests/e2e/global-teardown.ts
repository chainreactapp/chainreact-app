import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  getGoogleMockHandle,
  getMockHandle,
  STATE_FILE,
} from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  const slackHandle = getMockHandle();
  if (slackHandle) {
    await slackHandle.stop();
    console.log("[e2e] mock Slack stopped");
  }
  const googleHandle = getGoogleMockHandle();
  if (googleHandle) {
    await googleHandle.stop();
    console.log("[e2e] mock Google stopped");
  }
  // Clean up the state directory. Both state files live under the same
  // .state/ folder, so removing the parent dir cleans both.
  await rm(dirname(STATE_FILE), { recursive: true, force: true });
}
