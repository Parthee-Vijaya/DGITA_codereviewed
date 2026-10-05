import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

// Official release-asset SHA-256 digests verified via GitHub API on 2026-10-05.
// Review version and digest together; never execute a downloaded shell installer.
const tools = {
  gitleaks: {
    repository: "gitleaks/gitleaks",
    version: "8.30.1",
    platforms: {
      "linux-x64": ["linux_x64", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"],
      "darwin-arm64": ["darwin_arm64", "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"],
    },
  },
  actionlint: {
    repository: "rhysd/actionlint",
    version: "1.7.12",
    platforms: {
      "linux-x64": ["linux_amd64", "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"],
      "darwin-arm64": ["darwin_arm64", "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"],
    },
  },
};

const [name, outputDirectory = "work/ci-tools"] = process.argv.slice(2);
const tool = tools[name];
const platform = tool?.platforms[`${process.platform}-${process.arch}`];
if (!platform) throw new Error("Choose gitleaks or actionlint on Linux x64 or macOS arm64.");
const [archivePlatform, expectedHash] = platform;
const asset = `${name}_${tool.version}_${archivePlatform}.tar.gz`;
const url = `https://github.com/${tool.repository}/releases/download/v${tool.version}/${asset}`;
const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw new Error(`Could not download ${name}: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(archive).digest("hex") !== expectedHash) {
  throw new Error(`SHA-256 verification failed for ${name}.`);
}
const temporary = await mkdtemp(join(tmpdir(), "dgita-ci-tool-"));
const destination = resolve(outputDirectory);
try {
  await mkdir(destination, { recursive: true });
  const archivePath = join(temporary, asset);
  await writeFile(archivePath, archive);
  // Extract only the named executable, never arbitrary archive paths.
  execFileSync("tar", ["-xzf", archivePath, "-C", destination, name]);
  await chmod(join(destination, name), 0o755);
  console.log(`Verified ${name} ${tool.version}: ${join(destination, name)}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
