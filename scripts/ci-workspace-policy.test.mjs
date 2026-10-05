import assert from "node:assert/strict";
import test from "node:test";
import { includeInTestWorkspace } from "./ci-workspace-policy.mjs";

test("isolated runtime excludes credentials, database files and prior browser evidence",()=>{
  for(const path of [".env", ".env.production", "nested/.dev.vars", "local.sqlite", "private/foo.sqlite3-wal", "local.DB-shm", "state.db-journal", "test-results/data.json", "playwright-report/index.html", "node_modules/anything", "work/secret.json"])
    assert.equal(includeInTestWorkspace(path,false),false,path);
});
test("Next executable external links survive copying while development artifacts do not",()=>{
  assert.equal(includeInTestWorkspace(".next/node_modules/@libsql/client",false),true);
  assert.equal(includeInTestWorkspace(".next/server/app/api/cases/route.js",false),true);
  assert.equal(includeInTestWorkspace(".next/cache/anything",false),false);
  assert.equal(includeInTestWorkspace(".next/server/app.js",true),false);
  for(const path of ["db/schema.ts","drizzle/0001.sql","tests/a11y/application.spec.ts"]) assert.equal(includeInTestWorkspace(path,true),true);
});
