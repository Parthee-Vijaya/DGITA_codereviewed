import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareKleCatalogXml, KLE_XML_LIMITS } from "../scripts/kle-prepare.mts";

const fixturePath = fileURLToPath(new URL("./fixtures/kle-full-plan-synthetic.xml", import.meta.url));
const fixture = await readFile(fixturePath, "utf8");
const metadata = { version: "synthetic-format-test-2026-10-14", sourceUrl: "https://example.test/kle.xml", retrievedAt: "2026-10-14T10:00:00.000Z" };
const prepare = (xml = fixture, options = metadata) => prepareKleCatalogXml(Buffer.from(xml), options);
const cli = fileURLToPath(new URL("../scripts/kle-prepare.mts", import.meta.url));
const cliArgs = (input, output) => ["--import", "tsx", cli, "--input", input, "--output", output, "--version", metadata.version, "--source-url", metadata.sourceUrl, "--retrieved-at", metadata.retrievedAt];

test("full-plan XML becomes a prepared package, preserving exact codes and original byte hash", () => {
  const value = prepare();
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.catalog.source.acceptedForUse, false);
  assert.equal(value.catalog.source.kind, "licensed");
  assert.equal(value.catalog.source.version, metadata.version);
  assert.deepEqual(value.catalog.entries.map(({ code, level }) => [code, level]), [
    ["00", "main-group"], ["00.01", "group"], ["00.01.01", "topic"], ["00.01.02", "topic"], ["00.01.03", "topic"],
  ]);
  assert.equal(value.provenance.sha256, createHash("sha256").update(Buffer.from(fixture)).digest("hex"));
  assert.equal(value.provenance.format, "kle-rest-xml");
  assert.equal(value.provenance.retrievedAt, metadata.retrievedAt);
});

test("keywords and guidance preserve Danish text while returning plain text only", () => {
  const topic = prepare().catalog.entries[2];
  assert.deepEqual(topic.keywords, ["låneudstyr", "fælles grej"]);
  assert.equal(topic.title, "Opdigtet fællesudlån & udstyr");
  assert.equal(topic.description, "En opdigtet lokal opgave.\nOmfatter: lån aflevering");
  assert.equal(topic.description.includes("<"), false);
  assert.equal(topic.keywords.includes("afgrænset facetord"), false);
  const splitWord = prepare(fixture.replace("<b>vejledning</b>", "vej<b>led</b>ning"));
  assert.match(splitWord.catalog.entries[0].description, /Opdigtet vejledning med/u);
});

test("both documented historical variants prevent new selection without inferring absence as deletion", () => {
  assert.deepEqual(prepare().catalog.entries.map((entry) => entry.retired), [false, false, false, true, true]);
  assert.throws(() => prepare(fixture.replace("<UdgaaetDato>2025-01-01</UdgaaetDato>", "<UnknownHistory/>")), /historikformat/u);
});

test("duplicate UUIDs, duplicate codes, and missing or invalid identities stop the complete import", () => {
  assert.throws(() => prepare(fixture.replace("11000000-0000-4000-8000-000000000004", "11000000-0000-4000-8000-000000000003")));
  assert.throws(() => prepare(fixture.replace("<EmneNr>00.01.02</EmneNr>", "<EmneNr>00.01.01</EmneNr>")));
  assert.throws(() => prepare(fixture.replace("<UUID>11000000-0000-4000-8000-000000000004</UUID>", "<UUID/>")));
  assert.throws(() => prepare(fixture.replace("11000000-0000-4000-8000-000000000004", "not-a-uuid")));
});

test("malformed XML, duplicate fields, unknown structures and wrong hierarchy fail closed", () => {
  for (const xml of [
    fixture.replace("</KLE-Emneplan>", "</broken>"),
    fixture.replace("<EmneNr>00.01.01</EmneNr>", "<EmneNr>00.01.01</EmneNr><EmneNr>00.01.01</EmneNr>"),
    fixture.replace("<UdgivelsesDato>", "<unknown/><UdgivelsesDato>"),
    fixture.replaceAll("KLE-Emneplan", "Emner"),
    fixture.replace("<GruppeNr>00.01</GruppeNr>", "<GruppeNr>01.01</GruppeNr>"),
    fixture.replace("<EmneNr>00.01.01</EmneNr>", "<EmneNr>00.02.01</EmneNr>"),
    fixture.replace("<KLE-Emneplan>", '<KLE-Emneplan xmlns="https://example.test/unknown">'),
    fixture.replace("<KLE-Emneplan>", '<KLE-Emneplan acceptedForUse="true">'),
    fixture.replace("2025-01-01", "2025-02-30"),
  ]) assert.throws(() => prepare(xml));
});

