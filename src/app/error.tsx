"use client";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" className="mx-auto max-w-lg px-6 py-24"><h1 className="text-2xl font-semibold">We couldn’t open this page</h1><p className="muted my-4">Your session, access, or connection may have changed. Try again or contact your administrator.</p>{error.digest && <p className="muted mb-6 text-xs">Reference: {error.digest}</p>}<button className="primary" onClick={reset}>Try again</button></main>;
}
