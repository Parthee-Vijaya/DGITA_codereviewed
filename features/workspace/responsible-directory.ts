import type { DgitaApproval } from "./model";
import { WorkspaceInputError } from "./validation";

export type ResponsiblePersonOption = { id: string; name: string; identifier: string };
type DirectoryRow = { id: string; name: string; email: string };
type PersonReference = { id: string; name: string; active: boolean };

export async function activeResponsiblePeople(DB: D1Database, tenantId: string) {
  const result = await DB.prepare(`
    SELECT person.id, person.display_name AS name, person.email
    FROM portal_users person
    JOIN portal_tenants tenant ON tenant.id = person.tenant_id AND tenant.status = 'active'
    WHERE person.tenant_id = ? AND person.status = 'active'
      AND EXISTS (SELECT 1 FROM portal_user_roles role
        WHERE role.user_id = person.id AND role.tenant_id = person.tenant_id
          AND role.role IN ('dgita_consultant', 'admin'))
    ORDER BY person.display_name, person.id
  `).bind(tenantId).all<DirectoryRow>();
  return result.results;
}

/** This is a case-responsibility directory. It does not provide leader mandates. */
export async function listResponsiblePeople(DB: D1Database, tenantId: string): Promise<ResponsiblePersonOption[]> {
  const rows = await activeResponsiblePeople(DB, tenantId);
  const emailCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.email.trim().toLowerCase();
    emailCounts.set(key, (emailCounts.get(key) ?? 0) + 1);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    identifier: row.email.trim() && emailCounts.get(row.email.trim().toLowerCase()) === 1
      ? row.email.trim() : `${row.email.trim() || "Person"} · ${row.id}`,
  }));
}

/** The persisted identity is authoritative; incoming names are display snapshots only. */
export async function canonicalizeResponsiblePeople(
  DB: D1Database,
  tenantId: string,
  approval: DgitaApproval,
  previous: DgitaApproval | null,
  assignedConsultantUserId: string | null,
) {
  const people = await activeResponsiblePeople(DB, tenantId);
  const active = new Map(people.map((person) => [person.id, person]));
  const activeIds = new Set<string>();
  const preservedIds = new Set<string>();

  async function byId(id: string, priorId: string, priorName: string, label: string): Promise<PersonReference> {
    const person = active.get(id);
    if (person) {
      activeIds.add(id);
      return { id, name: person.name, active: true };
    }
    // Deactivation must not erase a historic assignment, nor allow attaching it elsewhere.
    if (id === priorId) {
      const historic = await DB.prepare("SELECT display_name AS name FROM portal_users WHERE id = ? AND tenant_id = ?")
        .bind(id, tenantId).first<{ name: string }>();
      if (historic) {
        preservedIds.add(id);
        return { id, name: priorName || historic.name, active: false };
      }
    }
    throw new WorkspaceInputError(422, `${label} skal vælges blandt aktive konsulenter eller administratorer i kommunen.`);
  }

  async function single(id: string, name: string, priorId: string, priorName: string, label: string) {
    if (id) return byId(id, priorId, priorName, label);
    if (!name.trim()) return { id: "", name: "", active: false };
    if (name === priorName) {
      if (priorId) return byId(priorId, priorId, priorName, label);
      // Preserve legacy text without inventing an association on an unrelated edit.
      return { id: "", name: priorName, active: false };
    }
    const matches = people.filter((person) => person.name.trim() === name.trim());
    if (matches.length !== 1) {
      throw new WorkspaceInputError(422, matches.length > 1
        ? `${label} er ikke entydig. Vælg personen i listen, så den rigtige identitet gemmes.`
        : `${label} skal vælges blandt aktive konsulenter eller administratorer i kommunen.`);
    }
    return byId(matches[0].id, "", "", label);
  }

  const responsible = await single(approval.responsibleUserId, approval.responsible,
    previous?.responsibleUserId ?? "", previous?.responsible ?? "", "D-GITA-ansvarlig");
  const itConsultant = await single(approval.itConsultantUserId, approval.itConsultant,
    previous?.itConsultantUserId ?? "", previous?.itConsultant ?? "", "IT-konsulent");
  let additionalIds = approval.additionalResponsibleUserIds;
  let additionalNames = "";
  if (approval.hasAdditionalResponsible === "Ja") {
    if (additionalIds.length === 0 && approval.additionalResponsible === previous?.additionalResponsible && previous.hasAdditionalResponsible === "Ja") {
      additionalIds = previous.additionalResponsibleUserIds;
      additionalNames = previous.additionalResponsible;
    } else if (additionalIds.length === 0) {
      throw new WorkspaceInputError(422, "Vælg yderligere D-GITA-ansvarlige i personlisten.");
    }
    const names = await Promise.all(additionalIds.map(async (id) => {
      const priorId = previous?.additionalResponsibleUserIds.includes(id) ? id : "";
      return (await byId(id, priorId, "", "Yderligere D-GITA-ansvarlig")).name;
    }));
    if (names.length) additionalNames = names.join(", ");
    if (responsible.id && additionalIds.includes(responsible.id)) {
      throw new WorkspaceInputError(422, "Den primære D-GITA-ansvarlige skal ikke også vælges som yderligere ansvarlig.");
    }
  }
  let assignmentId = responsible.id || null;
  if (!responsible.id && responsible.name && responsible.name === previous?.responsible) {
    // Some legacy rows have a real application assignment but only a name in JSON.
    assignmentId = assignedConsultantUserId;
    if (assignmentId) preservedIds.add(assignmentId);
  }
  return {
    approval: {
      ...approval,
      responsible: responsible.name,
      responsibleUserId: responsible.id,
      itConsultant: itConsultant.name,
      itConsultantUserId: itConsultant.id,
      additionalResponsibleUserIds: approval.hasAdditionalResponsible === "Ja" ? additionalIds : [],
      additionalResponsible: additionalNames,
    },
    assignmentId,
    activeIds: [...activeIds],
    preservedIds: [...preservedIds],
  };
}
