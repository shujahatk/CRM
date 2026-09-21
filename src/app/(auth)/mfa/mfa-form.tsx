"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/modules/auth/browser";

export function MfaForm({ next }: { next: string }) {
  const router = useRouter();
  const [factor, setFactor] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true); setMessage("");
    try {
      const client = createSupabaseBrowserClient();
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      const existing = data.totp.find((item) => item.status === "verified");
      if (existing) { setFactor(existing.id); return; }
      // Remove only our own abandoned, unverified TOTP enrollment before starting again.
      for (const pending of data.all.filter((item) => item.factor_type === "totp" && item.status === "unverified")) {
        const removal = await client.auth.mfa.unenroll({ factorId: pending.id });
        if (removal.error) throw removal.error;
      }
      const enrollment = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "80/20 CRM" });
      if (enrollment.error) throw enrollment.error;
      setFactor(enrollment.data.id); setSecret(enrollment.data.totp.secret);
    } catch { setMessage("Unable to prepare your authenticator. Try again or contact your administrator."); }
    finally { setBusy(false); }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const { error } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({ factorId: factor, code });
      if (error) throw error;
      setSecret(""); setCode(""); router.replace(next); router.refresh();
    } catch { setMessage("The code could not be verified. Try a fresh code."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">{!factor ? <button className="primary w-full" onClick={prepare} disabled={busy}>Set up or verify authenticator</button> : <form onSubmit={verify} className="space-y-5">
    {secret && <div className="rounded-lg bg-slate-50 p-4"><p className="mb-2 text-sm">Add this setup key to your authenticator app. Keep it private.</p><code className="break-all text-sm">{secret}</code></div>}
    <label htmlFor="code" className="block text-sm font-medium">Six-digit code</label><input id="code" className="field" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /><button className="primary w-full" disabled={busy}>Verify code</button>
  </form>}{message && <p role="alert" className="text-sm text-red-800">{message}</p>}</div>;
}
