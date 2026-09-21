import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
const ignored = new Set([".git", "node_modules", ".next", ".local", "coverage", "playwright-report", "test-results"]);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sb_secret_[A-Za-z0-9_-]{20,}/,
  /(?:ghp|github_pat)_[A-Za-z0-9_]{30,}/,
  /(?:sk_live|sk_test)_[A-Za-z0-9]{20,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@(?!127\.0\.0\.1|localhost)/,
];
let failures = 0;
let files = 0;
async function visit(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) { if (!ignored.has(item.name)) await visit(file); continue; }
    if (item.name.startsWith(".env") && item.name !== ".env.example") { console.error(`REVIEW local secret file: ${file}`); failures++; continue; }
    if (/\.(?:pdf|png|jpg|woff2?|ico|tsbuildinfo)$/.test(file) || item.name === "package-lock.json") continue;
    const content = await readFile(file, "utf8"); files++;
    if (patterns.some((pattern) => pattern.test(content))) { console.error(`FAIL potential credential in ${file}`); failures++; }
  }
}
await visit(process.cwd());
let buildExists = true;
try { await access(".next/static"); } catch { buildExists = false; }
if (buildExists) await visit(path.join(process.cwd(), ".next/static"));
console.log(`${failures ? "FAIL" : "PASS"}: scanned ${files} source/config/document files; ${failures} findings. Values are never printed.`);
process.exitCode = failures ? 1 : 0;
