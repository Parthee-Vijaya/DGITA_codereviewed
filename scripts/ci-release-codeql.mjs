import assert from "node:assert/strict";

const requiredCategories = ["/language:javascript-typescript", "/language:actions"];

function resultRule(run, result) {
  const reference = result.rule;
  const componentIndex = reference?.toolComponent?.index;
  if (componentIndex !== undefined) assert.ok(Number.isSafeInteger(componentIndex) && componentIndex >= 0, "Invalid SARIF component index.");
  const component = componentIndex === undefined ? run.tool.driver : run.tool.extensions?.[componentIndex];
  assert.ok(component && Array.isArray(component.rules), "Missing SARIF rule descriptors.");
  const ruleId = result.ruleId ?? reference?.id;
  assert.equal(typeof ruleId, "string", "Missing SARIF rule identity.");
  if (reference?.id !== undefined) assert.equal(reference.id, ruleId, "Conflicting SARIF rule identities.");
  const index = reference?.index ?? result.ruleIndex;
  if (index !== undefined) assert.ok(Number.isSafeInteger(index) && index >= 0, "Invalid SARIF rule index.");
  const matches = index === undefined ? component.rules.filter((rule) => rule.id === ruleId) : [component.rules[index]];
  assert.equal(matches.length, 1, "Ambiguous SARIF rule identity.");
  assert.equal(matches[0]?.id, ruleId, "SARIF result does not match its rule.");
  return matches[0];
}

export function verifyCodeqlSarif(sarif, analysis, { sourceSha, repository }) {
  assert.equal(sarif?.version, "2.1.0", "Expected SARIF 2.1.0.");
  assert.ok(Array.isArray(sarif.runs) && sarif.runs.length > 0, "Missing SARIF runs.");
  let count = 0;
  for (const run of sarif.runs) {
    assert.equal(run.tool?.driver?.name, "CodeQL", "Unexpected SARIF producer.");
    assert.equal(run.automationDetails?.id, `${analysis.category}/`, "Wrong SARIF analysis category.");
    assert.ok(Array.isArray(run.versionControlProvenance) && run.versionControlProvenance.length === 1, "Missing or ambiguous SARIF source provenance.");
    const provenance = run.versionControlProvenance[0];
    assert.equal(provenance.revisionId, sourceSha, "SARIF belongs to a different commit.");
    assert.equal(provenance.branch, "refs/heads/main", "SARIF must describe main.");
    assert.equal(provenance.repositoryUri, `https://github.com/${repository}`, "SARIF belongs to a different repository.");
    if (run.invocations !== undefined) {
      assert.ok(Array.isArray(run.invocations), "Invalid SARIF invocations.");
      assert.ok(run.invocations.every((invocation) => invocation.executionSuccessful === true), "CodeQL execution failed.");
    }
    assert.ok(Array.isArray(run.results), "Missing SARIF results.");
    for (const result of run.results) {
      const rule = resultRule(run, result);
      const level = result.level ?? rule.defaultConfiguration?.level ?? "warning";
      assert.ok(["none", "note", "warning", "error"].includes(level), "Invalid SARIF result level.");
      assert.notEqual(level, "error", `CodeQL error blocks release: ${rule.id}`);
      const severity = rule.properties?.["security-severity"];
      if (severity !== undefined) {
        assert.ok(typeof severity === "string" && /^(?:[0-9](?:\.[0-9]+)?|10(?:\.0+)?)$/u.test(severity), "Invalid CodeQL security severity.");
        assert.ok(Number(severity) < 7, `High or critical CodeQL finding blocks release: ${rule.id}`);
      } else {
        assert.ok(!rule.properties?.tags?.includes("security"), "Security rule is missing its severity.");
      }
      // Historical results remain blocking even if an alert is now fixed or dismissed.
      count += 1;
    }
  }
  assert.equal(count, analysis.results_count, "Incomplete CodeQL result evidence.");
}

export async function requireCodeqlEvidence(github, { sourceSha, repository }) {
  const selected = new Map();
  // Bound API work and fail closed when an older commit's evidence cannot be found.
  for (let page = 1; page <= 10 && selected.size < requiredCategories.length; page += 1) {
    const analyses = await github(`code-scanning/analyses?ref=refs%2Fheads%2Fmain&tool_name=CodeQL&sort=created&direction=desc&per_page=100&page=${page}`);
    assert.ok(Array.isArray(analyses), "Invalid CodeQL analysis listing.");
    for (const analysis of analyses) {
      if (analysis?.commit_sha !== sourceSha || analysis.ref !== "refs/heads/main" || analysis.tool?.name !== "CodeQL" || analysis.analysis_key !== ".github/workflows/ci.yml:codeql" || !requiredCategories.includes(analysis.category)) continue;
      if (!selected.has(analysis.category)) selected.set(analysis.category, analysis);
    }
    if (analyses.length < 100) break;
  }
  for (const category of requiredCategories) {
    const analysis = selected.get(category);
    assert.ok(analysis, `Missing exact-commit main CodeQL analysis: ${category}`);
    assert.ok(Number.isSafeInteger(analysis.id) && analysis.id > 0, "Invalid CodeQL analysis identity.");
    assert.equal(analysis.error, "", "CodeQL analysis reported an execution error.");
    assert.ok(Number.isSafeInteger(analysis.rules_count) && analysis.rules_count > 0, "CodeQL ran no rules.");
    assert.ok(Number.isSafeInteger(analysis.results_count) && analysis.results_count >= 0, "Invalid CodeQL result count.");
    const sarif = await github(`code-scanning/analyses/${analysis.id}`, "application/sarif+json");
    verifyCodeqlSarif(sarif, analysis, { sourceSha, repository });
  }
}
