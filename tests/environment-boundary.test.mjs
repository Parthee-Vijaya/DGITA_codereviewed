import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { createLibsqlD1Adapter } from "../db/vercel-persistence.ts";
import { portalSchemaStatements } from "../db/persistence.ts";
import { assertDatabaseEnvironment } from "../db/environment-guard.ts";

async function database() {
  const client = createClient({ url: ":memory:" });
  const DB = createLibsqlD1Adapter(client);
  await DB.batch(portalSchemaStatements.map((s) => DB.prepare(s)));
  return { client, DB };
}

test("pilot and production cannot use the same database in either direction", async () => {
  for (const stage of ["pilot", "production"]) {
    const { client, DB } = await database();
    try {
      await assertDatabaseEnvironment(DB, { DGITA_ENVIRONMENT: stage });
      await assertDatabaseEnvironment(DB, { DGITA_ENVIRONMENT: stage });
      await assert.rejects(assertDatabaseEnvironment(DB, {
        DGITA_ENVIRONMENT: stage === "pilot" ? "production" : "pilot",
      }), { code: "DATABASE_ENVIRONMENT_MISMATCH" });
    } finally { client.close(); }
  }
});

test("an unlabelled legacy database containing test identities cannot become production", async () => {
  const { client, DB } = await database();
  try {
    await DB.prepare("INSERT INTO portal_tenants (id, slug, name) VALUES ('legacy', 'legacy', 'Synthetic')").run();
    await DB.prepare("INSERT INTO portal_users (id, tenant_id, identity_provider, external_subject, email, display_name) VALUES ('test', 'legacy', 'dev', 'test', 'test@example.invalid', 'Synthetic')").run();
    await assert.rejects(assertDatabaseEnvironment(DB, { DGITA_ENVIRONMENT: "production" }), {
      code: "DATABASE_ENVIRONMENT_MISMATCH",
    });
    assert.equal(await DB.prepare("SELECT * FROM portal_environment").first(), null);
  } finally { client.close(); }
});
