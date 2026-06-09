// Tests for 5e rollhandlers/common.js
// Run: node tests/test-common.js   (or via tests/run-all.js)

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const {
  getProficiencyBonus,
  getClassLevel,
  resolveClassAlias,
  checkForReplacements,
  getTotalValueFromFields,
  evaluateSinglePredicate,
  getEffectsAndModifiersForToken,
  getMinRollModifier,
} = ctx;

section("getProficiencyBonus — 5e proficiency progression");
{
  assert("level 1 -> +2", getProficiencyBonus(1), 2);
  assert("level 4 -> +2", getProficiencyBonus(4), 2);
  assert("level 5 -> +3", getProficiencyBonus(5), 3);
  assert("level 9 -> +4", getProficiencyBonus(9), 4);
  assert("level 13 -> +5", getProficiencyBonus(13), 5);
  assert("level 17 -> +6", getProficiencyBonus(17), 6);
  assert("level 20 -> +6", getProficiencyBonus(20), 6);
}

section("Level Up → 5e class aliases (Adept→Monk, Herald→Paladin, Berserker→Barbarian)");
{
  const rec = { data: { classLevels: "Monk 5 / Paladin 3 / Barbarian 2", level: 10 } };
  assert("resolveClassAlias adept->monk", resolveClassAlias("Adept"), "monk");
  assert("resolveClassAlias herald->paladin", resolveClassAlias("HERALD"), "paladin");
  assert("resolveClassAlias berserker->barbarian", resolveClassAlias("berserker"), "barbarian");
  assert("unknown class passes through", resolveClassAlias("Fighter"), "fighter");
  assert("adeptLevel reads Monk level", getClassLevel(rec, "adeptLevel"), 5);
  assert("heraldLevel reads Paladin level", getClassLevel(rec, "heraldLevel"), 3);
  assert("berserkerLevel reads Barbarian level", getClassLevel(rec, "berserkerLevel"), 2);
  assert("monkLevel still direct", getClassLevel(rec, "monkLevel"), 5);
  assert("checkForReplacements {Adept Level}", checkForReplacements("{Adept Level}d6", {}, rec), "5d6");
  assert("checkForReplacements Half Berserker Level", checkForReplacements("Half Berserker Level", {}, rec), "1");
}

section("getTotalValueFromFields — uses-calc fields, multipliers, aliases");
{
  const rec = { data: { proficiencyBonus: "4", charismaMod: "3", classLevels: "Wizard 10 / Monk 4", wisdomMod: "2" } };
  assert("halfProficiencyBonus = floor(4/2)", getTotalValueFromFields(rec, ["halfProficiencyBonus"]), 2);
  assert("wisdomMod x2", getTotalValueFromFields(rec, ["wisdomMod", "times2"]), 4);
  assert("wisdomMod plus3", getTotalValueFromFields(rec, ["wisdomMod", "plus3"]), 5);
  assert("warlockSpellcastingMod = charismaMod (5e)", getTotalValueFromFields(rec, ["warlockSpellcastingMod"]), 3);
  assert("wizardLevel", getTotalValueFromFields(rec, ["wizardLevel"]), 10);
  assert("adeptLevel alias -> Monk 4", getTotalValueFromFields(rec, ["adeptLevel"]), 4);
  assert("min of 1 when empty", getTotalValueFromFields(rec, []), 1);
}

section("attacker:effect: / target:effect: predicates");
{
  const atk = {
    attackerToken: { effects: [{ name: "Look At Me! (Chosen Enemy)" }] },
  };
  const tgt = {
    targetToken: { effects: [{ name: "Look At Me! (Chosen Enemy)" }] },
  };
  assert(
    "attacker:effect true when attacker marked",
    evaluateSinglePredicate("attacker:effect:look-at-me-chosen-enemy", atk),
    true,
  );
  assert(
    "attacker:effect false with no context",
    evaluateSinglePredicate("attacker:effect:look-at-me-chosen-enemy", undefined),
    false,
  );
  assert(
    "target:effect true when target marked",
    evaluateSinglePredicate("target:effect:look-at-me-chosen-enemy", tgt),
    true,
  );
  assert(
    "target:effect false with no context",
    evaluateSinglePredicate("target:effect:look-at-me-chosen-enemy", undefined),
    false,
  );
  // source:<slug> — matches the spell/ability that forced the roll.
  assert(
    "source: matches the forcing ability name",
    evaluateSinglePredicate("source:imposing-glare", {
      sourceName: "Imposing Glare",
    }),
    true,
  );
  assert(
    "source: false with no context",
    evaluateSinglePredicate("source:imposing-glare", undefined),
    false,
  );
  assert(
    "target:effect false on slug mismatch",
    evaluateSinglePredicate("target:effect:wrong-slug", tgt),
    false,
  );
}

section("effect-rule predicate — object shape (e.g. {not: ...}) is gated");
{
  const mk = (senses) => ({
    data: { senses },
    effects: [
      {
        name: "E",
        rules: [
          {
            data: { predicate: { not: "self:senses:darkvision" } },
            type: "attackBonus",
            field: "all",
            value: "2",
            valueType: "number",
          },
        ],
      },
    ],
  });
  assert(
    "object predicate fails → rule inactive",
    getEffectsAndModifiersForToken(mk("Darkvision 60"), ["attackBonus"], "all")[0]
      ?.active,
    false,
  );
  assert(
    "object predicate passes → rule active",
    getEffectsAndModifiersForToken(mk(""), ["attackBonus"], "all")[0]?.active,
    true,
  );
}

section("getMinRollModifier — active gating");
assert("active minroll3 → 3", getMinRollModifier([{ value: "minroll3", active: true }]), 3);
assert("inactive minroll3 → null", getMinRollModifier([{ value: "minroll3", active: false }]), null);

process.exit(summary());