import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { usePortalNotifications } from "../features/notifications/use-notifications.ts";

// Rendering obtains the hook's public command handlers without starting the
// browser polling effect. These tests cover the HTTP command contract only.
function notificationCommands() {
  let commands;
  function Harness() {
    commands = usePortalNotifications("synthetic-viewer");
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return commands;
}

test("individual notification reads send server-generated namespaced IDs to the API", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    return Response.json({ unreadCount: 0, notifications: [] });
  };
  try {
    const commands = notificationCommands();
    for (const id of [
      "approval-notification:d05c0b50-20d8-42af-a49b-58584b130814",
      "submission-notification:d05c0b50-20d8-42af-a49b-58584b130814:synthetic-user",
      "d05c0b50-20d8-42af-a49b-58584b130814:synthetic-user",
      "105c0b50-20d8-42af-a49b-58584b130814:synthetic-user",
    ]) {
      assert.equal(await commands.markRead(id), true, id);
      const request = requests.at(-1);
      assert.equal(request.input, "/api/notifications");
      assert.equal(request.init.method, "POST");
      assert.deepEqual(JSON.parse(request.init.body), { id });
    }
    assert.equal(requests.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unsafe notification IDs never initiate an HTTP mutation", async () => {
  const originalFetch = globalThis.fetch;
  let requested = false;
  globalThis.fetch = async () => { requested = true; throw new Error("No request expected"); };
  try {
    const commands = notificationCommands();
    for (const id of ["", "../../notification", "id\nheader", "x".repeat(201)]) {
      assert.equal(await commands.markRead(id), false);
    }
    assert.equal(requested, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
