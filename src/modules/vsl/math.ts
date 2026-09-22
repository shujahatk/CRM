/**
 * VSL Telemetry Math and Observational Segment Utilities
 *
 * Implements:
 * - Continuous watch interval merging (Interval Union Algorithm)
 * - Version-specific duration authority (Correction 6)
 * - Observational segment analysis (Correction 8)
 * - Avoidance of redundant telemetry bloat (Correction 12)
 */

export type Interval = [start: number, end: number];

/**
 * Merges overlapping or adjacent continuous watch intervals into non-overlapping disjoint intervals.
 * Example: [[0, 20], [80, 100], [10, 30]] -> [[0, 30], [80, 100]]
 */
export function mergeWatchIntervals(intervals: Interval[]): Interval[] {
  if (!intervals.length) return [];

  // Filter invalid intervals and normalize (start <= end)
  const valid = intervals
    .map(([s, e]): Interval => [Math.max(0, Math.min(s, e)), Math.max(0, Math.max(s, e))])
    .filter(([s, e]) => e > s);

  if (!valid.length) return [];

  // Sort ascending by start time, then end time
  valid.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged: Interval[] = [valid[0]];

  for (let i = 1; i < valid.length; i++) {
    const current = valid[i];
    const prev = merged[merged.length - 1];

    if (current[0] <= prev[1]) {
      // Overlapping or contiguous; extend previous interval if current reaches further
      prev[1] = Math.max(prev[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Calculates total unique seconds watched from intervals, clamped to authoritative version duration.
 */
export function calculateUniqueSeconds(intervals: Interval[], durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const merged = mergeWatchIntervals(intervals);

  let total = 0;
  for (const [start, end] of merged) {
    const clampedStart = Math.min(start, durationSeconds);
    const clampedEnd = Math.min(end, durationSeconds);
    if (clampedEnd > clampedStart) {
      total += clampedEnd - clampedStart;
    }
  }

  return Math.min(total, durationSeconds);
}

/**
 * Calculates watch completion percentage.
 */
export function calculateCompletionPercent(uniqueSeconds: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const pct = Math.round((uniqueSeconds / durationSeconds) * 100);
  return Math.min(100, Math.max(0, pct));
}

/**
 * Checks if session meets completion threshold (default 95%, configurable).
 */
export function isCompleted(completionPercent: number, thresholdPercent: number = 95): boolean {
  return completionPercent >= thresholdPercent;
}

export interface SegmentObservationalComparison {
  highEngagementSegment: {
    label: string; // e.g. ">80% watched"
    leadCount: number;
    closedWonCount: number;
    closeRatePercent: string;
  };
  lowEngagementSegment: {
    label: string; // e.g. "<20% watched"
    leadCount: number;
    closedWonCount: number;
    closeRatePercent: string;
  };
  disclaimer: string;
}

/**
 * Derives observational segmentation performance between engagement cohorts (Correction 8).
 * Strictly labeled observational correlation — does NOT claim causation.
 */
export function deriveObservationalSegmentPerformance(
  highLeads: { closedWon: boolean }[],
  lowLeads: { closedWon: boolean }[]
): SegmentObservationalComparison {
  const highTotal = highLeads.length;
  const highWon = highLeads.filter((l) => l.closedWon).length;
  const highRate = highTotal > 0 ? `${((highWon / highTotal) * 100).toFixed(1)}%` : '—';

  const lowTotal = lowLeads.length;
  const lowWon = lowLeads.filter((l) => l.closedWon).length;
  const lowRate = lowTotal > 0 ? `${((lowWon / lowTotal) * 100).toFixed(1)}%` : '—';

  return {
    highEngagementSegment: {
      label: 'High Engagement (>80% Watched)',
      leadCount: highTotal,
      closedWonCount: highWon,
      closeRatePercent: highRate,
    },
    lowEngagementSegment: {
      label: 'Low Engagement (<20% Watched)',
      leadCount: lowTotal,
      closedWonCount: lowWon,
      closeRatePercent: lowRate,
    },
    disclaimer:
      'Observational segmentation only. Differences in close rate reflect descriptive correlation among viewer cohorts and do not establish causal impact.',
  };
}
