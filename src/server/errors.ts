export const errorMessages = {
  validation: "Check the supplied information.", unauthenticated: "Please sign in to continue.",
  forbidden: "You do not have access to this resource.", conflict: "This record changed. Refresh and try again.",
  rate_limited: "Too many attempts. Please try again later.", dependency_unavailable: "The service is temporarily unavailable.",
  internal: "Something went wrong. Please try again.",
} as const;
export type ErrorCode = keyof typeof errorMessages;
export class AppError extends Error {
  constructor(public readonly code: ErrorCode) { super(errorMessages[code]); this.name = "AppError"; }
}
export function databaseError(code?: string): AppError {
  return new AppError(code === "42501" ? "forbidden" : code === "40001" ? "conflict" :
    code?.startsWith("22") || code?.startsWith("23") ? "validation" : "dependency_unavailable");
}
export function publicError(error: unknown) {
  const code = error instanceof AppError ? error.code : "internal";
  return { code, message: errorMessages[code] };
}
