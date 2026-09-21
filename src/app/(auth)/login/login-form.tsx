"use client";
import { useActionState } from "react";
import { login } from "@/modules/auth/actions";
import { SubmitButton } from "@/components/submit-button";
export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(login, { message: "" });
  return <form action={action} className="space-y-5">
    <input type="hidden" name="next" value={next} />
    <div><label htmlFor="email" className="mb-2 block text-sm font-medium">Email address</label><input className="field" id="email" name="email" type="email" autoComplete="email" maxLength={254} required /></div>
    <div><label htmlFor="password" className="mb-2 block text-sm font-medium">Password</label><input className="field" id="password" name="password" type="password" autoComplete="current-password" maxLength={256} required /></div>
    {state.message && <p role="alert" className="text-sm text-red-800">{state.message}</p>}
    <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
  </form>;
}
