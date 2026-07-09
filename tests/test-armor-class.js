#!/usr/bin/env node
// Tests for getArmorClassForToken — the target-AC resolver used by attacks.
//
// Behavior: base AC is the NPC's (already-baked) data.ac or a PC's fresh
// armor/dex computation; armorClassBonus/Penalty modifiers are added; the result
// is floored against data.ac (Math.max). The one special case is the NPC
// double-count fix: an effect that BOTH writes the AC field (client bakes it
// into data.ac) AND carries a bonus/penalty modifier would otherwise apply the
// same adjustment twice on an NPC (whose base already IS data.ac). Such an
// effect's modifier is skipped for NPCs only. PCs compute their base fresh, so
// their modifiers are additive and are never skipped.
//
// Run with: node tests/test-armor-class.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const { getArmorClassForToken } = ctx;

// ── Fixture builders ─────────────────────────────────────────────────────────
function acBonusRule(v) {
  return { type: "armorClassBonus", valueType: "number", value: String(v), field: "" };
}
function acPenaltyRule(v) {
  return { type: "armorClassPenalty", valueType: "number", value: String(v), field: "" };
}
// Client-handled rules that bake into data.ac.
function acDataRule(field, operation, value) {
  return { type: "data", value: { field, operation, value } };
}
function acOverrideRule(fields) {
  return { type: "override", valueType: "object", value: fields };
}

function acToken({
  recordType = "npcs",
  ac = 0,
  dex = 0,
  armor,
  wildShapeNpc = false,
  rules = [],
  effectsList,
} = {}) {
  const data = { ac: String(ac), dexterityMod: String(dex) };
  if (armor) data.armor = armor;
  if (wildShapeNpc) data.wildShapeNpc = true;
  const effects = effectsList
    ? effectsList
    : rules.length
      ? [{ name: "Test Effect", rules }]
      : [];
  return { record: { recordType }, data, effects, effectIds: [], effectValues: {} };
}

const acOf = (tok) => getArmorClassForToken(tok);

// ── NPC double-count fix (the reported bug) ──────────────────────────────────
section("getArmorClassForToken — NPC writing-effect counted once");

// "AC Bonus +2": armorClassBonus +2 AND data add 2. Client baked data.ac 15→17;
// the modifier must NOT add another +2 → stays 17 (previously 19).
assert(
  "NPC AC Bonus +2 (bonus + data add), baked 17 → 17 (not 19)",
  acOf(acToken({ ac: 17, dex: 0, rules: [acBonusRule(2), acDataRule("ac", "add", 2)] })),
  17,
);

// "AC Penalty -2": armorClassPenalty 2 AND data subtract 2. Client baked 15→13.
assert(
  "NPC AC Penalty -2 (penalty + data subtract), baked 13 → 13",
  acOf(acToken({ ac: 13, dex: 0, rules: [acPenaltyRule(2), acDataRule("ac", "subtract", 2)] })),
  13,
);

// Bloodied Haste shape: armorClassBonus +2 AND override ac = data.ac + 2.
assert(
  "NPC Bloodied Haste (bonus + override), baked 16 → 16",
  acOf(acToken({ ac: 16, dex: 0, rules: [acBonusRule(2), acOverrideRule({ ac: "@record.data.ac + 2" })] })),
  16,
);

// A bonus from a DIFFERENT effect than the writer still stacks on the baked base.
assert(
  "NPC writing bonus (baked 17) + separate cover +2 → 19",
  acOf(
    acToken({
      ac: 17,
      dex: 0,
      effectsList: [
        { name: "AC Bonus +2", rules: [acBonusRule(2), acDataRule("ac", "add", 2)] },
        { name: "Cover", rules: [acBonusRule(2)] },
      ],
    }),
  ),
  19,
);

// ── NPC plain modifiers (no AC-writing rule) — original behavior ─────────────
section("getArmorClassForToken — NPC plain modifiers");

assert("NPC ac 15, no effect → 15", acOf(acToken({ ac: 15, dex: 2 })), 15);

// A plain armorClassBonus (no data/override rule) raises AC above the field.
assert(
  "NPC ac 15 + plain bonus 2 → 17",
  acOf(acToken({ ac: 15, dex: 0, rules: [acBonusRule(2)] })),
  17,
);

// A plain armorClassPenalty (no data/override rule) is floored at data.ac — this
// is the original behavior: to lower an NPC's AC, the effect must write the
// field (bake data.ac), as the shipped "AC Penalty" effect does.
assert(
  "NPC ac 16 + plain penalty 3 → 16 (floored; penalty needs a data/override rule)",
  acOf(acToken({ ac: 16, dex: 0, rules: [acPenaltyRule(3)] })),
  16,
);

// Wild-shaped NPC short-circuits to its current AC.
assert(
  "wild-shaped NPC → flat ac",
  acOf(acToken({ ac: 14, dex: 0, wildShapeNpc: true, rules: [acBonusRule(5)] })),
  14,
);

// ── PCs are untouched: base is fresh, modifiers always apply ─────────────────
section("getArmorClassForToken — PC (modifiers never skipped)");

assert("PC unarmored dex 3 → 13", acOf(acToken({ recordType: "characters", dex: 3 })), 13);

assert(
  "PC unarmored dex 3 + bonus 2 → 15",
  acOf(acToken({ recordType: "characters", dex: 3, rules: [acBonusRule(2)] })),
  15,
);

const plate = (extra = {}) => ({ ac: 16, maxDex: 2, category: "heavy", ...extra });
assert(
  "PC plate 16 (maxDex 2), dex 4 → 18",
  acOf(acToken({ recordType: "characters", dex: 4, armor: plate() })),
  18,
);

// PC AC Bonus +2 (bonus + data add): base is fresh (16), modifier applies → 18,
// which equals the baked data.ac 18 — no double count for PCs.
assert(
  "PC AC Bonus +2: natural 16, baked 18 → 18 (no double count)",
  acOf(
    acToken({
      recordType: "characters",
      ac: 18,
      dex: 0,
      armor: plate({ maxDex: 0 }),
      rules: [acBonusRule(2), acDataRule("ac", "add", 2)],
    }),
  ),
  18,
);

// PC AC Penalty -2: base fresh 16, penalty applies → 14, matching baked data.ac.
assert(
  "PC AC Penalty -2: natural 16, baked 14 → 14",
  acOf(
    acToken({
      recordType: "characters",
      ac: 14,
      dex: 0,
      armor: plate({ maxDex: 0 }),
      rules: [acPenaltyRule(2), acDataRule("ac", "subtract", 2)],
    }),
  ),
  14,
);

// PC Mage Armor (override SETS ac, no matching modifier): only the baked field
// carries it, so the floor pulls the fresh 10 up to 15.
assert(
  "PC Mage Armor override set: natural 10, baked 15 → 15 (floor)",
  acOf(
    acToken({
      recordType: "characters",
      ac: 15,
      dex: 0,
      rules: [acOverrideRule({ ac: "13 + floor((@record.data.dexterity - 10) / 2)" })],
    }),
  ),
  15,
);

// ── Summary ──────────────────────────────────────────────────────────────────
if (summary() > 0) process.exit(1);
