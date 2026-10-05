import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readSourceState, requireCleanSource, requireUnchangedSource, sourceEvidence } from "../scripts/ci-source-provenance.mjs";

async function repository(t) {
  const path = await mkdtemp(join(tmpdir(), "dgita-provenance-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", path, ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  git("init", "--quiet");
  git("config", "user.name", "Synthetic CI");
  git("config", "user.email", "ci@example.invalid");
  await writeFile(join(path, "source.txt"), "original\n");
  await writeFile(join(path, ".gitignore"), "generated/\n");
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic baseline");
  return { path, git };
}

test("clean exact-commit source has matching start/end provenance", async (t) => {
  const { path, git } = await repository(t);
  const before = await readSourceState(path);
  const after = await readSourceState(path);
  assert.deepEqual(before, { sha: git("rev-parse", "HEAD"), clean: true });
  requireUnchangedSource(before, after);
  assert.deepEqual(sourceEvidence(before, after), { sha: before.sha, cleanAtStart: true, shaAtEnd: before.sha,
    cleanAtEnd: true, verifiedUnchanged: true, buildProvenance: "not_attested_by_runtime_runner" });
});

for (const change of ["unstaged", "staged", "untracked"]) {
  test(`${change} source changes reject runtime evidence without exposing file paths`, async (t) => {
    const { path, git } = await repository(t);
    const before = await readSourceState(path);
    await writeFile(join(path, change === "untracked" ? "sensitive-name.txt" : "source.txt"), "changed\n");
    if (change === "staged") git("add", "source.txt");
    const after = await readSourceState(path);
    assert.equal(after.clean, false);
    assert.throws(() => requireCleanSource(after), /clean committed source/u);
    assert.throws(() => requireUnchangedSource(before, after), /clean committed source/u);
    const evidence = sourceEvidence(before, after);
    assert.equal(evidence.verifiedUnchanged, false);
    assert.equal(JSON.stringify(evidence).includes("sensitive-name"), false);
  });
}

test("a different clean commit cannot inherit the previous runtime result", async (t) => {
  const { path, git } = await repository(t);
  const before = await readSourceState(path);
  await writeFile(join(path, "source.txt"), "new commit\n");
  git("add", "source.txt");
  git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic follow-up");
  const after = await readSourceState(path);
  assert.equal(after.clean, true);
  assert.notEqual(before.sha, after.sha);
  assert.throws(() => requireUnchangedSource(before, after), /commit changed/u);
  assert.equal(sourceEvidence(before, after).verifiedUnchanged, false);
});

test("ignored generated evidence does not change source provenance", async (t) => {
  const { path } = await repository(t);
  const before = await readSourceState(path);
  await mkdir(join(path, "generated"));
  await writeFile(join(path, "generated", "result.json"), "{}\n");
  requireUnchangedSource(before, await readSourceState(path));
});

test("missing Git source or failed end observation cannot produce a provenance success", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "dgita-no-provenance-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  await assert.rejects(readSourceState(path), { message: "Runtime source provenance could not be verified." });
  const evidence = sourceEvidence({ sha: "a".repeat(40), clean: true }, null);
  assert.equal(evidence.verifiedUnchanged, false);
  assert.equal(evidence.shaAtEnd, null);
});
