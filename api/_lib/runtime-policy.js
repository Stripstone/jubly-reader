const VALID_TIERS = new Set(["free", "paid", "premium"]);

export function resolveRuntimeTier(value) {
  const tier = String(value || "").trim().toLowerCase();
  return VALID_TIERS.has(tier) ? tier : "free";
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
