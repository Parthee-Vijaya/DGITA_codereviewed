"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isSafeNotificationId } from "./id";

export type PortalNotification = {
  id: string;
  eventType: string;
  title: string;
  body: string;
  linkPath: string | null;
  caseNumber: string | null;
  status: "unread" | "read" | "dismissed";
  createdAt: string;
};

type NotificationPayload = {
  unreadCount: number;
  notifications: PortalNotification[];
};

type NotificationState = NotificationPayload & {
  viewerKey: string;
  loading: boolean;
  error: string | null;
};

const EMPTY_PAYLOAD: NotificationPayload = { unreadCount: 0, notifications: [] };
const NOTIFICATION_REFRESH_INTERVAL_MS = 30_000;
const PORTAL_LINK_BASE = "https://dgita.portal.invalid";

export function usePortalNotifications(viewerKey: string) {
  const [state, setState] = useState<NotificationState>({
    viewerKey: "",
    ...EMPTY_PAYLOAD,
    loading: true,
    error: null,
  });
  const requestRef = useRef<AbortController | null>(null);
  const mutationRef = useRef<AbortController | null>(null);

  const load = useCallback(async (targetViewerKey: string, showLoading: boolean) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (showLoading) {
      setState((current) => ({
        viewerKey: targetViewerKey,
        ...(current.viewerKey === targetViewerKey ? current : EMPTY_PAYLOAD),
        loading: true,
        error: null,
      }));
    }

    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const next: unknown = await response.json();
      if (!response.ok) {
        throw new Error(responseMessage(next, "Notifikationerne kunne ikke hentes."));
      }
      if (!isNotificationPayload(next)) {
        throw new Error("Serveren returnerede ugyldige notifikationer.");
      }
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setState({
        viewerKey: targetViewerKey,
        ...next,
        loading: false,
        error: null,
      });
    } catch (reason) {
      if (isAbortError(reason) || requestRef.current !== controller) return;
      setState((current) => ({
        viewerKey: targetViewerKey,
        ...(current.viewerKey === targetViewerKey ? current : EMPTY_PAYLOAD),
        loading: false,
        error: errorMessage(reason),
      }));
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    await load(viewerKey, true);
  }, [load, viewerKey]);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    mutationRef.current?.abort();
    mutationRef.current = null;

    const initialRefresh = window.setTimeout(() => {
      void load(viewerKey, true);
    }, 0);
    const periodicRefresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(viewerKey, false);
    }, NOTIFICATION_REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load(viewerKey, false);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(periodicRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      requestRef.current?.abort();
      requestRef.current = null;
      mutationRef.current?.abort();
      mutationRef.current = null;
    };
  }, [load, viewerKey]);

  const mutateReadState = useCallback(async (input: { id?: string; all?: true }) => {
    mutationRef.current?.abort();
    const controller = new AbortController();
    mutationRef.current = controller;
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const next: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          responseMessage(next, "Notifikationerne kunne ikke opdateres."),
        );
      }
      if (!isNotificationPayload(next)) {
        throw new Error("Serveren returnerede ugyldige notifikationer.");
      }
      if (controller.signal.aborted || mutationRef.current !== controller) {
        return false;
      }
      requestRef.current?.abort();
      requestRef.current = null;
      setState({
        viewerKey,
        ...next,
        loading: false,
        error: null,
      });
      return true;
    } catch (reason) {
      if (isAbortError(reason) || mutationRef.current !== controller) return false;
      setState((current) => ({
        viewerKey,
        ...(current.viewerKey === viewerKey ? current : EMPTY_PAYLOAD),
        loading: false,
        error: errorMessage(reason),
      }));
      return false;
    } finally {
      if (mutationRef.current === controller) mutationRef.current = null;
    }
  }, [viewerKey]);

  const markRead = useCallback(async (id: string) => {
    if (!isSafeNotificationId(id)) return false;
    return mutateReadState({ id });
  }, [mutateReadState]);

  const markAllRead = useCallback(async () => {
    return mutateReadState({ all: true });
  }, [mutateReadState]);

  const isCurrentViewer = state.viewerKey === viewerKey;
  return {
    unreadCount: isCurrentViewer ? state.unreadCount : 0,
    notifications: isCurrentViewer ? state.notifications : [],
    loading: !isCurrentViewer || state.loading,
    error: isCurrentViewer ? state.error : null,
    refresh,
    markRead,
    markAllRead,
  };
}

export function caseNumberFromPortalLink(linkPath: string | null | undefined) {
  if (!linkPath || linkPath.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(linkPath, PORTAL_LINK_BASE);
  } catch {
    return null;
  }
  if (url.origin !== PORTAL_LINK_BASE || url.pathname !== "/") return null;
  return normalizeCaseNumber(url.searchParams.get("case"));
}

export function caseNumberFromNotification(notification: PortalNotification) {
  return (
    caseNumberFromPortalLink(notification.linkPath) ??
    normalizeCaseNumber(notification.caseNumber)
  );
}

function isNotificationPayload(value: unknown): value is NotificationPayload {
  if (!isRecord(value) || !Array.isArray(value.notifications)) return false;
  if (
    typeof value.unreadCount !== "number" ||
    !Number.isInteger(value.unreadCount) ||
    value.unreadCount < 0
  ) {
    return false;
  }
  return value.notifications.every(isPortalNotification);
}

function isPortalNotification(value: unknown): value is PortalNotification {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.eventType === "string" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    (value.linkPath === null || typeof value.linkPath === "string") &&
    (value.caseNumber === null || typeof value.caseNumber === "string") &&
    (value.status === "unread" ||
      value.status === "read" ||
      value.status === "dismissed") &&
    typeof value.createdAt === "string"
  );
}

function normalizeCaseNumber(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9][A-Z0-9._-]{2,63}$/.test(normalized) ? normalized : null;
}

function responseMessage(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : fallback;
}

function errorMessage(value: unknown) {
  return value instanceof Error
    ? value.message
    : "Notifikationerne kunne ikke opdateres.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(value: unknown) {
  return (
    (value instanceof DOMException && value.name === "AbortError") ||
    (value instanceof Error && value.name === "AbortError")
  );
}
