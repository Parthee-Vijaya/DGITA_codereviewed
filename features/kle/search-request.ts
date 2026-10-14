import { AuthHttpError } from "../auth/http";

export function readKleSearchParameters(body: Record<string, unknown>) {
  if (Object.keys(body).some((key) => !["query", "offset", "limit"].includes(key)) ||
      typeof body.query !== "string" || body.query.length > 256 || /[\u0000-\u001f\u007f]/u.test(body.query) ||
      (body.offset !== undefined && (!Number.isSafeInteger(body.offset) || (body.offset as number) < 0)) ||
      (body.limit !== undefined && (!Number.isSafeInteger(body.limit) || (body.limit as number) < 1 || (body.limit as number) > 50))) {
    throw new AuthHttpError(400, "INVALID_KLE_SEARCH", "Søg med højst 256 tegn og en gyldig side af resultater.");
  }
  return { query: body.query, offset: (body.offset as number | undefined) ?? 0, limit: (body.limit as number | undefined) ?? 20 };
}
