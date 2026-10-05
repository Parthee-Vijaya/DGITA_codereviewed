import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Return only the commit and cleanliness; never retain Git paths, logs or environment values. */
export async function readSourceState(project) {
  async function git(args) {
    try {
      const { stdout } = await execute("git", ["--no-optional-locks", "-C", project, ...args], {
        timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8",
      });
      return stdout;
    } catch {
      throw new Error("Runtime source provenance could not be verified.");
    }
  }
  const before = (await git(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  const status = await git(["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]);
  const after = (await git(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(before) || before !== after) {
    throw new Error("Runtime source changed while provenance was being read.");
  }
  return { sha: before, clean: status.length === 0 };
}

export function requireCleanSource(source) {
  if (!source?.clean) throw new Error("Runtime proof requires a clean committed source tree.");
}

export function requireUnchangedSource(start, end) {
  requireCleanSource(start);
  requireCleanSource(end);
  if (start.sha !== end.sha) throw new Error("Runtime source commit changed during the run.");
}

export function sourceEvidence(start, end) {
  return {
    sha: start?.sha ?? null,
    cleanAtStart: start?.clean ?? null,
    shaAtEnd: end?.sha ?? null,
    cleanAtEnd: end?.clean ?? null,
    verifiedUnchanged: Boolean(start?.clean && end?.clean && start.sha === end.sha),
    buildProvenance: "not_attested_by_runtime_runner",
  };
}
