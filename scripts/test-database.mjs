import pg from "pg";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { scenarios, identitySql } from "../tests/database/scenarios.ts";
const raw = process.env.TEST_DATABASE_URL;
if (!raw) { console.error("SKIPPED: TEST_DATABASE_URL is not configured. Requires a disposable local Supabase database with migrations applied."); process.exit(2); }
const url = new URL(raw);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Refusing database tests against non-local infrastructure");
const client = new pg.Client({ connectionString: raw });
await client.connect();
let failed = 0;
try {
  await client.query("begin");
  await client.query(await readFile("supabase/tests/fixtures.sql", "utf8"));
  for (const scenario of scenarios) {
    await client.query("savepoint scenario");
    try {
      await client.query(identitySql(scenario));
      let result;
      let caught;
      try { result = await client.query(scenario.sql); } catch (error) { caught = error; }
      if (scenario.error) assert.equal(caught?.code, scenario.error);
      else {
        if (caught) throw caught;
        const last = Array.isArray(result) ? result.at(-1) : result;
        if (scenario.count !== undefined) assert.equal(last.rows.length, scenario.count);
        if (scenario.scalar !== undefined) assert.deepEqual(last.rows[0], { result: scenario.scalar });
      }
      console.log(`PASS: ${scenario.name}`);
    } catch { failed++; console.error(`FAIL: ${scenario.name}`); }
    finally { await client.query("rollback to savepoint scenario"); }
  }
} finally { await client.query("rollback"); await client.end(); }
process.exitCode = failed ? 1 : 0;
