import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { transform, transformSync } from "@esbuild-kit/core-utils";

const run=promisify(execFile);
const project=resolve(import.meta.dirname,"..");

test("the legacy Drizzle loader remains compatible with patched esbuild transforms",async()=>{
  const source="type Value = { count: number }; const input: Value = {count: 7}; export const count = input.count;";
  const synchronous=transformSync(source,join(project,"synthetic.ts"));
  const context={module:{exports:{}},exports:{}};
  vm.runInNewContext(synchronous.code,context);
  assert.equal(context.module.exports.count,7);
  assert.ok(synchronous.map);
  const asynchronous=await transform(source,join(project,"synthetic.mts"));
  const transformedModule=await import(`data:text/javascript;base64,${Buffer.from(asynchronous.code).toString("base64")}`);
  assert.equal(transformedModule.count,7);assert.ok(asynchronous.map);
});

test("Drizzle generates and validates the repository schema in a disposable directory",async()=>{
  const temporary=await mkdtemp(join(tmpdir(),"dgita-tooling-"));
  try {
    const output=join(temporary,"generated");
    const config=join(temporary,"drizzle.config.ts");
    await writeFile(config,`export default ${JSON.stringify({out:"./generated",schema:join(project,"db/schema.ts"),dialect:"sqlite"})};\n`);
    const cli=join(project,"node_modules/drizzle-kit/bin.cjs");
    await run(process.execPath,[cli,"generate",`--config=${config}`],{cwd:temporary,timeout:30000});
    const files=await readdir(output);const sql=await readFile(join(output,files.find(file=>file.endsWith(".sql"))),"utf8");
    assert.match(sql,/CREATE TABLE `portal_mail_outbox`/u);
    assert.match(sql,/CREATE TABLE `portal_application_versions`/u);
    await run(process.execPath,[cli,"check",`--config=${config}`],{cwd:temporary,timeout:30000});
  } finally {await rm(temporary,{recursive:true,force:true});}
});
