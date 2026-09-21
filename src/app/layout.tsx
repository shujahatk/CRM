import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "80/20 CRM", description: "Your team's sales workspace", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
