import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const requireTool = createRequire(new URL("../.github/deployment-tools/package.json", import.meta.url));
const cli = new URL("../.github/deployment-tools/node_modules/vercel/dist/vc.js", import.meta.url).pathname;

test("patched Node CLI loads version and release command interfaces without credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dgita-cli-test-"));
  try {
    for (const args of [["--version"], ["pull", "--help"], ["build", "--help"], ["deploy", "--help"], ["promote", "--help"]]) {
      const result = spawnSync(process.execPath, [cli, ...args, "--global-config", directory], { env: { PATH: process.env.PATH, VERCEL_CLI_USE_NATIVE_BINARY: "false", VERCEL_TELEMETRY_DISABLED: "1", CI: "1" }, encoding: "utf8", timeout: 30_000 });
      assert.equal(result.status, 0, result.stderr);
      if (args[0] === "--version") assert.match(result.stdout + result.stderr, /62\.2\.0/u);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("Undici 6 override preserves request, fetch, Headers and Agent for local HTTP", async () => {
  const { request, fetch, Headers, Agent } = requireTool("undici");
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ method: req.method, header: req.headers["x-test"], body: Buffer.concat(chunks).toString() }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const dispatcher = new Agent();
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const response = await request(url, { method: "POST", headers: Object.fromEntries(new Headers({ "x-test": "verified" })), body: "synthetic", dispatcher });
    assert.deepEqual(await response.body.json(), { method: "POST", header: "verified", body: "synthetic" });
    const fetched = await fetch(url, { dispatcher }); assert.equal(fetched.status, 200); await fetched.text();
  } finally { await dispatcher.close(); await new Promise((done) => server.close(done)); }
});
test("patched archive and parser dependencies preserve normal build inputs", async () => {
  const tar = requireTool("tar"); const directory = await mkdtemp(join(tmpdir(), "dgita-tar-test-"));
  try {
    await writeFile(join(directory, "source.txt"), "synthetic deployment output");
    await tar.c({ cwd: directory, file: join(directory, "artifact.tar") }, ["source.txt"]);
    await mkdir(join(directory, "unpacked"));
    await tar.x({ cwd: join(directory, "unpacked"), file: join(directory, "artifact.tar") });
    assert.equal(await readFile(join(directory, "unpacked", "source.txt"), "utf8"), "synthetic deployment output");
  } finally { await rm(directory, { recursive: true, force: true }); }
  const Ajv = requireTool("ajv"); assert.equal(new Ajv().compile({ type: "object", required: ["version"], properties: { version: { type: "integer" } } })({ version: 3 }), true);
  assert.deepEqual({ ...requireTool("smol-toml").parse('name = "fixture"\nversion = 3') }, { name: "fixture", version: 3 });
  assert.deepEqual({ ...requireTool("js-yaml").load('version: 3\nname: fixture') }, { version: 3, name: "fixture" });
  assert.equal(requireTool("path-to-regexp").compile("/item/:id")({ id: "42" }), "/item/42");
  assert.equal(requireTool("minimatch").minimatch("app/page.tsx", "app/**/*.tsx"), true);
});
