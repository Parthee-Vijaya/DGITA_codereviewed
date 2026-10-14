"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaseDetailApiError,
  getCaseDetail,
  type CaseDetail,
} from "./case-detail-client";

export type CaseDetailError = {
  message: string;
  status?: number;
};

export type UseCaseDetailResult = {
  detail: CaseDetail | null;
  isLoading: boolean;
  error: CaseDetailError | null;
  refetch: () => Promise<void>;
};

type CaseDetailState = {
  caseNumber: string | null;
  refreshKey: string;
  detail: CaseDetail | null;
  status: "idle" | "loading" | "success" | "error";
  error: CaseDetailError | null;
};

export function useCaseDetail(
  caseNumber: string | null | undefined,
  refreshKey = "",
): UseCaseDetailResult {
  const normalizedCaseNumber = caseNumber?.trim().toUpperCase() || null;
  const [state, setState] = useState<CaseDetailState>({
    caseNumber: null,
    refreshKey,
    detail: null,
    status: "idle",
    error: null,
  });
  const requestRef = useRef<{
    caseNumber: string;
    controller: AbortController;
  } | null>(null);

  const load = useCallback(async (targetCaseNumber: string, targetRefreshKey: string) => {
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const request = { caseNumber: targetCaseNumber, controller };
    requestRef.current = request;
    setState((current) => ({
      caseNumber: targetCaseNumber,
      refreshKey: targetRefreshKey,
      detail: current.caseNumber === targetCaseNumber ? current.detail : null,
      status: "loading",
      error: null,
    }));

    try {
      const detail = await getCaseDetail(targetCaseNumber, controller.signal);
      if (controller.signal.aborted || requestRef.current !== request) return;
      setState({
        caseNumber: targetCaseNumber,
        refreshKey: targetRefreshKey,
        detail,
        status: "success",
        error: null,
      });
    } catch (caught) {
      if (isAbortError(caught) || requestRef.current !== request) return;
      setState((current) => ({
        caseNumber: targetCaseNumber,
        refreshKey: targetRefreshKey,
        detail: current.caseNumber === targetCaseNumber ? current.detail : null,
        status: "error",
        error: toCaseDetailError(caught),
      }));
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
    if (!normalizedCaseNumber) return;

    const loadTimeout = window.setTimeout(() => {
      void load(normalizedCaseNumber, refreshKey);
    }, 0);
    return () => {
      window.clearTimeout(loadTimeout);
      requestRef.current?.controller.abort();
      requestRef.current = null;
    };
  }, [load, normalizedCaseNumber, refreshKey]);

  const refetch = useCallback(async () => {
    if (!normalizedCaseNumber) return;
    await load(normalizedCaseNumber, refreshKey);
  }, [load, normalizedCaseNumber, refreshKey]);

  const isCurrentCase = state.caseNumber === normalizedCaseNumber;
  return {
    detail: isCurrentCase ? state.detail : null,
    isLoading: Boolean(
      normalizedCaseNumber && (!isCurrentCase || state.refreshKey !== refreshKey || state.status === "loading"),
    ),
    error: isCurrentCase ? state.error : null,
    refetch,
  };
}

function toCaseDetailError(error: unknown): CaseDetailError {
  if (error instanceof CaseDetailApiError) {
    return { message: error.message, status: error.status };
  }
  return { message: "Sagen kunne ikke hentes. Prøv igen." };
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
