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

  // HP-derived pseudo-conditions: bloodied/wounded resolve from the target's
  // current/max HP even when no matching effect token is present.
  const tgtHalf = {
    targetToken: { effects: [], data: { curhp: 10, hitpoints: 20 } },
  };
  const tgtFull = {
    targetToken: { effects: [], data: { curhp: 20, hitpoints: 20 } },
  };
  const tgtScratch = {
    targetToken: { effects: [], data: { curhp: 19, hitpoints: 20 } },
  };
  const tgtDown = {
    targetToken: { effects: [], data: { curhp: 0, hitpoints: 20 } },
  };
  assert(
    "target:effect:bloodied true at half HP with no effect",
    evaluateSinglePredicate("target:effect:bloodied", tgtHalf),
    true,
  );
  assert(
    "target:effect:bloodied false at full HP",
    evaluateSinglePredicate("target:effect:bloodied", tgtFull),
    false,
  );
  assert(
    "target:effect:bloodied false when downed (0 HP)",
    evaluateSinglePredicate("target:effect:bloodied", tgtDown),
    false,
  );
  assert(
    "target:effect:wounded true when missing any HP",
    evaluateSinglePredicate("target:effect:wounded", tgtScratch),
    true,
  );
  assert(
    "target:effect:wounded false at full HP",
    evaluateSinglePredicate("target:effect:wounded", tgtFull),
    false,
  );
  assert(
    "target:effect:wounded true when downed (missing HP)",
    evaluateSinglePredicate("target:effect:wounded", tgtDown),
    true,
  );
  assert(
    "target:effect:bloodied true via applied effect when no HP data",
    evaluateSinglePredicate("target:effect:bloodied", {
      targetToken: { effects: [{ name: "Bloodied" }] },
    }),
    true,
  );
  assert(
    "attacker:effect:wounded true when attacker missing HP",
    evaluateSinglePredicate("attacker:effect:wounded", {
      attackerToken: { effects: [], data: { curhp: 5, hitpoints: 20 } },
    }),
    true,
  );

  // spell:<slug> — matches the cast spell's NAME (in addition to school/lists/tags).
  assert(
    "spell:<slug> matches the cast spell name",
    evaluateSinglePredicate("spell:call-lightning", {
      spellName: "Call Lightning",
    }),
    true,
  );
  assert(
    "spell:<slug> false on a different spell name",
    evaluateSinglePredicate("spell:call-lightning", { spellName: "Fireball" }),
    false,
  );

  // attacker:creature_type:<type> — gates a defender's attackTargeting effect to
  // the attacker's creature type; parentheticals count as their own types.
  const feyHagAtk = { attackerToken: { data: { creatureType: "Fey (Hag)" } } };
  assert(
    "attacker:creature_type matches base type",
    evaluateSinglePredicate("attacker:creature_type:fey", feyHagAtk),
    true,
  );
  assert(
    "attacker:creature_type matches parenthetical sub-type",
    evaluateSinglePredicate("attacker:creature_type:hag", feyHagAtk),
    true,
  );
  assert(
    "attacker:creature_type false with no context",
    evaluateSinglePredicate("attacker:creature_type:fey", undefined),
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

  // @record.data references inside a predicate resolve to the stored value
  // (e.g. a choiceSet-picked weapon) so "weapon:type:@record..." matches it.
  const refRec = {
    data: { effectChoices: { magicWeapon: { weapon: "Longsword" } } },
  };
  const refLongsword = {
    weapon: { data: { weaponType: "Longsword", weaponProperties: [] } },
  };
  assert(
    "@record predicate ref matches the chosen weapon type",
    evaluateSinglePredicate(
      "weapon:type:@record.data.effectChoices.magicWeapon.weapon",
      refLongsword,
      null,
      refRec,
    ),
    true,
  );
  assert(
    "@record predicate ref to an object container does not throw / match",
    evaluateSinglePredicate(
      "weapon:type:@record.data.effectChoices.magicWeapon",
      refLongsword,
      null,
      refRec,
    ),
    false,
  );
}

section("getEffectsAndModifiersForToken — skips Realm effect rule types");
{
  // An "input" rule's value is an object {prompt, placeholder, ...}; treating it
  // as a modifier value used to crash with "d.trim is not a function".
  const rec = {
    data: {},
    effects: [
      {
        name: "Spell Effect: Magic Weapon",
        rules: [
          {
            type: "input",
            valueType: "string",
            field: "data.effectChoices.magicWeapon.weapon",
            value: { prompt: "Enter the weapon name", placeholder: "e.g. Longsword" },
          },
          { type: "attackBonus", valueType: "number", field: "all", value: "1" },
        ],
      },
    ],
    effectIds: [],
    effectValues: {},
  };
  let threw = false;
  let res = [];
  try {
    res = getEffectsAndModifiersForToken(rec, ["attackBonus"], "all");
  } catch (e) {
    threw = true;
  }
  assert("input rule does not crash collection", threw, false);
  assert("attackBonus rule still collected", res.length, 1);
  assert(
    "input rule not returned as a modifier",
    res.some((m) => m.modifierType === "input"),
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