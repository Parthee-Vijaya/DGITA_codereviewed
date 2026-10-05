import { readFile } from "node:fs/promises";
import { createRecoveryBundle, restoreRecoveryBundle, verifyRecoveryBundle } from "./recovery-bundle.mjs";

const [command, ...args] = process.argv.slice(2);
const options = {};
try {
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--synthetic-test") { options.synthetic = true; continue; }
    if (!["--database", "--objects", "--output", "--bundle", "--digest"].includes(key) || options[key] !== undefined || !args[index + 1]) throw new Error("ARGUMENTS_INVALID");
    options[key] = args[++index];
  }
  let report;
  if (command === "verify") {
    report = await verifyRecoveryBundle(options["--bundle"], options["--digest"]);
  } else if (command === "restore" && options.synthetic) {
    report = await restoreRecoveryBundle({ directory: options["--bundle"], expectedDigest: options["--digest"], outputDirectory: options["--output"] });
  } else if (command === "export" && options.synthetic) {
    const index = JSON.parse(await readFile(options["--objects"], "utf8"));
    report = await createRecoveryBundle({ databasePath: options["--database"], outputDirectory: options["--output"],
      readObject: async (key) => {
        const filename = Object.hasOwn(index, key) ? index[key] : undefined;
        if (typeof filename !== "string") throw new Error("LOCAL_OBJECT_MISSING");
        return new Uint8Array(await readFile(filename));
      } });
  } else throw new Error("COMMAND_INVALID");
  console.log(JSON.stringify(report, null, 2));
} catch {
  // Errors/assertions may contain object names or row values. Never print them.
  console.error("Recovery operation failed. No complete result was issued. Inspect inputs in the restricted local test environment; existing targets are never overwritten.");
  console.error("See docs/recovery-exercise.md for commands, limits and quarantine requirements.");
  process.exitCode = 1;
}
