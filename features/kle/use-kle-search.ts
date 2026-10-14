"use client";

import { useEffect, useRef, useState } from "react";
import type { KleCatalog, KleCatalogEntry } from "./domain";

const PAGE_SIZE = 20;
const SEARCH_ERROR = "Søgningen kunne ikke hentes. Dine valgte emner er bevaret.";
const SOURCE_ERROR = "Kildegrundlaget er ændret eller kan ikke bruges til denne registrering. Dine valgte emner er bevaret.";
type SearchRequest = { query: string; offset: number; attempt: number };
type SearchState = {
  catalog: KleCatalog;
  request: SearchRequest;
  results: KleCatalogEntry[];
  total: number;
  hasMore: boolean;
  error: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readSearchResult(data: unknown, catalog: KleCatalog, request: SearchRequest) {
  if (!object(data) || !object(data.source)) throw new Error(SEARCH_ERROR);
  const source = data.source;
  if (source.id !== catalog.source.id || source.version !== catalog.source.version ||
    source.kind !== catalog.source.kind || source.status !== "available" ||
    source.status !== catalog.source.status || source.acceptedForUse !== catalog.source.acceptedForUse) {
    throw new Error(SOURCE_ERROR);
  }
  if (!Array.isArray(data.results) || data.results.length > PAGE_SIZE ||
    !Number.isSafeInteger(data.total) || (data.total as number) < 0 ||
    data.offset !== request.offset || data.limit !== PAGE_SIZE || typeof data.hasMore !== "boolean" ||
    (data.total as number) < request.offset + data.results.length ||
    data.hasMore !== (request.offset + data.results.length < (data.total as number)) ||
    (data.hasMore && !data.results.length)) throw new Error(SEARCH_ERROR);
  // Search results cannot introduce entries from a different snapshot into the review.
  const canonical = new Map(catalog.entries.map((entry) => [entry.uuid, entry]));
  const results = data.results.map((entry) => {
    const match = object(entry) && typeof entry.uuid === "string" ? canonical.get(entry.uuid) : undefined;
    if (!match || !object(entry) || match.retired || entry.retired !== false ||
      match.code !== entry.code || match.title !== entry.title || match.level !== entry.level) throw new Error(SOURCE_ERROR);
    return match;
  });
  if (new Set(results.map((entry) => entry.uuid)).size !== results.length) throw new Error(SEARCH_ERROR);
  return { results, total: data.total as number, hasMore: data.hasMore };
}

/** Query text stays in the request body and never enters browser history or external links. */
export function useKleSearch(catalog: KleCatalog) {
  const [request, setRequest] = useState<SearchRequest>({ query: "", offset: 0, attempt: 0 });
  const [state, setState] = useState<SearchState | null>(null);
  const sequence = useRef(0);
  const sameQuery = state?.catalog === catalog && state.request.query === request.query;
  const loading = state?.catalog !== catalog || state.request !== request;
  const results = sameQuery ? state.results : [];
  const error = !loading ? state.error : "";

  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
      try {
        const response = await fetch("/api/kle/search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: request.query, offset: request.offset, limit: PAGE_SIZE }),
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(SEARCH_ERROR);
        const page = readSearchResult(await response.json(), catalog, request);
        if (cancelled || controller.signal.aborted || current !== sequence.current) return;
        setState((previous) => {
          const prior = request.offset && previous?.catalog === catalog && previous.request.query === request.query
            ? previous.results : [];
          const combined = [...prior, ...page.results];
          if (new Set(combined.map((entry) => entry.uuid)).size !== combined.length) {
            return { catalog, request, results: prior, total: previous?.total ?? 0, hasMore: false, error: SEARCH_ERROR };
          }
          return { catalog, request, ...page, results: combined, error: "" };
        });
      } catch (failure) {
        if (cancelled || (controller.signal.aborted && !timedOut) || current !== sequence.current) return;
        setState((previous) => ({
          catalog, request,
          results: previous?.catalog === catalog && previous.request.query === request.query ? previous.results : [],
          total: previous?.catalog === catalog && previous.request.query === request.query ? previous.total : 0,
          hasMore: false,
          error: failure instanceof Error && failure.message === SOURCE_ERROR ? SOURCE_ERROR : SEARCH_ERROR,
        }));
      } finally { clearTimeout(timeout); }
    }, request.offset ? 0 : 200);
    return () => {
      clearTimeout(timer);
      cancelled = true;
      controller.abort();
    };
  }, [catalog, request]);

  return {
    query: request.query, results, loading, error,
    total: sameQuery ? state.total : 0,
    hasMore: !loading && !error && sameQuery && state.hasMore,
    setQuery(query: string) {
      ++sequence.current;
      setRequest({ query, offset: 0, attempt: 0 });
    },
    retry() { setRequest((current) => ({ ...current, attempt: current.attempt + 1 })); },
    loadMore() {
      if (!loading && !error && state?.hasMore) setRequest((current) => ({ ...current, offset: state.results.length }));
    },
  };
}
