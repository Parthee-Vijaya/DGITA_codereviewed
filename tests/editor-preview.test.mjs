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

test("URI output encoding preserves existing escapes, Unicode, query boundaries and fragments", () => {
  for (const source of [
    "https://images.invalid/rød%20mappe/a%2Fb.png?name=smør%20og%252F&token=a%2Bb%3Dc#høj%20kant",
    "https://images.invalid/%2f/%20/%252F/%25/%3Cimage%3E.png?signature=a%2fb%3Dc%26d%23e&next=%2F#section%2Fone",
    "/billeder/rød%20mappe/a%2Fb.webp?signature=a%2Bb%3Dc&label=to%20ord#høj%20kant",
  ]) {
    const normalized = new URL(source, "https://image-preview.invalid");
    const expected = source.startsWith("/") ? normalized.pathname + normalized.search + normalized.hash : normalized.href;
    assert.equal(safeImagePreviewSource(source), expected);
    assert.equal(safeImagePreviewSource(expected), expected, "encoding is idempotent");
    const html = renderImageEditor(source);
    assert.match(html, /<img\b/u);
  }
});

test("URI output encoding escapes literal metacharacters without changing raster bytes", () => {
  assert.equal(
    safeImagePreviewSource("https://images.invalid/image[1].png?label=[a]&literal=%#[]"),
    "https://images.invalid/image%5B1%5D.png?label=%5Ba%5D&literal=%25#%5B%5D",
  );
  const malformedPercent = "/images/%zz/%2/%25/%2525.png?literal=%&escaped=%25#%";
  const encodedPercent = "/images/%25zz/%252/%25/%2525.png?literal=%25&escaped=%25#%25";
  assert.equal(safeImagePreviewSource(malformedPercent), encodedPercent);
  assert.equal(safeImagePreviewSource(encodedPercent), encodedPercent);
  for (const mime of ["avif", "gif", "jpeg", "png", "webp"]) {
    const data = `data:image/${mime};base64,AAECA/7/+/==`;
    assert.equal(safeImagePreviewSource(data), data);
  }
});

test("literal quotes remain URI-encoded or React-escaped inside the preview attribute", () => {
  const source = "https://images.invalid/a'\"b.png?next=one%26two%23three#'\"";
  const expected = "https://images.invalid/a'%22b.png?next=one%26two%23three#'%22";
  assert.equal(safeImagePreviewSource(source), expected);
  const html = renderImageEditor(source);
  assert.ok(html.includes(`src="${expected.replaceAll("'", "&#x27;")}"`));
  assert.doesNotMatch(html, /<img[^>]*\sonerror=/iu);
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
