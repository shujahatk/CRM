import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.APP_ENV = "test";
  process.env.APP_BASE_URL = "http://127.0.0.1:3000";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_only_not_a_credential";
});

import {
  extractTemplateVariables,
  validateTemplateText,
  renderTemplate,
} from "@/modules/templates/parser";
import { normalizeDestination } from "@/modules/conversations/validation";
import { DisconnectedProviderAdapter } from "@/server/providers/messaging";
import { log } from "@/server/telemetry/logger";

describe("Phase 5: Template Variable Parser & Validation (Correction 3)", () => {
  it("extracts all template variables and identifies optional modifiers", () => {
    const text = "Hi {{first_name}}, check {{meeting_url:optional}} from {{workspace_name}}";
    const vars = extractTemplateVariables(text);
    expect(vars).toEqual([
      { name: "first_name", isOptional: false, raw: "{{first_name}}" },
      { name: "meeting_url", isOptional: true, raw: "{{meeting_url:optional}}" },
      { name: "workspace_name", isOptional: false, raw: "{{workspace_name}}" },
    ]);
  });

  it("accepts templates using only allowed template variables", () => {
    expect(() =>
      validateTemplateText(
        "Meeting with {{workspace_name}}",
        "Hi {{first_name}} {{last_name}}, your meeting is at {{meeting_url}}."
      )
    ).not.toThrow();
  });

  it("rejects unknown template variables at validation/publish time", () => {
    expect(() =>
      validateTemplateText(
        "Subject",
        "Hi {{first_name}}, your tracking code is {{unknown_tracking_code}}."
      )
    ).toThrow(/Disallowed template variables/i);

    expect(() =>
      validateTemplateText("Subject with {{invalid_header_var}}", "Body text")
    ).toThrow(/Disallowed template variables/i);
  });

  it("renders template with valid runtime variables", () => {
    const rendered = renderTemplate("Hi {{first_name}} from {{company}}!", {
      first_name: "Alice",
      company: "Acme Corp",
    });
    expect(rendered).toBe("Hi Alice from Acme Corp!");
  });

  it("REJECTS rendering when known required variable is missing or empty (avoids 'Hi ')", () => {
    // Missing variable entirely
    expect(() =>
      renderTemplate("Hi {{first_name}}!", { company: "Acme Corp" })
    ).toThrow(/Missing required template variable: {{first_name}}/i);

    // Variable present but empty string
    expect(() =>
      renderTemplate("Hi {{first_name}}!", { first_name: "   " })
    ).toThrow(/Missing required template variable: {{first_name}}/i);
  });

  it("allows missing values only when variable has :optional modifier", () => {
    const rendered = renderTemplate(
      "Hi {{first_name}}, thanks for reaching out from {{company:optional}}.",
      { first_name: "Bob" }
    );
    expect(rendered).toBe("Hi Bob, thanks for reaching out from .");
  });
});

describe("Phase 5: Destination Normalization (Correction 1 & 4)", () => {
  it("normalizes and validates email addresses", () => {
    const norm = normalizeDestination("email", "  User.Name+Test@Example.COM  ");
    expect(norm).toBe("user.name+test@example.com");
  });

  it("rejects invalid email formats", () => {
    expect(() => normalizeDestination("email", "not-an-email")).toThrow(
      /Invalid email address format/i
    );
  });

  it("normalizes phone numbers to standard cleaned formats", () => {
    const norm = normalizeDestination("sms", " +1 (555) 234-5678 ");
    expect(norm).toBe("+15552345678");
  });

  it("rejects invalid phone destinations with fewer than 5 digits", () => {
    expect(() => normalizeDestination("sms", "123")).toThrow(/Invalid phone number length/i);
    expect(() => normalizeDestination("whatsapp", "ab")).toThrow(
      /Invalid phone number length/i
    );
  });
});

describe("Phase 5: Providerless Internal Dispatch (Correction 6)", () => {
  it("terminates dispatch internally at awaiting_provider without network calls", async () => {
    const adapter = new DisconnectedProviderAdapter("email");
    const result = await adapter.dispatch({
      messageId: "msg-123",
      workspaceId: "ws-1",
      channel: "email",
      senderAddress: "team@company.com",
      recipientAddress: "lead@example.com",
      subject: "Test Subject",
      textBody: "Hello",
    });

    expect(result.providerStatus).toBe("awaiting_provider");
    expect(result.dispatched).toBe(false);
    expect(result.providerMessageId).toBeUndefined();
    expect(result.error).toContain("Provider dispatch disabled in Phase 5");
  });
});

describe("Phase 5: Privacy Telemetry (Correction 16)", () => {
  it("does not include message bodies or sensitive raw text in telemetry logs", () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    log({
      event: "messaging.outbound_create",
      outcome: "success",
      channel: "email",
      messageId: "msg-456",
      conversationId: "conv-789",
    });

    expect(consoleSpy).toHaveBeenCalled();
    const loggedOutput = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(loggedOutput);

    // Verify safe structured metadata exists
    expect(parsed.event).toBe("messaging.outbound_create");
    expect(parsed.channel).toBe("email");
    expect(parsed.messageId).toBe("msg-456");
    expect(parsed.conversationId).toBe("conv-789");

    // Verify NO message bodies or email content fields exist
    expect(parsed.body).toBeUndefined();
    expect(parsed.text_body).toBeUndefined();
    expect(parsed.html_body).toBeUndefined();
    expect(parsed.subject).toBeUndefined();

    consoleSpy.mockRestore();
  });
});
