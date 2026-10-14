# Code review corrections

Starting snapshot: ce96a41d1bc80e714bb9df6af0b2a0880e29e330. User requested a code review with corrections or improvement proposals. Review the complete snapshot against repository standards and documented behavior, then review all local changes.

## Scope and acceptance

1. Historical PDF system metadata comes exclusively from the selected immutable application snapshot. Existing stored PDF objects are preserved.
2. A final PDF requires a committed D-GITA decision belonging to the selected version, including when another version has closed the case. Reject before reading or writing receipt storage.
3. Individual notification reads accept the same UUID and namespaced identifiers as the server, while rejecting unsafe IDs.
4. Graph deadlines cover token and rejected-send response bodies. Bounded reads prevent excessive response allocation; a known HTTP rejection retains its existing status/retry classification. Accepted sends are never retried by the transport.
5. Update the local setup instructions to match the repository URL and locked Node 24 runtime.

## Verification interfaces

- PDF renderer: inspect PDF text for the locked system name with conflicting live metadata. Receipt repository: a real synthetic rejection/correction/closure flow, then request the historical final receipt through getOrCreateReceipt; no provider call should be required for rejection.
- Notification UI and shared isSafeNotificationId contract; existing server behavior already accepts namespaced identifiers.
- MicrosoftGraphMailTransport.send with simulated HTTP responses and stalled/oversized streams at the external fetch interface. Preserve acceptance, cache, rejection, retry and ambiguous-send behavior.
- Run lint, typecheck, code-health, both builds and full automated suite. Confirm localhost remains ready.

## Complete slices

- [x] Historical PDF metadata: failing regression, minimal fix, green.
- [x] Version-specific final receipt: failing integration regression, minimal fix, green.
- [x] Notification identifiers: shared validator including numeric UUID-recipient IDs, public handler and real team-comment regressions; local browser renders correctly.
- [x] Graph body deadline: failing transport regression, implementation, additional error/size checks.
- [x] Documentation, final checks and two-axis review of tracked/untracked changes.

## Final evidence

Initial review: 360/360 tests passed through npm test (including the Vinext build), together with Next build, lint, typecheck, code-health and local readiness. The subsequent authorized attachment-deletion fix expanded verification to 370 passing tests, both isolated runtime lifecycle suites and production configuration checks. See ../attachment-deletion/spec.md for deployment and follow-up evidence.

## Attachment-deletion follow-up

The review confirmed ready-attachment removal tombstoned SQL while suppressing object deletion failures. The user's follow-up authorized implementing a durable deleting state/queue, acknowledgement after physical deletion, scheduling on both Cloudflare and Vercel and concurrency/idempotence tests. That follow-up is implemented and reviewed; existing upload verification locks remain intact. Details and ten failure/recovery regressions are recorded in ../attachment-deletion/spec.md.
