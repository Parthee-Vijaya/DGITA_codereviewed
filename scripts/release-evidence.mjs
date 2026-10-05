import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { EVIDENCE_SUITES, buildReleaseEvidence, evidenceCsv, validateControlRegister } from "./evidence-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function command(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1_000_000 });
  if (result.status !== 0) throw new Error("Source identity could not be verified.");
  return result.stdout.trim();
}
function sourceState() { return { commit: command(["rev-parse", "HEAD"]), clean: command(["status", "--porcelain", "--untracked-files=all"]) === "" }; }

export function generateReleaseEvidence(args = []) {
  if (!/^24\./u.test(process.versions.node)) throw new Error("Release evidence requires Node 24.");
  const referenceOnly = args.length === 1 && args[0] === "--references-only";
  const suiteArg = args.length === 0 ? "all" : args.length === 2 && args[0] === "--suite" ? args[1] : null;
  if (!referenceOnly && (!suiteArg || (suiteArg !== "all" && !Object.hasOwn(EVIDENCE_SUITES, suiteArg)))) {
    throw new Error("Use no arguments, --suite <registered-suite>|all or --references-only.");
  }
  const initialSource = sourceState();
  if (!referenceOnly && !initialSource.clean) throw new Error("Commit or isolate source changes before measuring release evidence.");
  const rawRegister = readFileSync(resolve(ROOT, "docs/governance/control-register.json"), "utf8");
  const register = validateControlRegister(JSON.parse(rawRegister));
  for (const control of register.controls) {
    for (const path of [...control.implementation_refs, ...control.test_refs]) {
      if (!existsSync(resolve(ROOT, path))) throw new Error("A control register source reference is missing.");
    }
  }
  const measurements = [];
  const suites = referenceOnly ? [] : suiteArg === "all" ? Object.keys(EVIDENCE_SUITES) : [suiteArg];
  // Deliberately omit NODE_OPTIONS and application/provider credentials.
  const childEnv = { PATH: process.env.PATH ?? "", TZ: "UTC", LANG: "C.UTF-8" };
  for (const id of suites) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter", "./scripts/redacted-test-reporter.mjs", ...EVIDENCE_SUITES[id]], {
      cwd: ROOT, env: childEnv, encoding: "utf8", timeout: 120_000, maxBuffer: 1_000_000,
    });
    // Child raw output is held in memory only, never echoed or archived.
    if (run.error || run.signal || !Number.isInteger(run.status)) throw new Error("Selected evidence test execution failed.");
    let summary;
    try { summary = JSON.parse(run.stdout.trim()); } catch { throw new Error("Selected test summary is invalid or incomplete."); }
    measurements.push({ id, exit_code: run.status, summary });
  }
  const finalSource = sourceState();
  if (initialSource.commit !== finalSource.commit || initialSource.clean !== finalSource.clean) throw new Error("Source changed during evidence collection.");
  const evidence = buildReleaseEvidence({ register, source: { ...finalSource,
    node_version: process.versions.node, register_sha256: createHash("sha256").update(rawRegister).digest("hex") },
    measurements, generatedAt: new Date().toISOString() });
  const output = resolve(ROOT, "work/release-evidence");
  mkdirSync(output, { recursive: true });
  for (const [name, contents] of [["release-evidence.json", JSON.stringify(evidence, null, 2) + "\n"], ["control-evidence.csv", evidenceCsv(evidence)]]) {
    const temporary = resolve(output, `${name}.tmp`);
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, resolve(output, name));
  }
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const evidence = generateReleaseEvidence(process.argv.slice(2));
    process.stdout.write(JSON.stringify({ output: "work/release-evidence", measured_suites: evidence.measurements.length,
      production_approval: false }) + "\n");
    if (evidence.measurements.some((run) => run.result !== "passed")) process.exitCode = 1;
  } catch {
    process.stderr.write("Release evidence generation rejected; review configuration, source state and selected tests locally.\n");
    process.exitCode = 1;
  }
}
