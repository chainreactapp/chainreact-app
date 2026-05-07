import { refreshAndRetry } from "@/services/oauth/refreshAndRetry";
import type { ActionHandler } from "@/services/execution/handlers/types";
import { usersMessagesSend } from "../api/usersMessagesSend";
import { buildRfc5322Message, encodeBase64Url } from "../utils/rfc5322";
import { SendEmailConfigSchema } from "./sendEmail.schema";

/**
 * Gmail `users.messages.send` action handler.
 *
 * First handler in V2 to use the `refreshAndRetry` wrapper. The wrapper
 * owns integration lookup, token decryption, and retry-on-401. The
 * handler hands over `{ userId, provider: "gmail", accountId, apiCall }`;
 * inside `apiCall` it builds the RFC 5322 message, base64url-encodes it,
 * and calls the Gmail API.
 *
 * Account resolution: when the workflow's trigger event came from Gmail,
 * the trigger event's accountId (the email address) targets the right
 * inbox. For non-Gmail triggers (manual / scheduled / different
 * provider) accountId is `null`, which lets `refreshAndRetry` pick the
 * single active Gmail integration for the user.
 *
 * Output shape (Decision 2d-4 Option B): `{ id, threadId, to, subject }`.
 * Downstream nodes reference `{{<nodeId>.id}}` for the message id (e.g.,
 * a future label-modify action), `{{<nodeId>.threadId}}` for reply
 * threading, and the echoed `to`/`subject` for follow-up reply nodes.
 */
export const sendEmail: ActionHandler = async (input) => {
  const config = SendEmailConfigSchema.parse(input.config);

  const accountId =
    input.triggerEvent.provider === "gmail"
      ? input.triggerEvent.accountId
      : null;

  const result = await refreshAndRetry({
    userId: input.userId,
    provider: "gmail",
    accountId,
    apiCall: async (accessToken) => {
      const rfc5322 = buildRfc5322Message({
        to: config.to,
        subject: config.subject,
        textBody: config.textBody,
        htmlBody: config.htmlBody,
        cc: config.cc,
        bcc: config.bcc,
      });
      const rawMessage = encodeBase64Url(rfc5322);
      return usersMessagesSend({ accessToken, rawMessage });
    },
  });

  return {
    output: {
      id: result.id,
      threadId: result.threadId,
      to: config.to,
      subject: config.subject,
    },
  };
};
