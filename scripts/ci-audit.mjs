import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function evaluateAudit(full, production, lock, policy, now = new Date()) {
  const errors = [];
  const accepted = [];
  if (!full?.vulnerabilities || !production?.vulnerabilities || full.error || production.error || !lock?.packages || policy?.schemaVersion !== 1) {
    return { errors: ["Missing or invalid audit, lockfile or policy data."], accepted };
  }
  for (const name of Object.keys(production.vulnerabilities)) {
    errors.push(`Production dependency has a vulnerability: ${name}`);
  }
  function leaves(name, seen = new Set()) {
    if (seen.has(name)) throw new Error(`Cyclic audit dependency chain: ${name}`);
    const vulnerability = full.vulnerabilities[name];
    if (!vulnerability?.via?.length) throw new Error(`Unresolved audit dependency chain: ${name}`);
    return vulnerability.via.flatMap((via) => typeof via === "string" ? leaves(via, new Set([...seen, name])) : [via]);
  }
  for (const [name, vulnerability] of Object.entries(full.vulnerabilities)) {
    let advisories;
    try { advisories = [...new Map(leaves(name).map((advisory) => [advisory.source, advisory])).values()]; } catch (error) { errors.push(error.message); continue; }
    if (!vulnerability.nodes?.length) errors.push(`Missing dependency nodes: ${name}`);
    for (const advisory of advisories) {
      const exception = policy.exceptions.find((item) => item.url === advisory.url && item.source === advisory.source && item.vulnerablePackage === advisory.name && item.range === advisory.range && item.severity === advisory.severity);
      if (!exception || !Number.isFinite(Date.parse(exception.expiresAt)) || Date.parse(exception.expiresAt) <= now.getTime()) {
        errors.push(`No current, exact exception for ${name}: ${advisory.url}`);
        continue;
      }
      for (const path of vulnerability.nodes) {
        const node = lock.packages[path];
        if (!node || node.dev !== true || !exception.allowedAffectedNodes.some((item) => item.package === name && item.path === path && item.version === node.version)) {
          errors.push(`Unapproved dependency node for ${exception.advisory}: ${path}@${node?.version ?? "unknown"}`);
        } else {
          accepted.push({ advisory: exception.advisory, package: name, path, version: node.version, expiresAt: exception.expiresAt });
        }
      }
    }
  }
  return { errors: [...new Set(errors)], accepted };
}

async function main() {
  const project = resolve(process.argv[2] ?? ".");
  const policyFile = resolve(process.argv[3] ?? ".github/dependency-audit-policy.json");
  const output = resolve(process.argv[4] ?? "work/ci/dependencies");
  await mkdir(output, { recursive: true });
  function audit(args) {
    const result = spawnSync("npm", ["audit", "--json", ...args], { cwd: project, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    if (result.error || ![0, 1].includes(result.status)) throw new Error(`npm audit could not complete (${result.status}).`, { cause: result.error });
    const report = JSON.parse(result.stdout);
    if (report.error || !report.vulnerabilities) throw new Error("npm audit returned an error or incomplete report.");
    return report;
  }
  const full = audit([]);
  const production = audit(["--omit=dev"]);
  await writeFile(resolve(output, "npm-audit.json"), JSON.stringify(full, null, 2));
  await writeFile(resolve(output, "npm-audit-production.json"), JSON.stringify(production, null, 2));
  const lock = JSON.parse(await readFile(resolve(project, "package-lock.json"), "utf8"));
  const policy = JSON.parse(await readFile(policyFile, "utf8"));
  const result = evaluateAudit(full, production, lock, policy);
  await writeFile(resolve(output, "policy-result.json"), JSON.stringify({ ...result, checkedAt: new Date().toISOString(), counts: full.metadata?.vulnerabilities, productionCounts: production.metadata?.vulnerabilities }, null, 2));
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Production: no known vulnerabilities. Development: ${result.accepted.length} exact dependency-node exceptions, expires no later than ${policy.reviewDeadline}. See artifacts; findings remain present.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
