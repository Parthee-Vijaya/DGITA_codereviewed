import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorDrawer, EditableText } from "../features/editor/EditorMode.tsx";
import { safeImagePreviewSource } from "../features/editor/image-preview.ts";
import { DEFAULT_IMAGES, DEFAULT_CONTENT } from "../features/workspace/model.ts";

const renderImageEditor = (src) => renderToStaticMarkup(createElement(EditorDrawer, {
  selection: { kind: "image", entry: { ...DEFAULT_IMAGES[0], src } },
  onClose() {}, onSaveContent: async () => true, onSaveImage: async () => true,
  onResetImages: async () => true, onOpenLibrary() {},
}));

test("unsaved unsafe image addresses never become preview resource URLs", () => {
  for (const src of [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>", "data:image/svg+xml,<svg onload=alert(1)>",
    "//attacker.invalid/image.png", "/\\attacker.invalid/image.png", "/foo/..//attacker.invalid/a.png",
    "https://", "https://user:password@images.invalid/a.png", '<img src=x onerror="alert(1)">', "",
  ]) {
    assert.equal(safeImagePreviewSource(src), null, src);
    const html = renderImageEditor(src);
    assert.doesNotMatch(html, /<img\b/u, src);
    assert.doesNotMatch(html, /<link[^>]+rel="preload"/u, src);
    assert.match(html, /Skriv en gyldig billedadresse, eller upload et billede\./u);
  }
});

test("valid HTTPS, local and uploaded raster images remain previewable", () => {
  for (const [src, normalized] of [
    ["https://images.invalid/a.png", "https://images.invalid/a.png"],
    [" /images/portal.webp ", "/images/portal.webp"],
    ["/images/a.png?width=300&height=200", "/images/a.png?width=300&height=200"],
    ["data:image/png;base64,aGVq", "data:image/png;base64,aGVq"],
    ["data:image/webp;base64,aGVq", "data:image/webp;base64,aGVq"],
  ]) {
    assert.equal(safeImagePreviewSource(src), normalized);
    const html = renderImageEditor(src);
    assert.match(html, /<img\b[^>]*alt="Forhåndsvisning af valgt portalbillede"/u);
    assert.match(html, /Billedadresse<input/u);
    assert.doesNotMatch(html, /Skriv en gyldig billedadresse/u);
  }
});

test("rejecting a preview preserves the editable value as escaped text", () => {
  const html = renderImageEditor('<img src=x onerror="alert(1)">');
  assert.match(html, /value="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;"/u);
  assert.match(html, /Upload fra computer/u);
  assert.match(html, /Gem ændring/u);
});

test("CMS text containing markup remains plain React text in editor and display modes", () => {
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const entry = { ...DEFAULT_CONTENT[0], body: payload, published: true };
  for (const editorMode of [true, false]) {
    const html = renderToStaticMarkup(createElement(EditableText, {
      content: [entry], contentId: entry.id, fallback: "Fallback", editorMode, onEdit() {},
    }));
    assert.doesNotMatch(html, /<(?:img|script)\b/u);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/u);
  }
});
