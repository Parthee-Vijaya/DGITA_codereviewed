import { createHash } from "node:crypto";

import {
  del,
  get,
  getDownloadUrl,
  issueSignedToken,
  presignUrl,
} from "@vercel/blob";

import {
  getConfiguredPersistenceRuntime,
  readVercelPersistenceEnvironment,
  toPrivateBlobLocation,
  toPrivateBlobLocator,
  toPrivateBlobPathname,
  toPrivateBlobUrl,
  type VercelPersistenceEnvironment,
} from "../../db/persistence-runtime";
import { MAX_UPLOAD_BYTES } from "./engine";

const UPLOAD_URL_TTL_MS = 10 * 60 * 1_000;
const DOWNLOAD_URL_TTL_MS = 2 * 60 * 1_000;

export class VercelBlobTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VercelBlobTransferError";
  }
}

export function isVercelBlobTransferEnabled(
  environment: VercelPersistenceEnvironment = process.env,
) {
  if (getConfiguredPersistenceRuntime(environment) !== "vercel") return false;
  return Boolean(readVercelPersistenceEnvironment(environment));
}

export async function createPrivateBlobUploadUrl(
  pathname: string,
  input: { contentType: string; size: number },
  now = Date.now(),
) {
  try {
    const safePathname = toPrivateBlobPathname(pathname);
    const validUntil = now + UPLOAD_URL_TTL_MS;
    const constraints = {
      pathname: safePathname,
      operations: ["put" as const],
      validUntil,
      allowedContentTypes: [input.contentType],
      maximumSizeInBytes: input.size,
      ...requireBlobAuthentication(),
    };
    const signedToken = await issueSignedToken(constraints);
    const { presignedUrl } = await presignUrl(signedToken, {
      access: "private",
      operation: "put",
      pathname: safePathname,
      validUntil,
      allowedContentTypes: constraints.allowedContentTypes,
      maximumSizeInBytes: constraints.maximumSizeInBytes,
      allowOverwrite: false,
      addRandomSuffix: false,
    });
    return { uploadUrl: presignedUrl, validUntil };
  } catch (error) {
    throw safeBlobError(error, "Uploadadressen kunne ikke oprettes.");
  }
}

export async function createPrivateBlobDownloadUrl(pathname: string, now = Date.now()) {
  try {
    const blobUrl = await resolvePrivateBlobUrl(pathname);
    const actualPathname = privateBlobActualPathname(blobUrl);
    const delegationValidUntil = now + DOWNLOAD_URL_TTL_MS;
    const generatedUrl = await createPrivateBlobReadUrl(
      actualPathname,
      delegationValidUntil,
      true,
    );
    return getDownloadUrl(mergePrivateBlobSignedUrl(blobUrl, generatedUrl));
  } catch (error) {
    throw safeBlobError(error, "Downloadadressen kunne ikke oprettes.");
  }
}

export async function verifyPrivateBlobReference(blobUrl: string, expectedPathname: string) {
  try {
    const exactUrl = toPrivateBlobUrl(blobUrl);
    const actualPathname = privateBlobActualPathname(exactUrl);
    const result = await get(exactUrl, {
      access: "private",
      ...requireBlobAuthentication(),
      useCache: false,
    });
    if (
      !result ||
      result.statusCode !== 200 ||
      result.blob.pathname !== actualPathname ||
      !privateBlobPathMatchesLogical(actualPathname, expectedPathname)
    ) {
      throw new VercelBlobTransferError("Filreferencen svarer ikke til den klargjorte upload.");
    }
    await result.stream.cancel().catch(() => undefined);
    return exactUrl;
  } catch (error) {
    throw safeBlobError(error, "Filreferencen kunne ikke verificeres.");
  }
}

export async function inspectPrivateBlob(blobUrl: string, expectedPathname: string) {
  try {
    const exactUrl = toPrivateBlobUrl(blobUrl);
    const actualPathname = privateBlobActualPathname(exactUrl);
    if (!privateBlobPathMatchesLogical(actualPathname, expectedPathname)) {
      throw new VercelBlobTransferError("Filen blev ikke fundet i dokumentlageret.");
    }
    return await readPrivateBlobIntegrity(exactUrl, true);
  } catch (error) {
    throw safeBlobError(error, "Filen kunne ikke integritetskontrolleres.");
  }
}

/**
 * Revalidates the exact private object before a versionslåst approval download
 * is delegated to Blob. This preserves the prior size/SHA-256 guarantee without
 * proxying a potentially 25 MB response through a Vercel Function.
 */
export async function inspectPrivateBlobIntegrity(location: string) {
  try {
    const exactUrl = await resolvePrivateBlobUrl(location);
    return await readPrivateBlobIntegrity(exactUrl);
  } catch (error) {
    throw safeBlobError(error, "Filen kunne ikke integritetskontrolleres.");
  }
}

