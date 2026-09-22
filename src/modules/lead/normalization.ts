/**
 * Normalizes email by trimming whitespace and converting to lowercase.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

export type NormalizedPhoneResult = {
  normalized: string;
  raw: string;
  isE164: boolean;
};

/**
 * Normalizes phone numbers according to strict constraints:
 * - Must NOT guess a country.
 * - Convert to E.164 ONLY when sufficient country context exists (e.g. starts with + or valid international prefix).
 * - Preserves the raw value.
 * - If country context does not exist, strips common separators (spaces, hyphens, dots, parentheses)
 *   without fabricating an international dialing code (+1, +44, etc.).
 */
export function normalizePhone(raw: string | null | undefined, countryCodePrefix?: string | null): NormalizedPhoneResult | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Check if international prefix exists explicitly in the raw string
  if (trimmed.startsWith("+")) {
    const digitsOnly = trimmed.slice(1).replace(/\D/g, "");
    if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
      return {
        normalized: `+${digitsOnly}`,
        raw: trimmed,
        isE164: true,
      };
    }
  }

  // If a known workspace default country code prefix is explicitly provided (e.g. "+1")
  if (countryCodePrefix && countryCodePrefix.startsWith("+")) {
    const digitsOnly = trimmed.replace(/\D/g, "");
    const prefixDigits = countryCodePrefix.slice(1).replace(/\D/g, "");
    if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
      const fullDigits = digitsOnly.startsWith(prefixDigits) ? digitsOnly : `${prefixDigits}${digitsOnly}`;
      return {
        normalized: `+${fullDigits}`,
        raw: trimmed,
        isE164: true,
      };
    }
  }

  // No country context exists: DO NOT GUESS A COUNTRY!
  // Strip whitespace, hyphens, dots, parens, but do not pretend it is E.164
  const stripped = trimmed.replace(/[\s\-\(\)\.]+/g, "");
  return {
    normalized: stripped,
    raw: trimmed,
    isE164: false,
  };
}
