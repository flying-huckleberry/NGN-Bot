// src/services/racing/logic.js
const partsConfig = require('./parts');
const VENUE_WEIGHTS = require('./venues');

function getTrackWeights(venue, weather) {
  const venueTable = VENUE_WEIGHTS[venue];

  if (!venueTable) {
    // fallback to some known-good default
    const fallbackVenue = VENUE_WEIGHTS['Harbor'] || Object.values(VENUE_WEIGHTS)[0];
    return fallbackVenue.Sunny || Object.values(fallbackVenue)[0];
  }

  const w = venueTable[weather];
  if (!w) {
    return venueTable.Sunny || Object.values(venueTable)[0];
  }

  return w;
}

function baseStats() {
  return {
    grip: 0,
    handling: 0,
    deceleration: 0,
    torquehigh: 0,
    torquelow: 0,
    topspeed: 0,
    reliability: 0,
    weight: 0,
    curves: 0,
    straights: 0,
    rain: 0,
    fog: 0,
    rocky: 0,
  };
}

// Build a car's final stat vector by summing all equipped parts.
function buildCarStats(parts) {
  const stats = baseStats();

  for (const slot of Object.keys(partsConfig)) {
    const choiceName = parts[slot] || 'stock';
    const slotConfig = partsConfig[slot] || {};
    const choice = slotConfig[choiceName] || slotConfig.stock;
    if (!choice) continue;

    for (const key of Object.keys(stats)) {
      if (choice[key]) {
        stats[key] += choice[key];
      }
    }
  }

  return stats;
}

function computeScore(carStats, weights) {
  let score = 0;
  for (const [stat, weight] of Object.entries(weights)) {
    if (!weight) continue;
    score += (carStats[stat] || 0) * weight;
  }
  return score;
}

/**
 * Casualties / DNFs
 */

const CRITICAL_SLOTS = ['tires', 'suspension', 'brakes', 'intake', 'exhaust', 'ecu'];

// DNFs for: busted by cops, crash, or mechanical failure.
function rollCasualty(player, stats, weights, venue) {
  // Special hazard: bridge has a fixed chance to end in the river.
  if (venue === 'Bridge') {
    if (Math.random() < 0.10) {
      return { dnf: true, dnfReason: 'river', failedComponent: null };
    }
  }

  // --- 1) Compute total DNF chance (low, and build-dependent) ---

  // Baseline small risk for everyone
  let base = 0.01; // 1%

  // Track difficulty: wet, rough, and curvy tracks are inherently riskier
  base += (weights.rain || 0) * 0.003;     // +0.3% per rain weight
  base += (weights.rocky || 0) * 0.003;    // +0.3% per rocky weight
  base += (weights.curves || 0) * 0.002;   // +0.2% per curves weight

  // Mismatch between build and track: underbuilt in key areas = higher risk
  let mismatch = 0;
  mismatch += Math.max(0, (weights.rain || 0) - (stats.rain || 0));
  mismatch += Math.max(0, (weights.rocky || 0) - (stats.rocky || 0));
  mismatch += Math.max(0, (weights.curves || 0) - (stats.handling || 0));
  mismatch += Math.max(0, (weights.straights || 0) - (stats.topspeed || 0));

  // Each mismatch point bumps DNF chance a bit
  base += mismatch * 0.003; // +0.3% per mismatch

  // Reliability reduces risk (competent cars fail less)
  const reliability = stats.reliability || 0;
  const reliabilityFactor = 1 - Math.min(0.6, reliability * 0.05); // up to 60% reduction
  base *= reliabilityFactor;

  // Clamp total DNF chance between 0.5% and 12%
  let chance = Math.max(0.005, Math.min(0.12, base));

  if (Math.random() >= chance) {
    return { dnf: false, dnfReason: null, failedComponent: null };
  }

  // --- 2) Decide cause of DNF (fractions per venue) ---

  // We talk about percentages *of DNFs* here.
  // Mechanical ~5% of DNFs globally.
  const mechanicalFraction = 0.05;

  // Cops fraction depends on venue:
  // - I-69: ~20% of DNFs
  // - Street venues: small chance
  // - Proving Grounds (racetrack): 0% cops
  let copsFraction = 0;
  switch (venue) {
    case 'I-69':
      copsFraction = 0.20;
      break;
    case 'Harbor':
    case 'Hillside':
    case 'Quarry':
      copsFraction = 0.05;
      break;
    case 'Proving Grounds':
    default:
      copsFraction = 0.0;
      break;
  }

  // The remainder becomes crash fraction
  let crashFraction = 1 - mechanicalFraction - copsFraction;
  if (crashFraction < 0) {
    // In case someone tweaks fractions badly later
    crashFraction = 0;
  }

  const r = Math.random();
  let reason;
  if (r < copsFraction) {
    reason = 'cops';
  } else if (r < copsFraction + crashFraction) {
    reason = 'crash';
  } else {
    reason = 'mechanical';
  }

  // Mechanical failures pick a random critical component
  let failedComponent = null;
  if (reason === 'mechanical') {
    const ownedCritSlots = CRITICAL_SLOTS.filter(
      (slot) => player.parts && player.parts[slot]
    );
    if (ownedCritSlots.length) {
      const idx = Math.floor(Math.random() * ownedCritSlots.length);
      failedComponent = ownedCritSlots[idx];
    }
  }

  return { dnf: true, dnfReason: reason, failedComponent };
}


// players = [{ id, name, parts }]
// Returns a full outcome including DNFs and casualty details.
function computeRaceOutcome(players, venue, weather) {
  const weights = getTrackWeights(venue, weather);

  const enriched = players.map((p) => {
    const stats = buildCarStats(p.parts);
    const score = computeScore(stats, weights);
    const { dnf, dnfReason, failedComponent } = rollCasualty(
      p,
      stats,
      weights,
      venue
    );
    const randomKey = Math.random(); // used for tie-breaks and DNF ordering

    return {
      ...p,
      stats,
      score,
      dnf,
      dnfReason,
      failedComponent,
      randomKey,
    };
  });

  const finishers = enriched.filter((p) => !p.dnf);
  const dnfs = enriched.filter((p) => p.dnf);

  // Rank finishers by score, then randomKey
  finishers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.randomKey - b.randomKey;
  });

  // DNFs can be arbitrarily ordered (randomKey to keep things varied)
  dnfs.sort((a, b) => a.randomKey - b.randomKey);

  const ranked = [...finishers, ...dnfs];

  const casualties = dnfs.map((p) => ({
    id: p.id,
    name: p.name,
    reason: p.dnfReason,
    failedComponent: p.failedComponent || null,
  }));

  return { ranked, casualties };
}

// Backwards-compatible: rankPlayers now just returns the ranked array,
// including dnf / dnfReason fields, but ignores casualty list.
function rankPlayers(players, venue, weather) {
  const { ranked } = computeRaceOutcome(players, venue, weather);
  return ranked;
}

module.exports = {
  getTrackWeights,
  buildCarStats,
  computeScore,
  rankPlayers,
  computeRaceOutcome,
  VENUE_WEIGHTS,
};
