import { normalizeConcurrency } from "./async-pool.js";
import { INCLUDE_DEBUG_JSON as DEVELOPMENT_BUILD } from "./build-mode.js";

export const PRODUCTION_ATTACHMENT_DOWNLOAD_CONCURRENCY = 10;
export const DEVELOPMENT_ATTACHMENT_DOWNLOAD_CONCURRENCY = 3;
export const MIN_ATTACHMENT_DOWNLOAD_CONCURRENCY = 1;
export const MAX_ATTACHMENT_DOWNLOAD_CONCURRENCY = 10;

export function effectiveInstallType(installType, developmentBuild = DEVELOPMENT_BUILD) {
  return developmentBuild ? installType : null;
}

export async function getInstallType(management = globalThis.chrome?.management) {
  if (!DEVELOPMENT_BUILD) return null;

  try {
    const info = await management?.getSelf?.();
    return effectiveInstallType(info?.installType || null);
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
