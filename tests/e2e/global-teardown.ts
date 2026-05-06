import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { getMockHandle, STATE_FILE } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  const handle = getMockHandle();
  if (handle) {
    await handle.stop();
    console.log("[e2e] mock Slack stopped");
  }
  // Clean up the state directory.
  await rm(dirname(STATE_FILE), { recursive: true, force: true });
}
