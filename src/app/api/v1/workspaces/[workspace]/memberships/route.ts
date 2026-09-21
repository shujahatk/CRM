import { z } from "zod";
import { authenticatedClient } from "@/server/auth/session";
import { changeMembership } from "@/modules/workspace/commands";
import { AppError, databaseError, publicError } from "@/server/errors";
import { serverEnv } from "@/server/config/env";
import { log } from "@/server/telemetry/logger";

function fail(error: unknown) {
  const result = publicError(error);
  const requestId = crypto.randomUUID();
  log({ event: "request.failed", outcome: "error", requestId, errorCode: result.code });
  const status = { unauthenticated: 401, forbidden: 403, validation: 400, conflict: 409, rate_limited: 429, dependency_unavailable: 503, internal: 500 }[result.code];
  return Response.json({ error: result, requestId }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function GET(_request: Request, { params }: { params: Promise<{ workspace: string }> }) {
  try {
    const { client } = await authenticatedClient();
    const { workspace } = await params;
    if (!z.uuid().safeParse(workspace).success) throw new AppError("validation");
    const context = await client.rpc("workspace_context", { p_workspace: workspace });
    if (context.error) throw databaseError(context.error.code);
    if (!context.data.length) throw new AppError("forbidden");
    const { data, error } = await client.rpc("list_members", { p_workspace: workspace });
    if (error) throw databaseError(error.code);
    return Response.json({ members: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ workspace: string }> }) {
  try {
    // Cookie-authenticated mutation: compare against configured origin, never forwarded host.
    if (request.headers.get("origin") !== new URL(serverEnv().APP_BASE_URL).origin) throw new AppError("forbidden");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("validation");
    const reader = request.body?.getReader();
    if (!reader) throw new AppError("validation");
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new AppError("validation"); }
      chunks.push(part.value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new AppError("validation"); }
    const { workspace } = await params;
    const parsed = z.object({ memberId: z.uuid(), role: z.enum(["admin", "manager", "setter", "closer", "read_only"]), active: z.boolean(), version: z.number().int().positive() }).strict().safeParse(body);
    if (!parsed.success) throw new AppError("validation");
    await changeMembership({ ...parsed.data, workspaceId: workspace });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
