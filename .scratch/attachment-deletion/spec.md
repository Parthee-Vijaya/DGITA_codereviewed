# Durable attachment deletion

User requests the remaining attachment-deletion defect fixed, automatic retries tested, then deployment of the latest source to Vercel followed by commit and push. Include the earlier uncommitted review corrections in that delivery. Starting Git HEAD ce96a41d1bc80e714bb9df6af0b2a0880e29e330 on codex/code-review-fixes.

## Behavior and decisions

- An owner removes an editable, unversioned attachment: atomically record its audit event and transition ready → deleting. The attachment immediately disappears from draft/download/submission projections.
- Attempt physical deletion promptly. A storage failure or acknowledgement failure leaves a durable SQL retry target; later scheduled maintenance retries without browser involvement.
- Successful physical deletion is acknowledged deleting → deleted with exact tenant/id/storage locator and unversioned guards. Repeated/concurrent maintenance is safe and eventually drains the queue.
- Submission queues unused/hidden attachments in its existing transaction, including uploads that became ready during submission. Versioned files and original correction source files remain preserved.
- Ordinary deletion cleanup runs on Cloudflare and Vercel even when direct Blob upload is disabled. Pending retries produce a failed maintenance heartbeat/alarm using the existing observability contract.
- Existing verification-lock guards, ownership/tenant boundaries, migration checksums and immutable versions remain enforced. Add deleting to the Drizzle domain enum; unconstrained SQLite TEXT needs no SQL migration.
- Keep correction object locators unique per physical copy attempt to prevent a slow concurrent initializer recreating an acknowledged deleted object. Durably queue unsuccessful copies with authoritative DB reconciliation; ambiguous DB failure must retain potentially referenced objects.

## Public verification interfaces

Real isolated libSQL database with synthetic users; external FILES adapter simulates transient delete failure, missing acknowledgement, concurrent passes and delayed copy. Exercise store/delete/getLatestApplicationDraft/authorizeAttachmentDownload, submitApplication, beginApplicationCorrection and scheduled maintenance. Verify rollback on audit failure, inaccessible queued files, recovery on retry, bounded processing, no repeat work after acknowledgement, and preserved previous versions. Do not use live cloud credentials or the developer's database for these tests.

## Delivery order

1. Implement and verify complete removal → queue → storage → acknowledgement → scheduler slice.
2. Review all tracked/untracked task changes and run relevant quality gates, both builds and isolated runtime checks when feasible.
3. Deploy the exact verified local source to existing Vercel project dgita (prj_Eo1WERkeiKbA3oqTVADT4Z7vQWOq), team parthee-vijayas-projects (team_zKYZvu4DHItNqHHAR2dxKcpk). Inspect existing pilot configuration and validate the result.
4. Commit all authorized code/test/docs changes and push codex/code-review-fixes to origin, preserving protected main and unrelated files. No main merge was requested.

## Progress

- [x] Deletion regression red/green and durable state.
- [x] Hidden attachments, immutable sources and concurrent correction copies.
- [x] Host-independent scheduler and failure visibility.
- [x] Full verification and two-axis review.
- [x] Vercel deployment verified.
- [x] Initial commit and push verified (d8e7ca9023d0ef85fa3143348fffd8278923823b).

## Initial delivery verification record

After the first push, GitHub reported two new dependency advisories, confirmed by npm audit and the repository's existing audit policy. Update source-map-js 1.2.1 → 1.2.2 within its existing ranges; force sharp 0.35.5 because Miniflare pins vulnerable 0.35.4 while Next permits the patched release. These address https://github.com/advisories/GHSA-68fv-2mgg-jv7q and https://github.com/advisories/GHSA-wq5f-xc86-pv6w. Do not expand audit exceptions. Verify native PNG/SVG decoding and resizing, audit policy, both builds and runtime flows; redeploy the final source before committing/pushing this follow-up.

370/370 tests, lint, typecheck, code-health, whitespace checks, Vinext build and Next build passed. Ten deletion regressions include storage outages, acknowledgement loss, audit rollback, concurrent removal/copying, correction registration rollback and committed-batch lost reply. Both isolated full lifecycle HTTP suites and the production configuration suite passed on Node 24.19.0 from a private clean verification snapshot of this source. External provider contracts used synthetic HTTP fixtures, not live services.

Vercel production deployment dpl_GdQ2Pi5Pd466NU65iH9eRZo3hJAK is READY. Both dgita-nine.vercel.app and dgita-parthee-vijayas-projects.vercel.app reference it; authenticated checks returned 200 for health, readiness and login. Every uploaded source file is SHA-addressed; all changed implementation files match the deployment's readable source hashes. Only planning progress documentation changes after this deployment. No live destructive storage outage was simulated. The optional accessibility suite required a local Playwright browser installation; its final result and commit/push confirmation are recorded in the chat delivery outputs.
