import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentedChoice } from "../features/ui/SegmentedChoice.tsx";
import { QuestionLabelContext } from "../features/application/QuestionContent.tsx";

const options = [{ value: "ja", label: "Ja" }, { value: "nej", label: "Nej" }];
const render = (value, label) => renderToStaticMarkup(createElement(
  QuestionLabelContext.Provider, { value: "Er systemet kendt?" },
  createElement(SegmentedChoice, { value, label, options, onChange() {} }),
));

test("segmented answers inherit the actual question, with an explicit label override", () => {
  assert.match(render("ja"), /role="radiogroup" aria-label="Er systemet kendt\?"/);
  assert.match(render("ja", "Vælg systemtype"), /aria-label="Vælg systemtype"/);
});

test("segmented answers expose one selected radio and one tab stop", () => {
  const html = render("nej");
  assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /aria-checked="true" tabindex="0"/);
});

test("an unanswered choice stays unanswered with the first option keyboard-reachable", () => {
  const html = render("");
  assert.doesNotMatch(html, /aria-checked="true"/);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /type="button" role="radio" aria-checked="false" tabindex="0"/);
});
