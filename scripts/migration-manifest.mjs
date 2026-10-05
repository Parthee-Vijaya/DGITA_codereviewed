import { writeFile } from "node:fs/promises";
import { readMigrations } from "./migration-runner.mjs";

const migrations = await readMigrations(new URL("../drizzle/", import.meta.url).pathname);
await writeFile(new URL("../db/migration-manifest.json", import.meta.url),
  `${JSON.stringify(migrations.map(({ id, checksum }) => ({ id, checksum })), null, 2)}\n`);
console.log("Updated migration manifest. Review and commit it with the SQL migrations.");
