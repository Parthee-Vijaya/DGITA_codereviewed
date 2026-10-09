import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";

test("patched image decoder preserves normal SVG and PNG processing", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ff0000"/></svg>');
  const png = await sharp(svg).resize(8, 8).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 8);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.deepEqual([...data.subarray(0, 4)], [255, 0, 0, 255]);
});

test("patched source maps preserve normal mappings and reject oversized indexed offsets", () => {
  const generator = new SourceMapGenerator({ file: "output.js" });
  generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 3, column: 2 }, source: "source.ts" });
  const map = generator.toJSON();
  assert.deepEqual(new SourceMapConsumer(map).originalPositionFor({ line: 1, column: 0 }), {
    source: "source.ts", line: 3, column: 2, name: null,
  });
  const indexed = (line) => ({ version: 3, sections: [{ offset: { line, column: 0 }, map }] });
  assert.equal(new SourceMapConsumer(indexed(2)).originalPositionFor({ line: 3, column: 1 }).line, 3);
  for (const line of [1e12, -1, 1.5]) {
    assert.throws(() => new SourceMapConsumer(indexed(line)), /Section offset line/);
  }
});
