/**
 * Rate Limiter Abstraction (Correction 1)
 *
 * Local/test implementation is process-local in-memory.
 * Production architecture supports durable/distributed or platform-level rate limiter.
 * This file exposes a replaceable interface and does not claim production-grade
 * distributed guarantees when running with the local in-memory backend.
 */

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export interface RateLimiter {
  limit(key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * In-Memory Token Bucket / Sliding Window Rate Limiter.
 * Strictly for local development and unit/integration testing.
 * NOT a production security boundary across serverless instances.
 */
export class MemoryRateLimiter implements RateLimiter {
  private requests: Map<string, number[]> = new Map();

  async limit(key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const cutoff = now - windowMs;

    const timestamps = (this.requests.get(key) ?? []).filter((ts) => ts > cutoff);

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0];
      const resetMs = Math.max(0, oldest + windowMs - now);
      return {
        success: false,
        limit: maxRequests,
        remaining: 0,
        resetMs,
      };
    }

    timestamps.push(now);
    this.requests.set(key, timestamps);

    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests - timestamps.length,
      resetMs: windowMs,
    };
  }

  clear(): void {
    this.requests.clear();
  }
}

// Global default instance for local/test execution
const defaultLimiter = new MemoryRateLimiter();

let customLimiter: RateLimiter | null = null;

export function setRateLimiter(limiter: RateLimiter): void {
  customLimiter = limiter;
}

export function getRateLimiter(): RateLimiter {
  return customLimiter ?? defaultLimiter;
}
