/** Optional React debug tracing must not crash the Worker development runtime.
 * Remove only an unsupported console task API; ordinary console methods stay intact.
 * Temporary until vinext ships https://github.com/cloudflare/vinext/pull/3233. */
export function disableUnsupportedConsoleTask(runtimeConsole) {
  try {
    const task = runtimeConsole.createTask;
    if (!task) return;
    if (typeof task === "function") {
      const marker = Symbol("console-task-probe");
      if (task.call(runtimeConsole, "dgita-runtime-probe").run(() => marker) === marker) return;
    }
  } catch { /* An exposed but unsupported debug API must be treated as absent. */ }
  if (!Reflect.defineProperty(runtimeConsole, "createTask", { value: undefined })) {
    throw new Error("WORKER_DEBUG_CONSOLE_INCOMPATIBLE");
  }
}

export function workerdDevConsole() {
  return {
    name: "dgita-workerd-dev-console",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (!["rsc", "ssr"].includes(this.environment?.name) ||
          !id.split("?")[0].replaceAll("\\", "/").endsWith("/vinext/dist/server/server-globals.js")) return null;
      return { code: `import "node:console";\n(${disableUnsupportedConsoleTask.toString()})(console);\n${code}`, map: null };
    },
  };
}
