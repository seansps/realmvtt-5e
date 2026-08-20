#!/usr/bin/env node
// Tests for predicate-gated speed modifiers.
//
// calculateSpeed walks features/items directly rather than going through
// getEffectsAndModifiersForToken (whose `active` flag means "pre-checked in the
// roll prompt", not "in effect"). It therefore has to evaluate data.predicate
// itself, via evaluateStaticModifierPredicate — otherwise a toggle-gated speed
// bonus would apply whether or not its toggle was on.
//
// Run with: node tests/test-speed-predicate.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const { calculateSpeed } = ctx;

// A character with no heritage falls back to the 30 ft default.
function makeChar({ modifiers = [], itemModifiers = [], toggles = [], features = [] } = {}) {
  return {
    effects: [],
    data: {
      toggles,
      features: [
        { name: "Boar Charge", data: { modifiers } },
        ...features,
      ],
      inventory: [
        {
          name: "Boots of Speed",
          data: { carried: "equipped", modifiers: itemModifiers },
        },
      ],
    },
  };
}

const toggleOn = [{ name: "Boar Charge", data: { field: "boar-charge", active: true } }];
const toggleOff = [{ name: "Boar Charge", data: { field: "boar-charge", active: false } }];

const bonus10 = [
  { data: { type: "speedBonus", value: "10", predicate: "boar-charge" } },
];

section("speedBonus — toggle predicate");

assert(
  "toggle off: bonus withheld",
  calculateSpeed(makeChar({ modifiers: bonus10, toggles: toggleOff })),
  "30 ft",
);
assert(
  "toggle on: bonus applied",
  calculateSpeed(makeChar({ modifiers: bonus10, toggles: toggleOn })),
  "40 ft",
);
assert(
  "no predicate at all: bonus applied",
  calculateSpeed(
    makeChar({ modifiers: [{ data: { type: "speedBonus", value: "10" } }] }),
  ),
  "40 ft",
);

section("speedPenalty / baseSpeed — toggle predicate");

const penalty10 = [
  { data: { type: "speedPenalty", value: "10", predicate: "boar-charge" } },
];
assert(
  "penalty withheld when toggle off",
  calculateSpeed(makeChar({ modifiers: penalty10, toggles: toggleOff })),
  "30 ft",
);
assert(
  "penalty applied when toggle on",
  calculateSpeed(makeChar({ modifiers: penalty10, toggles: toggleOn })),
  "20 ft",
);

const base40 = [
  { data: { type: "baseSpeed", value: "40", predicate: "boar-charge" } },
];
assert(
  "baseSpeed upgrade withheld when toggle off",
  calculateSpeed(makeChar({ modifiers: base40, toggles: toggleOff })),
  "30 ft",
);
assert(
  "baseSpeed upgrade applied when toggle on",
  calculateSpeed(makeChar({ modifiers: base40, toggles: toggleOn })),
  "40 ft",
);

section("equipped items honor predicates too");

assert(
  "item bonus withheld when toggle off",
  calculateSpeed(makeChar({ itemModifiers: bonus10, toggles: toggleOff })),
  "30 ft",
);
assert(
  "item bonus applied when toggle on",
  calculateSpeed(makeChar({ itemModifiers: bonus10, toggles: toggleOn })),
  "40 ft",
);

section("other predicate vocabularies");

assert(
  "feature:<slug> present",
  calculateSpeed(
    makeChar({
      modifiers: [
        { data: { type: "speedBonus", value: "10", predicate: "feature:fleet-of-foot" } },
      ],
      features: [{ name: "Fleet of Foot", data: {} }],
    }),
  ),
  "40 ft",
);
assert(
  "feature:<slug> absent",
  calculateSpeed(
    makeChar({
      modifiers: [
        { data: { type: "speedBonus", value: "10", predicate: "feature:fleet-of-foot" } },
      ],
    }),
  ),
  "30 ft",
);
assert(
  "weapon: predicate can never resolve without roll context — withheld",
  calculateSpeed(
    makeChar({
      modifiers: [
        { data: { type: "speedBonus", value: "10", predicate: "weapon:name:tusk-attack" } },
      ],
    }),
  ),
  "30 ft",
);

section("named modes (non-numeric values)");

assert(
  "fly mode withheld when toggle off",
  calculateSpeed(
    makeChar({
      modifiers: [
        { data: { type: "speedBonus", value: "Fly (30 ft)", predicate: "boar-charge" } },
      ],
      toggles: toggleOff,
    }),
  ),
  "30 ft",
);
assert(
  "fly mode applied when toggle on",
  calculateSpeed(
    makeChar({
      modifiers: [
        { data: { type: "speedBonus", value: "Fly (30 ft)", predicate: "boar-charge" } },
      ],
      toggles: toggleOn,
    }),
  ),
  "30 ft, Fly (30 ft)",
);

summary();
