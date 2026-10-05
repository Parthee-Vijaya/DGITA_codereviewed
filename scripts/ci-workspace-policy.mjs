import { basename, sep } from "node:path";
const excluded = new Set([".git", "node_modules", "work", "outputs", ".wrangler", ".vinext", "dist", ".vercel", ".codex", ".claude", "test-results", "playwright-report"]);

export function includeInTestWorkspace(relativePath, workerRuntime) {
  const segments = relativePath.split(sep);
  // Production Next's external-package links are part of the build artifact.
  if (segments.some((part, index) => excluded.has(part) && !(part === "node_modules" && index === 1 && segments[0] === ".next"))) return false;
  if (segments[0] === ".next" && (workerRuntime || segments[1] === "cache")) return false;
  const name = basename(relativePath);
  if (/^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)/u.test(name)) return false;
  if (/\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/iu.test(name)) return false;
  return true;
}
