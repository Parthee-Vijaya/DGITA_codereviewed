"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { Actor } from "../auth/types";
import {
  DEFAULT_CONTENT,
  DEFAULT_IMAGES,
  normalizeDgitaApproval,
  type ContentEntry,
  type DgitaApproval,
  type FieldComment,
  type ImageEntry,
} from "./model";

type PortalWorkspace = {
  content: ContentEntry[];
  images: ImageEntry[];
  approvals: Record<string, DgitaApproval>;
  fieldComments: FieldComment[];
};

const INITIAL_WORKSPACE: PortalWorkspace = {
  content: [],
  images: [],
  approvals: {},
  fieldComments: [],
};

export function useDemoWorkspace(viewer: Actor) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<PortalWorkspace>(() =>
    structuredClone(INITIAL_WORKSPACE),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const viewerKey = JSON.stringify([viewer.tenantId, viewer.subject, viewer.role]);
  const [loadedViewerKey, setLoadedViewerKey] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const payload = (await response.json()) as {
        workspace?: PortalWorkspace;
        error?: string;
      };
      if (!response.ok || !payload.workspace) {
        throw new Error(payload.error || "Portalindholdet kunne ikke hentes.");
      }
      if (requestId !== requestRef.current) return;
      setWorkspace(payload.workspace);
      setLoadedViewerKey(viewerKey);
      setError(null);
    } catch (reason) {
      if (requestId === requestRef.current) setError((reason as Error).message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [router, viewerKey]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timeout); requestRef.current += 1; };
  }, [refresh, viewer.role, viewer.subject, viewer.tenantId]);

  const mutate = useCallback(async <T,>(body: unknown): Promise<T> => {
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as T & { error?: string };
      if (response.status === 401) {
        router.replace("/login");
        throw new Error("Din session er udløbet. Log ind igen.");
      }
      if (!response.ok) throw new Error(payload.error || "Ændringen kunne ikke gemmes.");
      setError(null);
      return payload;
    } catch (reason) {
      // Mutation failures belong to the editor; a failed save must never
      // unmount the editor or discard its unsaved input.
      throw reason;
    }
  }, [router]);

  const updateContent = useCallback(async (entry: ContentEntry, actor: Actor) => {
    if (actor.role !== "admin") return false;
    const { entry: saved } = await mutate<{ entry: ContentEntry }>({
      action: "content.upsert",
      entry,
    });
    setWorkspace((current) => ({
      ...current,
      content: current.content.map((item) => item.id === entry.id ? saved : item),
    }));
    return true;
  }, [mutate]);

  const addContent = useCallback(async (entry: ContentEntry, actor: Actor) => {
    if (actor.role !== "admin") return false;
    const { entry: saved } = await mutate<{ entry: ContentEntry }>({
      action: "content.upsert",
      entry,
    });
    setWorkspace((current) => ({ ...current, content: [...current.content, saved] }));
    return true;
  }, [mutate]);

  const removeContent = useCallback(async (id: string, actor: Actor) => {
    if (actor.role !== "admin") return false;
    const { deleted } = await mutate<{ deleted: boolean }>({ action: "content.delete", id });
    if (!deleted) return false;
    setWorkspace((current) => ({
      ...current,
      content: current.content.filter((entry) => entry.id !== id),
    }));
    return true;
  }, [mutate]);

  const resetContent = useCallback(async (actor: Actor) => {
    if (actor.role !== "admin") return false;
    await mutate<{ ok: true }>({ action: "content.reset" });
    setWorkspace((current) => ({
      ...current,
      content: structuredClone(DEFAULT_CONTENT),
    }));
    return true;
  }, [mutate]);

  const updateImage = useCallback(async (entry: ImageEntry, actor: Actor) => {
    if (actor.role !== "admin") return false;
    const { entry: saved } = await mutate<{ entry: ImageEntry }>({
      action: "image.upsert",
      entry,
    });
    setWorkspace((current) => ({
      ...current,
      images: current.images.map((item) => item.id === entry.id ? saved : item),
    }));
    return true;
  }, [mutate]);

  const resetImages = useCallback(async (actor: Actor) => {
    if (actor.role !== "admin") return false;
    await mutate<{ ok: true }>({ action: "image.reset" });
    setWorkspace((current) => ({ ...current, images: structuredClone(DEFAULT_IMAGES) }));
    return true;
  }, [mutate]);

  const updateApproval = useCallback(async (caseId: string, approval: DgitaApproval, actor: Actor) => {
    if (actor.role === "user") return false;
    const { approval: saved } = await mutate<{ approval: DgitaApproval }>({
      action: "approval.save",
      caseId,
      approval: normalizeDgitaApproval(approval),
      expectedUpdatedAt: approval.updatedAt ?? null,
      expectedRowVersion: approval.revision,
    });
    setWorkspace((current) => ({
      ...current,
      approvals: { ...current.approvals, [caseId]: saved },
    }));
    return true;
  }, [mutate]);

  const addFieldComment = useCallback(async (comment: FieldComment, actor: Actor) => {
    if (actor.role === "user") return false;
    const { comment: saved } = await mutate<{ comment: FieldComment }>({
      action: "field-comment.add",
      comment: {
        id: comment.id,
        caseId: comment.caseId,
        fieldId: comment.fieldId,
        fieldLabel: comment.fieldLabel,
        body: comment.body,
        visibility: comment.visibility,
      },
    });
    setWorkspace((current) => ({
      ...current,
      fieldComments: [...current.fieldComments, saved],
    }));
    return true;
  }, [mutate]);

  return {
    ...workspace,
    ready: !loading && !error && loadedViewerKey === viewerKey,
    loading,
    error,
    refresh,
    updateContent,
    addContent,
    removeContent,
    resetContent,
    updateImage,
    resetImages,
    updateApproval,
    addFieldComment,
  };
}
