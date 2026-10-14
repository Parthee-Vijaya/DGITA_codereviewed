import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { createLibsqlD1Adapter } from "../db/vercel-persistence.ts";

test("an active in-memory transaction rejects overlapping adapter work without losing committed data", async () => {
  const client = createClient({ url: ":memory:" });
  const DB = createLibsqlD1Adapter(client);
  try {
    await client.execute("CREATE TABLE lifecycle_records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    await DB.prepare("INSERT INTO lifecycle_records VALUES (?, ?)").bind(1, "saved before transaction").run();
    const transaction = await client.transaction("write");
    try {
      await transaction.execute("INSERT INTO lifecycle_records VALUES (2, 'committed')");
      await assert.rejects(DB.prepare("SELECT * FROM lifecycle_records").all(), { code: "TRANSACTION_ACTIVE" });
      await transaction.commit();
    } finally { transaction.close(); }
    assert.deepEqual((await DB.prepare("SELECT value FROM lifecycle_records ORDER BY id").all()).results,
      [{ value: "saved before transaction" }, { value: "committed" }]);

    const correction = await client.transaction("write");
    try {
      await correction.execute("UPDATE lifecycle_records SET value = 'uncommitted' WHERE id = 1");
      await correction.rollback();
    } finally { correction.close(); }
    assert.equal(await DB.prepare("SELECT value FROM lifecycle_records WHERE id = 1").first("value"), "saved before transaction");
  } finally { client.close(); }
});

test("closing a transaction rolls back its write and returns the client to normal adapter use", async () => {
  const client = createClient({ url: ":memory:" });
  const DB = createLibsqlD1Adapter(client);
  try {
    await client.execute("CREATE TABLE lifecycle_records (id INTEGER PRIMARY KEY)");
    const transaction = await client.transaction("write");
    await transaction.execute("INSERT INTO lifecycle_records VALUES (1)");
    transaction.close();
    assert.equal(await DB.prepare("SELECT COUNT(*) AS total FROM lifecycle_records").first("total"), 0);
    await DB.batch([DB.prepare("INSERT INTO lifecycle_records VALUES (2)"), DB.prepare("INSERT INTO lifecycle_records VALUES (3)")]);
    assert.deepEqual((await DB.prepare("SELECT id FROM lifecycle_records ORDER BY id").all()).results, [{ id: 2 }, { id: 3 }]);
  } finally { client.close(); }
});

test("closing a client settles both active and queued work with a typed error", { timeout: 5_000 }, async () => {
  const client = createClient({ url: ":memory:" });
  try {
    // No sleep or race against a timer: start both promises in one synchronous
    // turn, attach rejection handlers, then close before either can resume.
    const pending = Promise.allSettled([client.execute("SELECT 1"), client.execute("SELECT 2")]);
    client.close();
    const results = await pending;
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.equal(result.reason.code, "CLIENT_CLOSED");
    }
    await assert.rejects(client.execute("SELECT 3"), { code: "CLIENT_CLOSED" });
  } finally { client.close(); }
});
