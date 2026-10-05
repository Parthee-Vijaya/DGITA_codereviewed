import { redactTestSummary } from "./evidence-contract.mjs";

/** Consume real Node test events; discard stdout, stderr, names and assertion payloads. */
export default async function* redactedReporter(events) {
  for await (const event of events) {
    if (event.type === "test:summary" && event.data.file === undefined) {
      yield JSON.stringify(redactTestSummary(event.data)) + "\n";
    }
  }
}
