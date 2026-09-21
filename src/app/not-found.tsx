import Link from "next/link";
export default function NotFound() { return <main id="main" className="mx-auto max-w-lg px-6 py-24"><h1 className="text-2xl font-semibold">Page unavailable</h1><p className="muted my-4">This page doesn’t exist or isn’t available to your account.</p><Link className="text-[#116c58]" href="/workspaces">Return to your workspaces →</Link></main>; }
