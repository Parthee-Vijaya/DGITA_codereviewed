// Test process preload only. The application build contains no fixture switch.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const { Agent, setGlobalDispatcher } = require(require.resolve("undici", { paths: [dirname(require.resolve("@vercel/blob"))] }));
const fixture = new URL(process.env.DGITA_FIXTURE_ORIGIN);
assert.equal(fixture.hostname, "127.0.0.1");
assert.equal(fixture.protocol, "http:");
const hosts = new Set(["vercel.com", "fixture.private.blob.vercel-storage.com", "scanner.example.invalid", "login.microsoftonline.com", "graph.microsoft.com"]);
const agent = new Agent();
setGlobalDispatcher({
  dispatch(options, handler) {
    const origin = new URL(options.origin);
    if (!hosts.has(origin.hostname)) throw new Error("Fixture blocked unexpected outbound provider");
    const headers = Array.isArray(options.headers)
      ? [...options.headers, "x-dgita-fixture-host", origin.hostname]
      : { ...options.headers, "x-dgita-fixture-host": origin.hostname };
    return agent.dispatch({ ...options, origin: fixture.origin, headers }, handler);
  },
  close: (...args) => agent.close(...args),
  destroy: (...args) => agent.destroy(...args),
});