test("DTDs, custom entities and processing instructions are rejected before any import", () => {
  for (const xml of [
    fixture.replace("<KLE-Emneplan>", '<!DOCTYPE KLE-Emneplan SYSTEM "https://example.test/external.dtd"><KLE-Emneplan>'),
    fixture.replace("<KLE-Emneplan>", '<!DOCTYPE KLE-Emneplan [<!ENTITY injected SYSTEM "file:///etc/passwd">]><KLE-Emneplan>'),
    fixture.replace("Opdigtet hovedgruppe", "&unknown;"),
    fixture.replace("<KLE-Emneplan>", '<?xml-stylesheet href="https://example.test/xsl"?><KLE-Emneplan>'),
  ]) assert.throws(() => prepare(xml));
});

test("guidance rejects active markup and invalid metadata; encoded markup stays literal text", () => {
  assert.throws(() => prepare(fixture.replace("<b>vejledning</b>", "<script>alert(1)</script>")));
  assert.throws(() => prepare(fixture.replace("<b>vejledning</b>", '<b onclick="x">vejledning</b>')));
  const escaped = prepare(fixture.replace("<b>vejledning</b>", "&lt;script&gt;test&lt;/script&gt;"));
  assert.match(escaped.catalog.entries[0].description, /<script>test<\/script>/u);
  for (const patch of [{ sourceUrl: "http://example.test/kle.xml" }, { sourceUrl: "https://user:secret@example.test/kle.xml" }, { retrievedAt: "yesterday" }, { version: "" }]) assert.throws(() => prepare(fixture, { ...metadata, ...patch }));
});

test("byte, encoding, depth, and text bounds reject oversized or ambiguous input", () => {
  assert.throws(() => prepareKleCatalogXml(new Uint8Array(KLE_XML_LIMITS.bytes + 1), metadata), /32 MiB/u);
  assert.throws(() => prepareKleCatalogXml(new Uint8Array([0xc3, 0x28]), metadata), /UTF-8/u);
  assert.throws(() => prepare(fixture.replace('encoding="UTF-8"', 'encoding="UTF-16"')), /UTF-8/u);
  assert.throws(() => prepare(fixture.replace("Opdigtet hovedgruppe", "x".repeat(501))), /lang/u);
  assert.throws(() => prepare(fixture.replace("<b>vejledning</b>", `${"<b>".repeat(40)}x${"</b>".repeat(40)}`)), /dyb/u);
});

test("CLI prepares an atomic new package and refuses overwrite, including symlink targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dgita-kle-import-"));
  try {
    const input = join(directory, "source.xml");
    const output = join(directory, "prepared.json");
    await writeFile(input, fixture);
    const before = await readFile(input);
    const stdout = execFileSync(process.execPath, cliArgs(input, output), { encoding: "utf8" });
    assert.match(stdout, /ikke godkendt eller aktiveret/u);
    const result = await readFile(output, "utf8");
    assert.equal(JSON.parse(result).catalog.source.acceptedForUse, false);
    assert.notEqual(spawnSync(process.execPath, cliArgs(input, output)).status, 0);
    assert.equal(await readFile(output, "utf8"), result);
    assert.deepEqual(await readFile(input), before);
    const alias = join(directory, "alias.json");
    await symlink(output, alias);
    assert.notEqual(spawnSync(process.execPath, cliArgs(input, alias)).status, 0);
    assert.equal(await readFile(output, "utf8"), result);
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI refuses activation flags and never produces output for invalid source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dgita-kle-import-"));
  try {
    const input = join(directory, "bad.xml");
    const output = join(directory, "prepared.json");
    await writeFile(input, "<not-kle/>");
    assert.notEqual(spawnSync(process.execPath, cliArgs(input, output)).status, 0);
    assert.deepEqual(await readdir(directory), ["bad.xml"]);
    assert.notEqual(spawnSync(process.execPath, [...cliArgs(fixturePath, output), "--accepted-for-use", "true"]).status, 0);
    assert.deepEqual(await readdir(directory), ["bad.xml"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
