import { ValidationError } from "@/server/errors";
import type { ChannelType } from "./types";

export function normalizeDestination(channel: ChannelType, destination: string): string {
  const trimmed = (destination || "").trim();
  if (!trimmed) {
    throw new ValidationError("Destination address is required");
  }

  if (channel === "email") {
    const lower = trimmed.toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lower) || lower.length > 254) {
      throw new ValidationError("Invalid email address format");
    }
    return lower;
  }

  // sms or whatsapp
  const sanitized = trimmed.replace(/[\s\-\(\)\.]+/g, "");
  if (sanitized.length < 5 || sanitized.length > 20) {
    throw new ValidationError("Invalid phone number length");
  }
  return sanitized;
}

export function validateOutboundMessage(input: {
  channel: ChannelType;
  recipientAddress: string;
  textBody?: string | null;
  templateVersionId?: string | null;
}): void {
  if (!input.channel || !["email", "sms", "whatsapp"].includes(input.channel)) {
    throw new ValidationError("Valid messaging channel (email, sms, whatsapp) is required");
  }

  normalizeDestination(input.channel, input.recipientAddress);

  if (!input.textBody?.trim() && !input.templateVersionId) {
    throw new ValidationError("Either text body or template version is required");
  }
}
