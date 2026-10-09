import { CATALOG_METADATA } from "../../../features/catalog/metadata";
import catalogData from "../../../features/catalog/data/system-catalog.json";
import { searchCatalog, type CatalogSystem } from "../../../features/catalog/search";
import { authErrorResponse } from "../../../features/auth/http";
import { requireActor } from "../../../features/auth/server";

const catalog = catalogData as CatalogSystem[];

export async function GET(request: Request) {
  try {
    await requireActor(request);
    const query = new URL(request.url).searchParams.get("q")?.slice(0, 120) ?? "";
    const results = searchCatalog(catalog, query, 8);

    return Response.json(
      {
        results,
        metadata: CATALOG_METADATA,
        total: catalog.length,
        usedInKalundborg: catalog.filter((system) => system.usedInKalundborg).length,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60",
        },
      },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
