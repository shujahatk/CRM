import { describe, it, expect } from 'vitest';
import {
  mergeWatchIntervals,
  calculateUniqueSeconds,
  calculateCompletionPercent,
  isCompleted,
  deriveObservationalSegmentPerformance,
} from '@/modules/vsl/math';
import {
  hashSubmissionPayload,
  validateOrigin,
  formFieldDefinitionSchema,
  publicSubmitFormSchema,
} from '@/modules/forms/validation';
import { MemoryRateLimiter } from '@/server/security/rate-limit';

describe('VSL Interval Telemetry Math (Corrections 6 & 12)', () => {
  it('merges overlapping and adjacent intervals into disjoint unions', () => {
    // [0, 20], [10, 30], [80, 100] -> [0, 30], [80, 100]
    const merged = mergeWatchIntervals([
      [0, 20],
      [10, 30],
      [80, 100],
    ]);
    expect(merged).toEqual([
      [0, 30],
      [80, 100],
    ]);
  });

  it('handles disordered, nested, and adjacent intervals properly', () => {
    // [20, 30], [0, 10], [5, 15], [30, 40]
    const merged = mergeWatchIntervals([
      [20, 30],
      [0, 10],
      [5, 15],
      [30, 40],
    ]);
    // [0, 15] and [20, 40]
    expect(merged).toEqual([
      [0, 15],
      [20, 40],
    ]);
  });

  it('calculates unique seconds watched without double counting overlaps', () => {
    // [0, 20] and [80, 100] on a 100-second video -> 40 seconds (NOT 100)
    const unique = calculateUniqueSeconds(
      [
        [0, 20],
        [80, 100],
      ],
      100
    );
    expect(unique).toBe(40);
  });

  it('clamps unique seconds to authoritative version duration', () => {
    // Version duration is 60 seconds, telemetry claims intervals up to 120
    const unique = calculateUniqueSeconds([[0, 120]], 60);
    expect(unique).toBe(60);
  });

  it('calculates completion percent and completion threshold', () => {
    expect(calculateCompletionPercent(57, 60)).toBe(95);
    expect(isCompleted(95)).toBe(true);
    expect(isCompleted(94)).toBe(false);
  });
});

describe('VSL Observational Cohort Analysis (Correction 8)', () => {
  it('derives observational segmentation performance without claiming causation', () => {
    const high = [{ closedWon: true }, { closedWon: true }, { closedWon: false }];
    const low = [{ closedWon: false }, { closedWon: false }, { closedWon: true }, { closedWon: false }];

    const result = deriveObservationalSegmentPerformance(high, low);
    expect(result.highEngagementSegment.closeRatePercent).toBe('66.7%');
    expect(result.lowEngagementSegment.closeRatePercent).toBe('25.0%');
    expect(result.disclaimer).toContain('Observational segmentation only');
    expect(result.disclaimer).toContain('do not establish causal impact');
  });
});

describe('Form Validation, Hashing, and Origin Security (Corrections 7, 9, 11)', () => {
  it('produces deterministic hash of submission payload regardless of key order', () => {
    const p1 = { name: 'Alice', email: 'alice@example.com', company: 'Acme' };
    const p2 = { email: 'alice@example.com', company: 'Acme', name: 'Alice' };

    const h1 = hashSubmissionPayload(p1);
    const h2 = hashSubmissionPayload(p2);
    expect(h1).toBe(h2);

    const h3 = hashSubmissionPayload({ ...p1, name: 'Bob' });
    expect(h1).not.toBe(h3);
  });

  it('validates allowed origins in production and permits localhost in development', () => {
    const allowed = ['https://mysite.com', 'https://app.mysite.com'];

    // In dev: localhost is allowed
    expect(validateOrigin('http://localhost:3000', allowed, false, true)).toBe(true);
    expect(validateOrigin('http://127.0.0.1:8080', allowed, false, true)).toBe(true);

    // In prod: strict match required
    expect(validateOrigin('https://mysite.com', allowed, false, false)).toBe(true);
    expect(validateOrigin('http://localhost:3000', allowed, false, false)).toBe(false);
    expect(validateOrigin('https://malicious.com', allowed, false, false)).toBe(false);
    expect(validateOrigin(null, allowed, false, false)).toBe(false);

    // Public any origin mode explicitly enabled
    expect(validateOrigin('https://any-site.org', [], true, false)).toBe(true);
  });

  it('rejects field keys with invalid characters and enforces length limits', () => {
    const valid = formFieldDefinitionSchema.safeParse({
      key: 'valid_key_1',
      label: 'Valid Field',
      field_type: 'text',
    });
    expect(valid.success).toBe(true);

    const invalidKey = formFieldDefinitionSchema.safeParse({
      key: '<script>alert(1)</script>',
      label: 'XSS Field',
      field_type: 'text',
    });
    expect(invalidKey.success).toBe(false);
  });

  it('rejects oversized input answers (Correction 7)', () => {
    const hugeString = 'a'.repeat(3000);
    const result = publicSubmitFormSchema.safeParse({
      publicKey: 'form_key_123',
      answers: {
        field1: hugeString,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('Rate Limiter Abstraction (Correction 1)', () => {
  it('enforces limit within sliding window and resets correctly', async () => {
    const limiter = new MemoryRateLimiter();
    const key = 'test_client_1';

    // 3 requests allowed per 5 seconds
    const r1 = await limiter.limit(key, 3, 5);
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await limiter.limit(key, 3, 5);
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.limit(key, 3, 5);
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4th request exceeds rate limit
    const r4 = await limiter.limit(key, 3, 5);
    expect(r4.success).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.resetMs).toBeGreaterThan(0);
  });
});
