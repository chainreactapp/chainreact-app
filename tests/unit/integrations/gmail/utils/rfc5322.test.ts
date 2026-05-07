/**
 * @jest-environment node
 *
 * Tests for the RFC 5322 message builder + base64url helper.
 */
import {
  buildRfc5322Message,
  encodeBase64Url,
  encodeRfc2047HeaderValue,
} from "@/integrations/gmail/utils/rfc5322";

const FIXED_BOUNDARY = "----=_chainreact_test_boundary_xxx";

describe("buildRfc5322Message — text/plain only", () => {
  it("produces correct headers + CRLF + body when only textBody is provided", () => {
    const msg = buildRfc5322Message({
      to: "alice@example.com",
      subject: "Hello",
      textBody: "Plain content.",
    });
    expect(msg.split("\r\n")).toEqual([
      "To: alice@example.com",
      "Subject: Hello",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      "Plain content.",
    ]);
  });

  it("includes Cc when provided", () => {
    const msg = buildRfc5322Message({
      to: "a@x.com",
      cc: "c@x.com",
      subject: "S",
      textBody: "B",
    });
    expect(msg).toContain("\r\nCc: c@x.com\r\n");
  });

  it("includes Bcc when provided", () => {
    const msg = buildRfc5322Message({
      to: "a@x.com",
      bcc: "b@x.com",
      subject: "S",
      textBody: "B",
    });
    expect(msg).toContain("\r\nBcc: b@x.com\r\n");
  });

  it("omits Cc when undefined or empty", () => {
    const msgUndef = buildRfc5322Message({
      to: "a@x.com",
      subject: "S",
      textBody: "B",
    });
    const msgEmpty = buildRfc5322Message({
      to: "a@x.com",
      cc: "",
      subject: "S",
      textBody: "B",
    });
    expect(msgUndef).not.toContain("Cc:");
    expect(msgEmpty).not.toContain("Cc:");
  });

  it("preserves CSV recipients verbatim into the To: line", () => {
    const msg = buildRfc5322Message({
      to: "alice@x.com, bob@x.com, carol@x.com",
      subject: "S",
      textBody: "B",
    });
    expect(msg).toContain("To: alice@x.com, bob@x.com, carol@x.com\r\n");
  });

  it("preserves UTF-8 body bytes verbatim", () => {
    const msg = buildRfc5322Message({
      to: "a@x.com",
      subject: "S",
      textBody: "Héllo 🎉 wörld",
    });
    expect(msg).toContain("Héllo 🎉 wörld");
  });
});

describe("buildRfc5322Message — text/html only", () => {
  it("uses Content-Type: text/html when only htmlBody is provided", () => {
    const msg = buildRfc5322Message({
      to: "a@x.com",
      subject: "S",
      htmlBody: "<p>hi</p>",
    });
    expect(msg).toContain('Content-Type: text/html; charset="UTF-8"\r\n');
    expect(msg).toContain("<p>hi</p>");
    expect(msg).not.toContain("text/plain");
  });
});

