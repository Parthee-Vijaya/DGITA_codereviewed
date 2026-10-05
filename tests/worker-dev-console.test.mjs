import assert from "node:assert/strict";
import test from "node:test";
import { disableUnsupportedConsoleTask, workerdDevConsole } from "../build/workerd-dev-console.mjs";

test("Worker debug compatibility preserves working tracing and normal console methods", () => {
  const log = () => undefined;
  const createTask = () => ({ run: (callback) => callback() });
  const runtimeConsole = { log, createTask };
  disableUnsupportedConsoleTask(runtimeConsole);
  assert.equal(runtimeConsole.createTask, createTask);
  assert.equal(runtimeConsole.log, log);
});

test("unsupported, inert and throwing debug methods become absent without masking errors", () => {
  for (const createTask of [() => { throw new Error("not implemented"); }, () => ({ run: () => null }), {}]) {
    const runtimeConsole = { createTask };
    disableUnsupportedConsoleTask(runtimeConsole);
    assert.equal(runtimeConsole.createTask, undefined);
  }
  const accessor = Object.defineProperty({}, "createTask", { configurable: true, get() { throw new Error("unsupported"); } });
  disableUnsupportedConsoleTask(accessor);
  assert.equal(accessor.createTask, undefined);
  const locked = Object.defineProperty({}, "createTask", { value: () => { throw new Error("unsupported"); }, writable: false, configurable: false });
  assert.throws(() => disableUnsupportedConsoleTask(locked), /WORKER_DEBUG_CONSOLE_INCOMPATIBLE/u);
});

test("shim is scoped to vinext server globals in both dev server environments", () => {
  const plugin = workerdDevConsole();
  assert.equal(plugin.apply, "serve");
  const id = "/app/node_modules/vinext/dist/server/server-globals.js?v=test";
  for (const name of ["rsc", "ssr"]) assert.match(plugin.transform.call({ environment: { name } }, "original", id).code, /disableUnsupportedConsoleTask/u);
  assert.equal(plugin.transform.call({ environment: { name: "client" } }, "original", id), null);
  assert.equal(plugin.transform.call({ environment: { name: "rsc" } }, "original", "/app/app/page.tsx"), null);
});
