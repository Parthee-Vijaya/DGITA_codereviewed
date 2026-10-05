import assert from "node:assert/strict";
import test from "node:test";

import { readGraphMailConfig } from "./config.ts";
import {
  GraphMailConfigurationError,
  GraphMailError,
  GraphMailValidationError,
} from "./errors.ts";
import { MicrosoftGraphMailTransport } from "./graph-transport.ts";

const environment = {
  DGITA_ENVIRONMENT: "pilot",
  DGITA_MAIL_ALLOWED_RECIPIENTS: "ansoeger@kalundborg.dk,leder@kalundborg.dk",
  DGITA_GRAPH_TENANT_ID: "11111111-2222-3333-4444-555555555555",
  DGITA_GRAPH_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  DGITA_GRAPH_CLIENT_SECRET: "server-secret-value",
  DGITA_GRAPH_SENDER: "dgita@kalundborg.dk",
};

const mail = {
  subject: "Kvittering ITA-001290",
  body: { contentType: "HTML", content: "<p>Tak for din ansøgning.</p>" },
  to: [{ address: "ansoeger@kalundborg.dk", name: "Ansøger" }],
  cc: [{ address: "leder@kalundborg.dk" }],
  attachments: [
    {
      name: "kvittering.pdf",
      contentType: "application/pdf",
      contentBytes: "aGVq",
    },
  ],
  saveToSentItems: false,
};

test("miljøkonfiguration kræver tenant, klient, hemmelighed og afsender", () => {
  assert.throws(
    () => readGraphMailConfig({}),
    (error) =>
      error instanceof GraphMailConfigurationError &&
      error.message.includes("DGITA_GRAPH_CLIENT_SECRET") &&
      !error.message.includes(environment.DGITA_GRAPH_CLIENT_SECRET),
  );

  const config = readGraphMailConfig(environment);
  assert.equal(config.graphScope, "https://graph.microsoft.com/.default");
  assert.equal(config.timeoutMs, 10_000);
});

test("client credentials-token bruges til POST /users/{sender}/sendMail", async () => {
  const calls = [];
  const fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) {
      return Response.json({
        token_type: "Bearer",
        expires_in: 3600,
        access_token: "graph-access-token",
      });
    }
    return new Response(null, {
      status: 202,
      headers: { "request-id": "graph-request-123" },
    });
  };

  const transport = new MicrosoftGraphMailTransport(
    readGraphMailConfig(environment),
    { fetch, now: () => Date.parse("2026-08-26T20:00:00.000Z") },
  );
  const accepted = await transport.send(mail);

  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].input,
    "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].init.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  const tokenBody = new URLSearchParams(calls[0].init.body);
  assert.equal(tokenBody.get("grant_type"), "client_credentials");
  assert.equal(tokenBody.get("scope"), "https://graph.microsoft.com/.default");
  assert.equal(tokenBody.get("client_id"), environment.DGITA_GRAPH_CLIENT_ID);
  assert.equal(
    tokenBody.get("client_secret"),
    environment.DGITA_GRAPH_CLIENT_SECRET,
  );

  assert.equal(
    calls[1].input,
    "https://graph.microsoft.com/v1.0/users/dgita%40kalundborg.dk/sendMail",
  );
  assert.equal(calls[1].init.headers.Authorization, "Bearer graph-access-token");
  assert.doesNotMatch(
    `${JSON.stringify(calls[1].init.headers)}${calls[1].init.body}`,
    /server-secret-value/,
  );
  const payload = JSON.parse(calls[1].init.body);
  assert.equal(payload.message.subject, mail.subject);
  assert.equal(
    payload.message.toRecipients[0].emailAddress.address,
    "ansoeger@kalundborg.dk",
  );
  assert.equal(payload.message.attachments[0]["@odata.type"], "#microsoft.graph.fileAttachment");
  assert.equal(payload.saveToSentItems, false);
  assert.deepEqual(accepted, {
    accepted: true,
    acceptedAt: "2026-08-26T20:00:00.000Z",
    requestId: "graph-request-123",
  });
});