describe("buildRfc5322Message — multipart/alternative", () => {
  it("wraps text part FIRST then html part with the supplied boundary", () => {
    const msg = buildRfc5322Message({
      to: "a@x.com",
      subject: "S",
      textBody: "Plain version.",
      htmlBody: "<p>HTML version.</p>",
      boundary: FIXED_BOUNDARY,
    });

    expect(msg).toContain(
      `Content-Type: multipart/alternative; boundary="${FIXED_BOUNDARY}"\r\n`,
    );
    // text part comes before html part (RFC 2046 §5.1.4 ordering)
    const textIdx = msg.indexOf("Plain version.");
    const htmlIdx = msg.indexOf("<p>HTML version.</p>");
    expect(textIdx).toBeGreaterThan(0);
    expect(htmlIdx).toBeGreaterThan(0);
    expect(textIdx).toBeLessThan(htmlIdx);

    // Each part has its own Content-Type and 8bit transfer encoding
    expect(msg).toContain(
      `--${FIXED_BOUNDARY}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\nPlain version.`,
    );
    expect(msg).toContain(
      `--${FIXED_BOUNDARY}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n<p>HTML version.</p>`,
    );
    // Closing boundary
    expect(msg.endsWith(`--${FIXED_BOUNDARY}--`)).toBe(true);
  });

  it("generates a fresh boundary per call when none is supplied", () => {
    const a = buildRfc5322Message({
      to: "a@x.com",
      subject: "S",
      textBody: "T",
      htmlBody: "<p>H</p>",
    });
    const b = buildRfc5322Message({
      to: "a@x.com",
      subject: "S",
      textBody: "T",
      htmlBody: "<p>H</p>",
    });
    const extractBoundary = (msg: string): string => {
      const match = /boundary="([^"]+)"/.exec(msg);
      if (!match) throw new Error("no boundary in message");
      return match[1]!;
    };
    expect(extractBoundary(a)).not.toBe(extractBoundary(b));
    // chainreact-prefixed for grep-friendliness
    expect(extractBoundary(a)).toMatch(/^----=_chainreact_/);
  });
});

describe("buildRfc5322Message — error paths", () => {
  it("throws when neither textBody nor htmlBody is provided", () => {
    expect(() =>
      buildRfc5322Message({ to: "a@x.com", subject: "S" }),
    ).toThrow(/at least one of textBody or htmlBody/i);
  });

  it("throws when both bodies are empty strings", () => {
    expect(() =>
      buildRfc5322Message({
        to: "a@x.com",
        subject: "S",
        textBody: "",
        htmlBody: "",
      }),
    ).toThrow(/at least one of textBody or htmlBody/i);
  });

  it("accepts empty subject", () => {
    const msg = buildRfc5322Message({
      to: "a@x.com",
      subject: "",
      textBody: "B",
    });
    expect(msg).toContain("\r\nSubject: \r\n");
  });
});

describe("encodeRfc2047HeaderValue — subject encoding (Decision 2d-2)", () => {
  it("passes through ASCII-only values unchanged", () => {
    expect(encodeRfc2047HeaderValue("Hello world")).toBe("Hello world");
    expect(encodeRfc2047HeaderValue("Re: meeting at 3pm")).toBe("Re: meeting at 3pm");
  });

  it("base64-encodes values containing non-ASCII (RFC 2047 B-encoding)", () => {
    expect(encodeRfc2047HeaderValue("Héllo")).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(encodeRfc2047HeaderValue("Status 🎉")).toMatch(/^=\?UTF-8\?B\?/);
  });

  it("round-trips through buildRfc5322Message for non-ASCII subjects", () => {
    const msg = buildRfc5322Message({
      to: "a@x.com",
      subject: "Status 🎉",
      textBody: "B",
    });
    expect(msg).toContain("Subject: =?UTF-8?B?");
    expect(msg).not.toContain("Subject: Status 🎉"); // raw form NOT in headers
  });

  it("treats empty string as ASCII (no encoding)", () => {
    expect(encodeRfc2047HeaderValue("")).toBe("");
  });
});

describe("encodeBase64Url", () => {
  it("URL-safe alphabet: no '+', no '/', no '=' padding", () => {
    // input chosen so standard base64 would contain + and /
    const out = encodeBase64Url(">>>>>");
    expect(out).not.toContain("+");
    expect(out).not.toContain("/");
    expect(out).not.toContain("=");
  });

  it("decodes back to the original UTF-8 string", () => {
    const original = "Héllo, 🎉 wörld!";
    const encoded = encodeBase64Url(original);
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    expect(decoded).toBe(original);
  });

  it("encodes a full RFC 5322 message round-trip", () => {
    const msg = buildRfc5322Message({
      to: "a@x.com",
      subject: "S",
      textBody: "Body with ñ",
    });
    const encoded = encodeBase64Url(msg);
    expect(Buffer.from(encoded, "base64url").toString("utf8")).toBe(msg);
  });
});
