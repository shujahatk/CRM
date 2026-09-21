export type Scenario = { name: string; user?: number; dbRole?: "anon" | "authenticated"; aal?: "aal1" | "aal2"; sql: string; count?: number; error?: string; scalar?: unknown };
const w = "'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'";
const other = "'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'";
const member = (n: number) => `'10000000-0000-4000-8000-${String(n).padStart(12, "0")}'`;
const promote = (n: number, workspace = w) => `select api.set_membership_role(${workspace},${member(n)},'admin',true,1)`;
export const scenarios: Scenario[] = [
  { name: "anon cannot select tables", dbRole: "anon", sql: "select * from crm.workspaces", error: "42501" },
  { name: "anon cannot invoke RPC", dbRole: "anon", sql: "select * from api.my_access()", error: "42501" },
  { name: "authenticated role without identity sees nothing", sql: "select * from crm.workspaces", count: 0 },
  { name: "setter sees own workspace", user: 3, sql: "select * from crm.workspaces", count: 1 },
  { name: "cross-workspace direct select returns nothing", user: 3, sql: `select * from crm.memberships where workspace_id=${other}`, count: 0 },
  { name: "cross-workspace RPC returns nothing", user: 3, sql: `select * from api.workspace_context(${other})`, count: 0 },
  { name: "setter cannot become admin by RPC", user: 3, sql: promote(3), error: "42501" },
  { name: "setter cannot update own role directly", user: 3, sql: `update crm.memberships set role='admin' where id=${member(3)}`, error: "42501" },
  { name: "closer cannot modify roles", user: 4, sql: promote(3), error: "42501" },
  { name: "manager cannot escalate privileges", user: 2, sql: promote(2), error: "42501" },
  { name: "read-only cannot invoke writes", user: 5, sql: `select api.create_team(${w},'Injected')`, error: "42501" },
  { name: "read-only cannot directly insert", user: 5, sql: `insert into crm.workspaces(name) values('Injected')`, error: "42501" },
  { name: "inactive membership has no workspace access", user: 6, sql: "select * from crm.workspaces", count: 0 },
  { name: "inactive membership has no directory access", user: 6, sql: "select * from crm.memberships", count: 0 },
  { name: "inactive membership absent from routing metadata", user: 6, sql: "select * from api.my_access()", count: 0 },
  { name: "setter sees self only", user: 3, sql: `select * from api.list_members(${w})`, count: 1 },
  { name: "manager sees managed team members only", user: 2, sql: `select * from api.list_members(${w})`, count: 2 },
  { name: "manager cannot inspect unrelated team", user: 2, sql: "select * from crm.teams where name='Team B'", count: 0 },
  { name: "admin sees own workspace directory", user: 1, sql: `select * from api.list_members(${w})`, count: 6 },
  { name: "admin cannot see other workspace", user: 1, sql: `select * from api.workspace_context(${other})`, count: 0 },
  { name: "admin cannot mutate other workspace", user: 1, sql: promote(7, other), error: "42501" },
  { name: "admin without MFA sees no workspace data", user: 1, aal: "aal1", sql: "select * from crm.memberships", count: 0 },
  { name: "admin without MFA cannot mutate", user: 1, aal: "aal1", sql: promote(3), error: "42501" },
  { name: "admin may see own minimal MFA routing metadata", user: 1, aal: "aal1", sql: "select * from api.my_access()", count: 1 },
  { name: "admin role change succeeds through command", user: 1, sql: `${promote(3)}; select role::text as result from crm.memberships where id=${member(3)}`, scalar: "admin" },
  { name: "admin direct update still denied", user: 1, sql: `update crm.memberships set role='admin' where id=${member(3)}`, error: "42501" },
  { name: "stale version rejected", user: 1, sql: `select api.set_membership_role(${w},${member(3)},'closer',true,99)`, error: "40001" },
  { name: "owner cannot be demoted through ordinary role command", user: 1, sql: promote(1), error: "42501" },
  { name: "cross-workspace team membership denied", user: 1, sql: `select api.set_team_member(${w},'20000000-0000-4000-8000-000000000001',${member(7)},false)`, error: "42501" },
  { name: "setter cannot acquire manager team flag", user: 1, sql: `select api.set_team_member(${w},'20000000-0000-4000-8000-000000000001',${member(3)},true)`, error: "42501" },
  { name: "admin can create team", user: 1, sql: `select api.create_team(${w},'New team'); select name as result from crm.teams where name='New team'`, scalar: "New team" },
  { name: "invitation private even to admin", user: 1, sql: "select * from private.invitations", error: "42501" },
  { name: "audit private even to admin", user: 1, sql: "select * from private.audit_logs", error: "42501" },
  { name: "bootstrap inaccessible to application", user: 1, sql: "select private.bootstrap_workspace('00000000-0000-4000-8000-000000000001','Injected','UTC','USD')", error: "42501" },
  { name: "setter cannot issue invitation", user: 3, sql: `select api.issue_invitation(${w},'person@example.test','admin')`, error: "42501" },
  { name: "invitation requires exact verified email", user: 3, sql: "select api.accept_invitation(repeat('a',64))", error: "42501" },
  { name: "unconfirmed user cannot accept invitation", user: 9, sql: "select api.accept_invitation(repeat('b',64))", error: "42501" },
  { name: "invited verified user gains correct workspace", user: 8, sql: "select api.accept_invitation(repeat('a',64)) as result", scalar: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  { name: "invitation cannot be used twice", user: 8, sql: "select api.accept_invitation(repeat('a',64)); select api.accept_invitation(repeat('a',64))", error: "42501" },
  { name: "unknown invitation rejected", user: 8, sql: "select api.accept_invitation(repeat('c',64))", error: "42501" },
  { name: "forged metadata admin role has no effect", user: 3, sql: promote(3), error: "42501" },
  { name: "demotion takes effect with same JWT", user: 1, sql: `select api.set_membership_role(${w},${member(3)},'setter',false,1); select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","aal":"aal2"}',true); select * from crm.workspaces`, count: 0 },
];
export function identitySql(scenario: Scenario) {
  const claims = { sub: scenario.user ? `00000000-0000-4000-8000-${String(scenario.user).padStart(12, "0")}` : undefined,
    aal: scenario.aal ?? "aal2", role: "authenticated", user_metadata: { role: "admin" } };
  return `set local role ${scenario.dbRole ?? "authenticated"}; select set_config('request.jwt.claims','${JSON.stringify(claims)}',true);`;
}
