import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { portalSchemaStatements } from "../db/persistence.ts";
import { EditableText } from "../features/editor/EditorMode.tsx";
import { contentBody, isContentVisible } from "../features/workspace/model.ts";
import { listWorkspaceContentForActor } from "../features/workspace/server-repository.ts";

const contentId = "home.hero.title";
const privateEntry = {
  id: contentId, category: "portal_text", title: "Private editorial title",
  body: "Unpublished draft text", url: "https://private.example.invalid/draft",
  location: "Private placement", updatedBy: "Private editor", published: false,
};

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const statement of portalSchemaStatements) database.exec(statement);
  for (const tenant of ["test-a", "test-b"]) {
    database.prepare("INSERT INTO portal_tenants (id, slug, name) VALUES (?, ?, ?)").run(tenant, tenant, tenant);
  }
  const queryResults = [];
  const D1 = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async all() {
              const results = database.prepare(sql).all(...bindings);
              queryResults.push(...results);
              return { results };
            },
          };
        },
      };
    },
  };
  function insert(tenant, key, value, status = "published", type = "content") {
    database.prepare(`INSERT INTO portal_content_entries
      (id, tenant_id, key, page_path, content_type, value_json, status)
      VALUES (?, ?, ?, '/', ?, ?, ?)`)
      .run(`${tenant}:${key}`, tenant, key, type, typeof value === "string" ? value : JSON.stringify(value), status);
  }
  return { database, D1, insert, queryResults };
}

function render(content, editorMode = false) {
  return renderToStaticMarkup(createElement(EditableText, {
    as: "h1", content, contentId, fallback: "Built-in title", editorMode, onEdit() {},
  }));
}

test("missing CMS records keep defaults while deliberate unpublishing suppresses text and metadata", () => {
  assert.match(render([]), /Built-in title/u);
  assert.equal(contentBody([], contentId, "Default"), "Default");
  assert.equal(isContentVisible([], contentId), true);
  assert.equal(render([privateEntry]), "");
  assert.equal(contentBody([privateEntry], contentId, "Default"), "");
  assert.equal(isContentVisible([privateEntry], contentId), false);
  const editorHtml = render([privateEntry], true);
  assert.match(editorHtml, /Ikke publiceret/u);
  assert.match(editorHtml, /Redigér: Private editorial title/u);
  assert.doesNotMatch(editorHtml, /Unpublished draft text/u);
});

test("user and consultant receive only empty markers for unpublished and archived entries in their tenant", async () => {
  const { database, D1, insert, queryResults } = createDatabase();
  try {
    insert("test-a", contentId, privateEntry, "draft");
    insert("test-a", "home.resources.about.title", { ...privateEntry, id: "home.resources.about.title" }, "archived");
    insert("test-a", "draft.corrupt", "this is not JSON", "draft");
    insert("test-b", "other.tenant.content", { ...privateEntry, published: true });
    insert("test-a", "draft.image", { id: "draft.image", src: "https://private.example.invalid/image.png" }, "draft", "image");
    insert("test-a", "public.image", { id: "public.image", src: "/dgita-hero.png" }, "published", "image");
    for (const role of ["user", "consultant"]) {
      queryResults.length = 0;
      const workspace = await listWorkspaceContentForActor(D1, { tenantId: "test-a", role });
      assert.equal(workspace.content.length, 3);
      assert.equal(workspace.images.length, 1);
      assert.equal(workspace.images[0].id, "public.image");
      for (const entry of workspace.content) {
        assert.deepEqual(entry, { id: entry.id, category: "portal_text", title: "", body: "", location: "", published: false });
      }
      assert.doesNotMatch(JSON.stringify(workspace), /Private|Unpublished|private\.example|other\.tenant|not JSON/u);
      assert.ok(queryResults.filter((row) => row.status !== "published").every((row) => row.value_json === null));
      assert.equal(render(workspace.content), "");
    }
  } finally { database.close(); }
});

test("publication, unpublication, re-read and republication consistently control the same saved text", async () => {
  const { database, D1, insert } = createDatabase();
  try {
    const published = { ...privateEntry, published: true, body: "Approved text" };
    insert("test-a", contentId, published);
    const viewer = { tenantId: "test-a", role: "user" };
    assert.match(render((await listWorkspaceContentForActor(D1, viewer)).content), /Approved text/u);

    database.prepare("UPDATE portal_content_entries SET status = 'draft', value_json = ? WHERE tenant_id = ? AND key = ?")
      .run(JSON.stringify(privateEntry), viewer.tenantId, contentId);
    for (let reload = 0; reload < 2; reload++) {
      assert.equal(render((await listWorkspaceContentForActor(D1, viewer)).content), "");
    }
    const admin = await listWorkspaceContentForActor(D1, { ...viewer, role: "admin" });
    assert.deepEqual(admin.content, [privateEntry]);
    assert.match(render(admin.content, true), /Ikke publiceret/u);

    database.prepare("UPDATE portal_content_entries SET status = 'published', value_json = ? WHERE tenant_id = ? AND key = ?")
      .run(JSON.stringify(published), viewer.tenantId, contentId);
    assert.match(render((await listWorkspaceContentForActor(D1, viewer)).content), /Approved text/u);
  } finally { database.close(); }
});

test("an inconsistent publication flag never exposes the draft body to non-admins", async () => {
  const { database, D1, insert } = createDatabase();
  try {
    insert("test-a", contentId, privateEntry, "published");
    const workspace = await listWorkspaceContentForActor(D1, { tenantId: "test-a", role: "consultant" });
    assert.equal(render(workspace.content), "");
    assert.doesNotMatch(JSON.stringify(workspace), /Unpublished draft text|Private editor|private\.example/u);
  } finally { database.close(); }
});
