import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";
import { safeReturnPath } from "@/modules/auth/redirects";
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const query = await searchParams;
  return <main id="main" className="min-h-screen lg:grid lg:grid-cols-[1fr_1fr]">
    <section className="relative flex flex-col justify-between bg-[#153e34] p-8 lg:min-h-screen lg:p-14">
      <Brand light />
      <div className="my-16 max-w-lg lg:my-28"><p className="mb-5 text-xs font-semibold uppercase tracking-[.22em] text-[#a3cfbc]">A focused sales workspace</p>
        <h1 className="text-4xl leading-tight font-medium tracking-tight text-white lg:text-6xl">More focus.<br />Better conversations.</h1>
        <p className="mt-6 max-w-sm text-base leading-relaxed text-[#c0d5cb]">One place for your team to work together. Built around the relationships that matter.</p></div>
      <p className="text-xs text-[#aec5ba]">80/20 CRM · Private team access</p>
    </section>
    <section className="flex items-center justify-center px-6 py-16 lg:p-16"><div className="w-full max-w-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[.18em] text-[#116c58]">Welcome back</p>
      <h2 className="text-3xl font-semibold tracking-tight">Sign in to your workspace</h2>
      <p className="muted mt-3 mb-8 text-sm leading-relaxed">Use the account provided by your workspace administrator.</p>
      {query.error && <p role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">We couldn’t verify that sign-in link. Please sign in again.</p>}
      <LoginForm next={safeReturnPath(query.next)} />
      <p className="muted mt-7 text-sm">Need access or help signing in? Contact your workspace administrator.</p>
    </div></section>
  </main>;
}
