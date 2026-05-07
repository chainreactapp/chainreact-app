/**
 * @jest-environment node
 *
 * Tests for the Gmail send_email config schema. The engine has already
 * pre-resolved every `{{...}}` reference before this schema runs;
 * validation here is defense-in-depth.
 */
import { SendEmailConfigSchema } from "@/integrations/gmail/actions/sendEmail.schema";

describe("SendEmailConfigSchema", () => {
  it("accepts a minimal valid config (textBody only)", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      subject: "Hi",
      textBody: "Hello there.",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a minimal valid config (htmlBody only)", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      subject: "Hi",
      htmlBody: "<p>Hello.</p>",
    });
    expect(r.success).toBe(true);
  });

  it("accepts both textBody and htmlBody (multipart/alternative)", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      subject: "Hi",
      textBody: "plain",
      htmlBody: "<p>html</p>",
    });
    expect(r.success).toBe(true);
  });

  it("accepts cc and bcc", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      subject: "Hi",
      textBody: "x",
      cc: "carbon@example.com",
      bcc: "blind@example.com",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an empty subject (additional Slice 2d decision)", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      subject: "",
      textBody: "x",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when `to` is missing", () => {
    const r = SendEmailConfigSchema.safeParse({
      subject: "Hi",
      textBody: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects when `to` is an empty string", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "",
      subject: "Hi",
      textBody: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects when `subject` is missing (must be present, may be empty)", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      textBody: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects when neither textBody nor htmlBody is provided", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      subject: "Hi",
    });
    expect(r.success).toBe(false);
  });

  it("rejects when both bodies are empty strings", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      subject: "Hi",
      textBody: "",
      htmlBody: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields (strict mode)", () => {
    const r = SendEmailConfigSchema.safeParse({
      to: "alice@example.com",
      subject: "Hi",
      textBody: "x",
      replyTo: "noreply@example.com", // not in the schema
    });
    expect(r.success).toBe(false);
  });
});
