import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { Question, Money, FieldErrorText, UploadField } from "../features/application/ApplicationFields.tsx";

const props = { value: "", onChange() {} };
test("all three cost fields inherit their specific question and error relationship", () => {
  for (const title of ["34. Engangsomkostninger", "35. Årlige driftsudgifter", "36. Andre omkostninger"]) {
    const html = render(h(Question, { title, hint: "Beløb i danske kroner" }, h(Money, { ...props, error: "Angiv et gyldigt beløb" })));
    assert.ok(html.includes(`aria-label="${title}"`));
    assert.match(html, /aria-invalid="true"/);
    const ids = html.match(/aria-describedby="([^"]+)"/)[1].split(" ");
    assert.equal(ids.length, 2);
    for (const id of ids) assert.ok(html.includes(`id="${id}"`));
  }
});
test("native explicit and implicit labels are preserved, empty label wrappers inherit question", () => {
  const html = render(h(Question, { title: "Overordnet spørgsmål" },
    h("label", { htmlFor: "sub" }, "Det præcise felt"), h("input", { id: "sub" }),
    h("label", null, "Valg med egen tekst", h("input", { type: "checkbox" })),
    h("label", null, h("select", null, h("option", null, "Vælg"))),
  ));
  assert.match(html, /<input id="sub"\/>/);
  assert.match(html, /<input type="checkbox"\/>/);
  assert.match(html, /<select aria-label="Overordnet spørgsmål">/);
});
test("native invalid fields combine existing descriptions, question hint and error exactly once", () => {
  const html = render(h(Question, { title: "Formål", hint: "Beskriv behovet" }, h("textarea", { className: "clean-input invalid", "aria-describedby": "existing existing" }), h(FieldErrorText, { message: "Udfyld formål" })));
  const ids = html.match(/aria-describedby="([^"]+)"/)[1].split(" ");
  assert.equal(ids.length, 3);
  assert.equal(ids[0], "existing");
  assert.match(html, /aria-invalid="true"/);
});
test("uploads expose document kind, requirements, errors and a persistent live region", () => {
  const args = { kind: "contract", title: "Upload kontrakt", detail: "Bilaget knyttes til sagen", files: [], onAdd() {}, onRemove() {} };
  const clean = render(h(UploadField, args));
  assert.match(clean, /aria-label="Vælg fil til Upload kontrakt"/);
  assert.match(clean, /aria-live="polite"/);
  assert.doesNotMatch(clean, /aria-invalid/);
  const invalid = render(h(UploadField, { ...args, error: "Vedhæft kontrakten" }));
  assert.match(invalid, /aria-invalid="true"/);
  for (const id of invalid.match(/aria-describedby="([^"]+)"/)[1].split(" ")) assert.ok(invalid.includes(`id="${id}"`));
});


test("risikovurderingens filvælger og hjælp viser kun de dokumenttyper serveren accepterer", () => {
  const args = { title: "Upload risikovurdering", files: [], onAdd() {}, onRemove() {} };
  const risk = render(h(UploadField, { ...args, kind: "risk-assessment" }));
  assert.match(risk, /accept=".pdf,.doc,.docx,.xls,.xlsx"/);
  assert.match(risk, /PDF, DOC, DOCX, XLS, XLSX · maks. 25 MB/);
  assert.doesNotMatch(risk, /PNG|.png/);
  const contract = render(h(UploadField, { ...args, kind: "contract" }));
  assert.match(contract, /accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"/);
  assert.match(contract, /PNG, JPG, JPEG · maks. 25 MB/);
});
