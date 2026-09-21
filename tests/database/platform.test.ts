import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { beforeAll, afterAll, expect, it } from "vitest";
import { scenarios, identitySql } from "./scenarios";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile("tests/support/auth-compat.sql", "utf8"));
  for (const file of (await readdir("supabase/migrations")).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  await db.exec(await readFile("supabase/tests/fixtures.sql", "utf8"));
});
afterAll(async () => { if (db) await db.close(); });
for (const scenario of scenarios) {
  it(scenario.name, async () => {
    await db.exec("begin;");
    try {
      await db.exec(identitySql(scenario));
      if (scenario.error) await expect(db.exec(scenario.sql)).rejects.toMatchObject({ code: scenario.error });
      else {
        const results = await db.exec(scenario.sql);
        const last = results.at(-1);
        if (scenario.count !== undefined) expect(last?.rows).toHaveLength(scenario.count);
        if (scenario.scalar !== undefined) expect(last?.rows[0]).toEqual({ result: scenario.scalar });
      }
    } finally { await db.exec("rollback;"); }
  });
}
it("all tenant tables enable RLS", async () => {
  const result = await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('crm','private') and c.relkind='r' and not c.relrowsecurity");
  expect(result.rows).toHaveLength(0);
});
it("cross-tenant composite foreign key rejects owner-level bad writes", async () => {
  await expect(db.exec("insert into crm.team_memberships(workspace_id,team_id,membership_id,created_by_membership_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001')")).rejects.toMatchObject({ code: "23503" });
});
it("last owner constraint survives privileged direct SQL", async () => {
  await expect(db.exec("update crm.memberships set is_owner=false,role='setter' where id='10000000-0000-4000-8000-000000000001'")).rejects.toMatchObject({ code: "23514" });
});
it("audit journal rejects mutation even through elevated table access", async () => {
  await db.exec("insert into private.audit_logs(workspace_id,action,target_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')");
  await expect(db.exec("delete from private.audit_logs")).rejects.toMatchObject({ code: "42501" });
});
it("expired invitations cannot grant membership", async () => {
  await db.exec("begin; update private.invitations set created_at=now()-interval '3 days',expires_at=now()-interval '1 day' where intended_email='invited@example.test';");
  try {
    await db.exec(identitySql({ name: "expired", user: 8, sql: "" }));
    await expect(db.exec("select api.accept_invitation(repeat('a',64))")).rejects.toMatchObject({ code: "42501" });
  } finally { await db.exec("rollback"); }
});
it("revoked invitations cannot grant membership", async () => {
  await db.exec("begin; update private.invitations set revoked_at=now() where intended_email='invited@example.test';");
  try {
    await db.exec(identitySql({ name: "revoked", user: 8, sql: "" }));
    await expect(db.exec("select api.accept_invitation(repeat('a',64))")).rejects.toMatchObject({ code: "42501" });
  } finally { await db.exec("rollback"); }
});
it("existing inactive membership cannot be reactivated by invitation", async () => {
  await db.exec("begin; update private.invitations set intended_email='inactive@example.test' where intended_email='invited@example.test';");
  try {
    await db.exec(identitySql({ name: "inactive invite", user: 6, sql: "" }));
    await expect(db.exec("select api.accept_invitation(repeat('a',64))")).rejects.toMatchObject({ code: "42501" });
  } finally { await db.exec("rollback"); }
});
it("no API/private function inherits PUBLIC execute", async () => {
  const result = await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname in ('api','private') and a.grantee=0 and a.privilege_type='EXECUTE'");
  expect(result.rows).toHaveLength(0);
});
