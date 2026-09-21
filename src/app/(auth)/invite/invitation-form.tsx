"use client";
import { useActionState } from "react";
import { acceptInvitation } from "@/modules/auth/actions";
import { SubmitButton } from "@/components/submit-button";
export function InvitationForm() {
  const [state, action] = useActionState(acceptInvitation, { message: "" });
  return <form action={action} className="space-y-5"><label htmlFor="token" className="block text-sm font-medium">Invitation code</label><input id="token" name="token" className="field" type="password" autoComplete="off" minLength={64} maxLength={64} required />{state.message && <p role="alert" className="text-sm text-red-800">{state.message}</p>}<SubmitButton>Accept invitation</SubmitButton></form>;
}
