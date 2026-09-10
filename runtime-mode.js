import { normalizeConcurrency } from "./async-pool.js";

export const PRODUCTION_ATTACHMENT_DOWNLOAD_CONCURRENCY = 10;
export const DEVELOPMENT_ATTACHMENT_DOWNLOAD_CONCURRENCY = 3;
export const MIN_ATTACHMENT_DOWNLOAD_CONCURRENCY = 1;
export const MAX_ATTACHMENT_DOWNLOAD_CONCURRENCY = 10;

export async function getInstallType(management = globalThis.chrome?.management) {
  try {
    const info = await management?.getSelf?.();
    return info?.installType || null;
  } catch {
    return null;
  }
}

export function resolveAttachmentDownloadConcurrency(value, installType) {
  if (installType !== "development") {
    return PRODUCTION_ATTACHMENT_DOWNLOAD_CONCURRENCY;
  }

  return normalizeConcurrency(value, {
    defaultValue: DEVELOPMENT_ATTACHMENT_DOWNLOAD_CONCURRENCY,
    min: MIN_ATTACHMENT_DOWNLOAD_CONCURRENCY,
    max: MAX_ATTACHMENT_DOWNLOAD_CONCURRENCY
  });
}
