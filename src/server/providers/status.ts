import "server-only";

export const STATUS_RANK: Record<string, number> = {
  draft: 0,
  queued: 1,
  accepted: 2,
  sent: 3,
  delivered: 4,
  read: 5,
};

export const TERMINAL_STATUSES = new Set(["failed", "bounced", "complained", "cancelled", "suppressed"]);

/**
 * Determines whether a message can transition from `currentStatus` to `nextStatus`.
 * Ensures monotonic progression for lifecycle delivery statuses (e.g. delivered cannot regress to sent),
 * while permitting transitions to terminal states.
 */
export function canTransitionStatus(currentStatus: string, nextStatus: string): boolean {
  if (currentStatus === nextStatus) return true;

  // Terminal states can be entered from any non-terminal state
  if (TERMINAL_STATUSES.has(nextStatus)) {
    return !TERMINAL_STATUSES.has(currentStatus);
  }

  // Once terminal, cannot transition back to progression ranks
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return false;
  }

  const currentRank = STATUS_RANK[currentStatus] ?? -1;
  const nextRank = STATUS_RANK[nextStatus] ?? -1;

  if (currentRank === -1 || nextRank === -1) {
    return false;
  }

  // Monotonic progression: only allow strictly greater rank
  return nextRank > currentRank;
}

/**
 * Reconciles the effective status given the current status and a new event status.
 * Returns the higher precedence status.
 */
export function reconcileStatus(currentStatus: string, incomingStatus: string): string {
  if (canTransitionStatus(currentStatus, incomingStatus)) {
    return incomingStatus;
  }
  return currentStatus;
}
