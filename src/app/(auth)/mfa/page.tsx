import { requireUser } from "@/server/auth/session";
import { safeReturnPath } from "@/modules/auth/redirects";
import { MfaForm } from "./mfa-form";
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireUser();
  const query = await searchParams;
  return <main id="main" className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-200 bg-white p-8"><h1 className="text-2xl font-semibold">Secure your account</h1><p className="muted my-4 text-sm">Administrator access requires an authenticator code. Add an authenticator if you haven’t set one up yet.</p><MfaForm next={safeReturnPath(query.next)} /></main>;
}
