// Only known in-app destinations. Reject encoded separators, backslashes and protocol URLs.
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 200 || /[%\\\s?#]/.test(value)) return "/workspaces";
  return /^\/(workspaces|invite|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(value) ? value : "/workspaces";
}
