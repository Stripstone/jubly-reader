// ===================================
// ⚙️ CONFIGURABLE SETTINGS (moved from index.html)
// ===================================

// ðŸ“ Goals
  const DEFAULT_TIME_GOAL = 160;           // seconds
  const DEFAULT_CHAR_GOAL = 300;           // characters
  // How far from the character goal we allow before we start treating the consolidation
  // as "too short" or "too long" for scoring guidance.
  // Example: 0.25 => sweet spot is 75%–125% of the goal.
  const COMPRESSION_TOLERANCE = 0.25;
  
  // â±ï¸ Sand Animation
  const SAND_START_PERCENTAGE = 0.3;  // Sand starts when 30% of time remains
  
  // 🔊 VOLUME CONTROLS (0.0 = mute, 1.0 = max)
  const SAND_VOLUME = 0.1;
  const STONE_VOLUME = 1.0;
  const MUSIC_VOLUME = 0.4;
  const REWARD_VOLUME = 1.0;
  const COMPASS_VOLUME = 1.0;
  const PAGE_TURN_VOLUME = 1.0;
  const EVALUATE_VOLUME = 0.6;
  
  // ðŸ† Tier Thresholds
  const TIER_MASTERFUL = 97;
  const TIER_PROFICIENT = 90;
  const TIER_COMPETENT = 75;
  const TIER_DEVELOPING = 55;
  
  // ðŸ“Š Score Weights (total must = 100)
  const WEIGHT_COMPREHENSION = 55;
  const WEIGHT_DISCIPLINE = 25;
  const WEIGHT_COMPRESSION = 20;

  // ❤️ Support link (optional)
  // Set this to your Buy Me a Coffee page, e.g. "https://www.buymeacoffee.com/yourname"
  // If left blank, the Donate button will still render but will do nothing.
  const BUY_ME_A_COFFEE_URL = "";