test("adgangstoken caches, men selve mailsendingen gentages aldrig internt", async () => {
  let tokenCalls = 0;
  let sendCalls = 0;
  const fetch = async (input) => {
    if (String(input).includes("/oauth2/v2.0/token")) {
      tokenCalls += 1;
      return Response.json({
        token_type: "Bearer",
        expires_in: 3600,
        access_token: "cached-token",
      });
    }
    sendCalls += 1;
    return new Response(null, { status: 202 });
  };
  const transport = new MicrosoftGraphMailTransport(
    readGraphMailConfig(environment),
    { fetch, now: () => 1_000_000 },
  );

  await transport.send(mail);
  await transport.send({ ...mail, subject: "En anden mail" });
  assert.equal(tokenCalls, 1);
  assert.equal(sendCalls, 2);
});

test("Graph-fejl er klassificerede uden provider-body eller secrets", async () => {
  let call = 0;
  const fetch = async () => {
    call += 1;
    if (call === 1) {
      return Response.json({
        token_type: "Bearer",
        expires_in: 3600,
        access_token: "token-that-must-not-leak",
      });
    }
    return Response.json(
      {
        error: {
          code: "ErrorSendAsDenied",
          message: "private-provider-detail-that-must-not-leak",
        },
      },
      {
        status: 403,
        headers: { "request-id": "denied-request" },
      },
    );
  };
  const transport = new MicrosoftGraphMailTransport(
    readGraphMailConfig(environment),
    { fetch },
  );

  await assert.rejects(transport.send(mail), (error) => {
    assert.ok(error instanceof GraphMailError);
    assert.equal(error.code, "GRAPH_SEND_ERROR");
    assert.equal(error.status, 403);
    assert.equal(error.retryable, false);
    assert.equal(error.providerCode, "ErrorSendAsDenied");
    assert.equal(error.requestId, "denied-request");
    assert.doesNotMatch(error.message, /private-provider-detail|server-secret|token-that/);
    return true;
  });
  assert.equal(call, 2);
});

test("429 markeres som retryable uden at adapteren selv sender igen", async () => {
  let call = 0;
  const fetch = async () => {
    call += 1;
    return call === 1
      ? Response.json({
          token_type: "Bearer",
          expires_in: 3600,
          access_token: "token",
        })
      : Response.json(
          { error: { code: "TooManyRequests" } },
          { status: 429, headers: { "Retry-After": "17" } },
        );
  };
  const transport = new MicrosoftGraphMailTransport(
    readGraphMailConfig(environment),
    { fetch },
  );

  await assert.rejects(transport.send(mail), (error) => {
    assert.ok(error instanceof GraphMailError);
    assert.equal(error.code, "GRAPH_SEND_ERROR");
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 17_000);
    return true;
  });
  assert.equal(call, 2);
});

test("timeout afbryder kaldet og giver en retryable fejl", async () => {
  const config = { ...readGraphMailConfig(environment), timeoutMs: 5 };
  const fetch = () => new Promise(() => {});
  const transport = new MicrosoftGraphMailTransport(config, { fetch });

  await assert.rejects(transport.send(mail), (error) => {
    assert.ok(error instanceof GraphMailError);
    assert.equal(error.code, "GRAPH_TIMEOUT");
    assert.equal(error.stage, "token");
    assert.equal(error.retryable, true);
    return true;
  });
});

test("ugyldig mail afvises før token eller Graph kaldes", async () => {
  let called = false;
  const transport = new MicrosoftGraphMailTransport(
    readGraphMailConfig(environment),
    {
      fetch: async () => {
        called = true;
        throw new Error("må ikke kaldes");
      },
    },
  );

  await assert.rejects(
    transport.send({ ...mail, to: [], cc: [], subject: "" }),
    GraphMailValidationError,
  );
  assert.equal(called, false);
});
