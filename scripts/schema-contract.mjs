import { createHash } from "node:crypto";

const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const ordered = (items) => items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

// SQL formatting and identifier quoting differ between Drizzle and bootstrap.
// Keep string literals intact: trigger messages/defaults are part of the contract.
function tokens(sql = "") {
  return (sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|[\w]+|[^\s]/gu) ?? [])
    .map((token) => token.startsWith("'") ? token : token.replace(/^["`[]|["`\]]$/gu, "").toLowerCase());
}

function checks(sql) {
  const parts = tokens(sql);
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== "check" || parts[i + 1] !== "(") continue;
    let depth = 1;
    const expression = [];
    for (i += 2; i < parts.length && depth; i++) {
      if (parts[i] === "(") depth++;
      if (parts[i] === ")") depth--;
      if (depth) {
        // Qualified and unqualified references to this table are equivalent.
        if (parts[i + 1] === ".") { i++; continue; }
        expression.push(parts[i]);
      }
    }
    result.push(expression.join(" "));
  }
  return result.sort();
}

function normalizedDefault(value) {
  if (value === null) return null;
  const parts = tokens(value);
  while (parts[0] === "(" && parts.at(-1) === ")") { parts.shift(); parts.pop(); }
  return parts.join(" ");
}

/** Reads schema metadata only. No application rows, secrets or ledger writes. */
export async function readSchemaContract(database) {
  const query = async (sql) => (await database.execute(sql)).rows.map((row) => ({ ...row }));
  const objects = await query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name GLOB 'portal_*' ORDER BY type, name");
  const tables = {};
  for (const table of objects.filter((object) => object.type === "table")) {
    const columns = await query(`PRAGMA table_xinfo(${identifier(table.name)})`);
    const indexes = await query(`PRAGMA index_list(${identifier(table.name)})`);
    const foreignKeys = await query(`PRAGMA foreign_key_list(${identifier(table.name)})`);
    tables[table.name] = {
      columns: columns.map((column) => ({ name: column.name, type: column.type.toLowerCase(),
        notNull: Boolean(column.notnull), primaryKey: Number(column.pk),
        default: normalizedDefault(column.dflt_value), hidden: Number(column.hidden) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      indexes: ordered(await Promise.all(indexes.map(async (index) => {
        const columns = await query(`PRAGMA index_xinfo(${identifier(index.name)})`);
        return ({
        name: index.origin === "c" ? index.name : null, origin: index.origin,
        unique: Boolean(index.unique), partial: Boolean(index.partial),
        columns: columns
          .map((column) => ({ name: column.name, descending: Boolean(column.desc),
            collation: column.coll, key: Boolean(column.key) })),
        // Partial predicates/expression indexes must not be silently ignored.
        expression: index.partial || columns.some((column) => column.cid === -2)
          ? tokens(objects.find((object) => object.name === index.name)?.sql).join(" ") : null,
      }); }))),
      foreignKeys: ordered([...new Set(foreignKeys.map((key) => key.id))].map((id) => {
        const keys = foreignKeys.filter((key) => key.id === id).sort((a, b) => a.seq - b.seq);
        const first = keys[0];
        return { table: first.table, onUpdate: first.on_update, onDelete: first.on_delete, match: first.match,
          columns: keys.map(({ from, to }) => ({ from, to })) };
      })),
      checks: checks(table.sql),
      triggers: objects.filter((object) => object.type === "trigger" && object.tbl_name === table.name)
        .map((trigger) => ({ name: trigger.name, sql: tokens(trigger.sql).filter((token, index, all) =>
          !(token === "if" && all[index + 1] === "not" && all[index + 2] === "exists") &&
          !(token === "not" && all[index - 1] === "if" && all[index + 1] === "exists") &&
          !(token === "exists" && all[index - 2] === "if" && all[index - 1] === "not") &&
          !(token === ";" && index === all.length - 1)).join(" ") })),
    };
  }
  return { version: 1, tables };
}

export function compareSchemaContracts(expected, actual) {
  const differences = [];
  for (const table of [...new Set([...Object.keys(expected.tables), ...Object.keys(actual.tables)])].sort()) {
    if (!expected.tables[table]) differences.push({ table, kind: "unexpected-table" });
    else if (!actual.tables[table]) differences.push({ table, kind: "missing-table" });
    else for (const kind of ["columns", "indexes", "foreignKeys", "checks", "triggers"]) {
      if (JSON.stringify(expected.tables[table][kind]) !== JSON.stringify(actual.tables[table][kind])) {
        differences.push({ table, kind });
      }
    }
  }
  return differences;
}

export function schemaFingerprint(contract) {
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}
