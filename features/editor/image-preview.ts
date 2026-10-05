import { isSafeImageUrl } from "../workspace/model";

/** Validate before rendering: an unsaved editor value is still untrusted. */
export function safeImagePreviewSource(value: string): string | null {
  const source = value.trim();
  if (!isSafeImageUrl(source) || /[\u0000-\u001f\u007f\\]/u.test(source)) return null;
  const raster = /^data:image\/(avif|gif|jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/iu.exec(source);
  if (raster) return `data:image/${raster[1].toLowerCase()};base64,${raster[2]}`;
  try {
    const url = new URL(source, "https://image-preview.invalid");
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (source.startsWith("/")) {
      if (url.origin !== "https://image-preview.invalid" || url.pathname.startsWith("//")) return null;
      return `/${url.pathname.slice(1)}${url.search}${url.hash}`;
    }
    // Reconstruct a validated URL with a fixed scheme, never a user-controlled
    // scheme or markup. React continues to escape the attribute's contents.
    return `https://${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