export async function deletePrivateBlob(pathname: string) {
  await del(toPrivateBlobLocation(pathname), requireBlobAuthentication());
}

async function createPrivateBlobReadUrl(
  pathname: string,
  validUntil: number,
  useCache: boolean,
) {
  const signedToken = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
    ...requireBlobAuthentication(),
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    access: "private",
    operation: "get",
    pathname,
    validUntil,
    useCache,
  });
  return presignedUrl;
}

function requireBlobAuthentication() {
  const environment = readVercelPersistenceEnvironment();
  if (!environment) {
    throw new VercelBlobTransferError("Vercel Blob er ikke konfigureret.");
  }
  return "blobToken" in environment
    ? { token: environment.blobToken }
    : {
        storeId: environment.blobStoreId,
        ...(environment.blobOidcToken
          ? { oidcToken: environment.blobOidcToken }
          : {}),
      };
}

async function resolvePrivateBlobUrl(location: string) {
  const locator = toPrivateBlobLocator(location);
  if (locator.kind === "url") return locator.value;
  const pathname = locator.value;
  const result = await get(pathname, {
    access: "private",
    ...requireBlobAuthentication(),
    useCache: false,
  });
  if (!result || result.statusCode !== 200) {
    throw new VercelBlobTransferError("Filen blev ikke fundet i dokumentlageret.");
  }
  await result.stream.cancel().catch(() => undefined);
  return toPrivateBlobUrl(result.blob.url);
}

async function readPrivateBlobIntegrity(exactUrl: string, includeBytes = false) {
  const actualPathname = privateBlobActualPathname(exactUrl);
  const result = await get(exactUrl, {
    access: "private",
    ...requireBlobAuthentication(),
    useCache: false,
  });
  if (
    !result ||
    result.statusCode !== 200 ||
    !result.stream ||
    result.blob.pathname !== actualPathname
  ) {
    throw new VercelBlobTransferError("Filen blev ikke fundet i dokumentlageret.");
  }

  const reader = result.stream.getReader();
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel("Upload exceeds the configured size limit.");
        throw new VercelBlobTransferError("Filen er større end den tilladte grænse.");
      }
      hash.update(next.value);
      if (includeBytes) chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (size !== result.blob.size) {
    throw new VercelBlobTransferError("Filens størrelse kunne ikke integritetskontrolleres.");
  }
  const bytes = includeBytes ? new Uint8Array(size) : undefined;
  if (bytes) {
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  }
  return {
    size,
    contentType: (result.blob.contentType || "application/octet-stream").toLowerCase(),
    checksum: hash.digest("hex"),
    storageLocator: exactUrl,
    ...(bytes ? { bytes } : {}),
  };
}

export function privateBlobActualPathname(value: string) {
  const pathname = new URL(toPrivateBlobUrl(value)).pathname.slice(1);
  const decoded = decodeURIComponent(pathname);
  return toPrivateBlobPathname(decoded);
}

export function mergePrivateBlobSignedUrl(blobUrl: string, generatedSignedUrl: string) {
  const signedParameters = new URL(generatedSignedUrl).searchParams;
  const exactUrl = new URL(toPrivateBlobUrl(blobUrl));
  for (const [key, value] of signedParameters) exactUrl.searchParams.set(key, value);
  return exactUrl.toString();
}

export function privateBlobPathMatchesLogical(actualPathname: string, logicalPathname: string) {
  let actual: string;
  let logical: string;
  try {
    actual = toPrivateBlobPathname(actualPathname);
    logical = toPrivateBlobPathname(logicalPathname);
  } catch {
    return false;
  }
  if (actual === logical) return true;

  const actualSegments = actual.split("/");
  const logicalSegments = logical.split("/");
  if (actualSegments.length !== logicalSegments.length) return false;
  if (
    actualSegments.slice(0, -1).some(
      (segment, index) => segment !== logicalSegments[index],
    )
  ) {
    return false;
  }

  const logicalName = logicalSegments.at(-1) ?? "";
  const actualName = actualSegments.at(-1) ?? "";
  const extensionIndex = logicalName.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? logicalName.slice(0, extensionIndex) : logicalName;
  const extension = hasExtension ? logicalName.slice(extensionIndex) : "";
  const expectedPrefix = `${stem}-`;
  if (!actualName.startsWith(expectedPrefix) || !actualName.endsWith(extension)) return false;
  const suffixEnd = extension ? actualName.length - extension.length : actualName.length;
  const suffix = actualName.slice(expectedPrefix.length, suffixEnd);
  return /^[a-z0-9]{16,64}$/iu.test(suffix);
}

function safeBlobError(error: unknown, fallbackMessage: string) {
  return error instanceof VercelBlobTransferError
    ? error
    : new VercelBlobTransferError(fallbackMessage);
}
