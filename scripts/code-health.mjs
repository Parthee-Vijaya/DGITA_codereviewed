import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = new URL("../", import.meta.url).pathname;
async function sourceFiles(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const results = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? sourceFiles(path.join(directory, entry.name))
    : /\.(ts|tsx|mjs)$/u.test(entry.name) && !/\.(test|d)\.(ts|tsx|mjs)$/u.test(entry.name) ? [path.join(directory, entry.name)] : []));
  return results.flat().sort();
}

const files = (await Promise.all(["app", "features", "db", "worker"].map(sourceFiles))).flat();
const graph = new Map(files.map((file) => [file, new Set()]));
const functions = [];
const modules = [];
const providers = [];
const decisions = new Set([ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause, ts.SyntaxKind.CatchClause, ts.SyntaxKind.ConditionalExpression]);
const shortCircuits = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
function complexity(body) {
  let score = 1;
  function visit(node) {
    if (ts.isFunctionLike(node)) return; // Each nested function has its own entry.
    if (decisions.has(node.kind) || ts.isBinaryExpression(node) && shortCircuits.has(node.operatorToken.kind)) score++;
    ts.forEachChild(node, visit);
  }
  if (body) visit(body);
  return score;
}
function functionName(node, source) {
  if (node.name) return node.name.getText(source);
  if (node.parent && ts.isVariableDeclaration(node.parent)) return node.parent.name.getText(source);
  return `<anonymous:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}>`;
}
function resolveLocal(file, specifier) {
  const base = specifier.startsWith("@/") ? specifier.slice(2)
    : specifier.startsWith(".") ? path.normalize(path.join(path.dirname(file), specifier)) : null;
  return base && [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => graph.has(candidate));
}
for (const file of files) {
  const content = await readFile(path.join(root, file), "utf8");
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const ownFunctions = [];
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body) {
      const entry = { file, name: functionName(node, source), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        complexity: complexity(node.body) };
      ownFunctions.push(entry); functions.push(entry);
    }
    let specifier;
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly || ts.isExportDeclaration(node) && !node.isTypeOnly)
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
    if (specifier) {
      const target = resolveLocal(file, specifier);
      if (target) graph.get(file).add(target);
      if (/^(?:@libsql\/|@vercel\/blob|cloudflare:workers)/u.test(specifier)) providers.push({ file, provider: specifier });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  modules.push({ file, lines: content.split("\n").length - 1, functions: ownFunctions.length,
    maximumComplexity: Math.max(0, ...ownFunctions.map((entry) => entry.complexity)), imports: graph.get(file).size });
}

// Tarjan's strongly connected components: runtime imports, including literal
// dynamic imports. Type-only edges are intentionally excluded.
let next = 0;
const indexes = new Map(); const low = new Map(); const stack = []; const active = new Set(); const cycles = [];
function connect(file) {
  indexes.set(file, next); low.set(file, next++); stack.push(file); active.add(file);
  for (const target of graph.get(file)) {
    if (!indexes.has(target)) { connect(target); low.set(file, Math.min(low.get(file), low.get(target))); }
    else if (active.has(target)) low.set(file, Math.min(low.get(file), indexes.get(target)));
  }
  if (low.get(file) === indexes.get(file)) {
    const component = []; let member;
    do { member = stack.pop(); active.delete(member); component.push(member); } while (member !== file);
    if (component.length > 1 || graph.get(file).has(file)) cycles.push(component.sort());
  }
}
for (const file of files) if (!indexes.has(file)) connect(file);
const report = { version: 1, method: "TypeScript AST; decisions + short-circuits; nested functions counted separately",
  sourceFiles: files.length, cycles: cycles.sort(), providerImports: providers,
  modules: modules.sort((a, b) => b.maximumComplexity - a.maximumComplexity || a.file.localeCompare(b.file)),
  functions: functions.sort((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file) || a.line - b.line) };
if (process.argv.includes("--check")) {
  const policy = JSON.parse(await readFile(path.join(root, ".github/code-health-policy.json"), "utf8"));
  const violations = [];
  for (const cycle of cycles) if (!policy.allowedCycles.some((allowed) => JSON.stringify(allowed) === JSON.stringify(cycle))) {
    violations.push({ kind: "import-cycle", files: cycle });
  }
  for (const entry of providers) if (!policy.allowedProviderImports.some((allowed) => allowed.file === entry.file && allowed.provider === entry.provider)) {
    violations.push({ kind: "provider-boundary", ...entry });
  }
  for (const [name, maximum] of Object.entries(policy.criticalFunctionCeilings)) {
    const entries = functions.filter((entry) => entry.name === name);
    if (entries.length !== 1) violations.push({ kind: "critical-function-identity", name });
    else if (entries[0].complexity > maximum) violations.push({ kind: "complexity-increased", ...entries[0], maximum });
  }
  report.policy = { baseline: policy.baseline, violations };
  if (violations.length) process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));
