const VALID_TIERS = new Set(["free", "paid", "premium"]);
const CANONICAL_PRODUCTION_HOSTS = new Set(["jubly-reader.vercel.app"]);

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase().replace(/:\d+$/, "");
}

function getRequestHost(req) {
  return normalizeHost(
    req?.headers?.["x-forwarded-host"]
    || req?.headers?.host
    || ""
  );
}

function isLocalHost(host) {
  return host === "localhost" || host === "127.0.0.1";
}

function isCanonicalProductionHost(host) {
  return CANONICAL_PRODUCTION_HOSTS.has(host);
}

function isPreviewHost(host) {
  return !!host && host.endsWith('.vercel.app') && !isCanonicalProductionHost(host);
}

export function resolveRuntimeTier(value) {
  const tier = String(value || "").trim().toLowerCase();
  return VALID_TIERS.has(tier) ? tier : "free";
}

export function isRuntimeTierSimulationAllowed(req) {
  const envValue = String(process.env.ALLOW_TIER_SIMULATION || '').trim().toLowerCase();
  if (envValue === '1' || envValue === 'true' || envValue === 'yes') return true;
  const host = getRequestHost(req);
  return isLocalHost(host) || isPreviewHost(host);
}

export function getDefaultRuntimeTier() {
  return resolveRuntimeTier(process.env.RUNTIME_DEFAULT_TIER || 'free');
}

export function buildRuntimePolicy(inputTier = "free") {
  const tier = resolveRuntimeTier(inputTier);
  const elevated = tier !== "free";

  const usageDailyLimit = tier === "premium"
    ? 10000
    : tier === "paid"
      ? 1000
      : 100;

  const importSlotLimit = tier === "premium"
    ? null
    : tier === "paid"
      ? 5
      : 2;

  return {
    version: 1,
    tier,
    simulationAllowed: false,
    usageDailyLimit,
    importSlotLimit,
    features: {
      modes: {
        reading: true,
        comprehension: elevated,
        research: elevated,
      },
      aiEvaluate: elevated,
      anchors: elevated,
      cloudVoices: elevated,
      themes: {
        explorer: elevated,
        customMusic: elevated,
      },
    },
  };
}
