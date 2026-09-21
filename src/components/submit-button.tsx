"use client";
import { useFormStatus } from "react-dom";
export function SubmitButton({ children, pendingLabel = "Please wait…" }: { children: React.ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <button className="primary w-full" type="submit" disabled={pending}>{pending ? pendingLabel : children}</button>;
}
