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

section("base speed comes from the 5e species");
{
  const goliath = {
    effects: [],
    data: { species: [{ name: "Goliath", data: { speed: "35 ft" } }], features: [], inventory: [] },
  };
  assert("species speed used as base", calculateSpeed(goliath), "35 ft");
  assert(
    "no species falls back to 30 ft",
    calculateSpeed({ effects: [], data: { features: [], inventory: [] } }),
    "30 ft",
  );
}

section("armor predicates gate speed bonuses (Unarmored / Fast Movement)");
{
  const plate = { name: "Plate Armor", data: { type: "armor", armorCategory: "Heavy", carried: "equipped" } };
  const leather = { name: "Leather Armor", data: { type: "armor", armorCategory: "Light", carried: "equipped" } };
  const shield = { name: "Shield", data: { type: "shield", carried: "equipped" } };
  const packedPlate = { name: "Plate Armor", data: { type: "armor", armorCategory: "Heavy", carried: "carried" } };
  const char = (mod, inventory) => ({
    effects: [],
    data: { features: [{ name: "F", data: { modifiers: [mod] } }], inventory },
  });
  const unarmored = {
    data: {
      type: "speedBonus",
      value: "10",
      predicate: JSON.stringify(["self:armor:none", { not: "self:shield" }]),
    },
  };
  const notHeavy = {
    data: { type: "speedBonus", value: "10", predicate: JSON.stringify({ not: "self:armor:heavy" }) },
  };
  assert("unarmored: no armor → +10", calculateSpeed(char(unarmored, [])), "40 ft");
  assert("unarmored: armor carried, not worn → +10", calculateSpeed(char(unarmored, [packedPlate])), "40 ft");
  assert("unarmored: light armor → no bonus", calculateSpeed(char(unarmored, [leather])), "30 ft");
  assert("unarmored: shield only → no bonus", calculateSpeed(char(unarmored, [shield])), "30 ft");
  assert("fast movement: light armor → +10", calculateSpeed(char(notHeavy, [leather])), "40 ft");
  assert("fast movement: heavy armor → no bonus", calculateSpeed(char(notHeavy, [plate])), "30 ft");
}

summary();
