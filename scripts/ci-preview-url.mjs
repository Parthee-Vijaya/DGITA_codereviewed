import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";

const value = process.env.DEPLOYMENT_URL;
assert.equal(typeof value, "string", "Missing preview deployment URL.");
assert.ok(!/[\s\u0000-\u001f\u007f]/u.test(value), "Preview URL must contain one clean line.");
const url = new URL(value);
assert.ok(url.protocol === "https:" && /^[a-z0-9-]+\.vercel\.app$/u.test(url.hostname) && !url.username && !url.password && !url.port && (value === url.origin || value === `${url.origin}/`), "Unexpected preview deployment URL.");
assert.ok(process.env.GITHUB_OUTPUT, "Missing workflow output file.");
await appendFile(process.env.GITHUB_OUTPUT, `url=${url.origin}\n`);
