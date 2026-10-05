import assert from "node:assert/strict";
import test from "node:test";
import { readGraphMailConfig } from "./config.ts";
import { MicrosoftGraphMailTransport } from "./graph-transport.ts";
import { assertMailDeliveryAllowed, readMailDeliveryPolicy } from "./delivery-policy.ts";

const environment = {
  DGITA_GRAPH_TENANT_ID: "11111111-2222-3333-4444-555555555555",
  DGITA_GRAPH_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  DGITA_GRAPH_CLIENT_SECRET: "isolated-mail-test-secret",
  DGITA_GRAPH_SENDER: "sender@example.invalid",
};
const mail = { subject: "Isoleret test", body: { contentType: "Text",content: "Kun test" }, to: [{address:"approved@example.invalid"}] };

function transport(overrides) {
  let calls = 0;
  const instance = new MicrosoftGraphMailTransport(readGraphMailConfig({...environment,...overrides}), {
    fetch: async (url) => {
      calls++;
      return String(url).includes("/token")
        ? Response.json({ token_type:"Bearer",expires_in:3600,access_token:"isolated-token" })
        : new Response(null,{status:202});
    },
  });
  return { instance, calls:() => calls };
}

test("local, pilot and unset environment block real delivery before token acquisition", async () => {
  for (const mode of [undefined,"local","pilot"]) {
    const configured = transport({DGITA_ENVIRONMENT:mode});
    await assert.rejects(configured.instance.send(mail), {code:"MAIL_RECIPIENT_NOT_ALLOWED",retryable:false});
    assert.equal(configured.calls(),0);
  }
});

test("an exact pilot recipient allowlist permits the mocked transport", async () => {
  const configured = transport({DGITA_ENVIRONMENT:"pilot",DGITA_MAIL_ALLOWED_RECIPIENTS:" APPROVED@example.invalid, leader@example.invalid\ncopy@example.invalid "});
  const accepted = await configured.instance.send({...mail,cc:[{address:"leader@example.invalid"}],bcc:[{address:"copy@example.invalid"}]});
  assert.equal(accepted.accepted,true);
  assert.equal(configured.calls(),2);
});

test("unlisted to, cc, bcc and reply-to recipients block the entire mail", async () => {
  for (const field of ["to","cc","bcc","replyTo"]) {
    const configured = transport({DGITA_ENVIRONMENT:"pilot",DGITA_MAIL_ALLOWED_RECIPIENTS:"approved@example.invalid"});
    await assert.rejects(configured.instance.send({...mail,[field]:[{address:"blocked@example.invalid"}]}),{code:"MAIL_RECIPIENT_NOT_ALLOWED"});
    assert.equal(configured.calls(),0);
  }
});

test("wildcards, invalid modes and malformed allowlists fail closed", () => {
  for (const value of ["*@example.invalid","approved@example.invalid,*", "invalid", "<approved@example.invalid>", ",;\n"]) {
    assert.throws(() => readMailDeliveryPolicy({DGITA_ENVIRONMENT:"pilot",DGITA_MAIL_ALLOWED_RECIPIENTS:value}),{code:"MAIL_CONFIGURATION_ERROR"});
  }
  assert.throws(() => readMailDeliveryPolicy({DGITA_ENVIRONMENT:"prodution"}),{code:"MAIL_CONFIGURATION_ERROR"});
  for (const malformed of [undefined,{}, {allowedRecipients:"approved@example.invalid"}]) {
    assert.throws(() => assertMailDeliveryAllowed(mail,malformed),{code:"MAIL_RECIPIENT_NOT_ALLOWED"});
  }
});

test("production permits normal delivery, and an explicit production allowlist still restricts it", async () => {
  const configured = transport({DGITA_ENVIRONMENT:"production"});
  assert.equal((await configured.instance.send(mail)).accepted,true);
  const restricted = transport({DGITA_ENVIRONMENT:"production",DGITA_MAIL_ALLOWED_RECIPIENTS:"other@example.invalid"});
  await assert.rejects(restricted.instance.send(mail),{code:"MAIL_RECIPIENT_NOT_ALLOWED"});
  assert.equal(restricted.calls(),0);
});
