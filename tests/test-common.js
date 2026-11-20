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

section("class feature macros");
{
  const group = (name, spent, max) => ({ name, data: { dailyUses: spent, maxDailyUses: max } });
  const mk = (data) => ({ _id: "pc1", name: "Hero", recordType: "characters", data });
  const harness = (rec, picks = []) => {
    const c = createSandbox();
    const writes = [];
    const msgs = [];
    const prompts = [];
    c.api.getSelectedOrDroppedToken = () => [rec];
    c.api.setValuesOnRecord = (_r, v) => writes.push(v);
    c.api.sendMessage = (m) => msgs.push(m);
    c.api.showNotification = (m) => msgs.push("NOTE:" + m);
    c.api.showPrompt = (_n, _l, _t, options, _q, cb) => {
      prompts.push(options.map((o) => o.value));
      const pick = picks.shift();
      if (pick !== undefined) cb([pick]);
    };
    return { c, writes, msgs, prompts, merged: () => Object.assign({}, ...writes) };
  };

  // Font of Magic options
  {
    const rec = mk({
      levelByClass: { Sorcerer: 5 },
      abilityGroups: [group("Sorcery Points", 1, 5)],
      numSpellSlots1: 4, spellSlots1: 2, numSpellSlots2: 3, spellSlots2: 0, numSpellSlots3: 2, spellSlots3: 1,
    });
    const { c } = harness(rec);
    const o = c.fontOfMagicOptions(rec);
    assert("FoM: can create only level 1 (L3 costs 5 > 4 available)", JSON.stringify(o.createSlot.map((x) => x.value)), JSON.stringify(["1"]));
    assert("FoM: can expend unspent slots for points", JSON.stringify(o.gainPoints.map((x) => x.value)), JSON.stringify(["1", "2", "3"]));
  }
  // Font of Magic: create a level 1 slot
  {
    const rec = mk({ levelByClass: { Sorcerer: 5 }, abilityGroups: [group("Sorcery Points", 1, 5)], numSpellSlots1: 4, spellSlots1: 2 });
    const h = harness(rec, ["slot", "1"]);
    h.c.fontOfMagicMacro();
    const m = h.merged();
    assert("FoM create: spends 2 points", m["data.abilityGroups.0.data.dailyUses"], 3);
    assert("FoM create: recovers one level 1 slot", m["data.spellSlots1"], 1);
  }
  // Slot recovery choices
  {
    const rec = mk({ numSpellSlots1: 4, spellSlots1: 2, numSpellSlots2: 3, spellSlots2: 1, numSpellSlots3: 2, spellSlots3: 1, numSpellSlots6: 1, spellSlots6: 1 });
    const { c } = harness(rec);
    assert("recovery: budget 3 offers 1-3", JSON.stringify(c.slotRecoveryChoices(rec, 3, []).levels), JSON.stringify([1, 2, 3]));
    assert("recovery: after a level 2 pick only level 1 fits", JSON.stringify(c.slotRecoveryChoices(rec, 3, [2]).levels), JSON.stringify([1]));
    assert("recovery: never offers level 6+", c.slotRecoveryChoices(rec, 9, []).levels.includes(6), false);
  }
  // Arcane Recovery end to end: Wizard 3 → budget 2 → two level 1 slots
  {
    const rec = mk({ levelByClass: { Wizard: 3 }, abilityGroups: [group("Arcane Recovery", 0, 1)], numSpellSlots1: 4, spellSlots1: 3 });
    const h = harness(rec, ["1", "1"]);
    h.c.arcaneRecoveryMacro();
    const m = h.merged();
    assert("Arcane Recovery: recovers 2 level 1 slots", m["data.spellSlots1"], 1);
    assert("Arcane Recovery: uses its once-per-rest charge", m["data.abilityGroups.0.data.dailyUses"], 1);
  }
  // Arcane Recovery blocked once used
  {
    const rec = mk({ levelByClass: { Wizard: 3 }, abilityGroups: [group("Arcane Recovery", 1, 1)], numSpellSlots1: 4, spellSlots1: 3 });
    const h = harness(rec, ["1"]);
    h.c.arcaneRecoveryMacro();
    assert("Arcane Recovery: no writes when already used", h.writes.length, 0);
  }
  // Sorcerous Restoration
  {
    const rec = mk({ levelByClass: { Sorcerer: 7 }, abilityGroups: [group("Sorcery Points", 6, 7), group("Sorcerous Restoration", 0, 1)] });
    const h = harness(rec);
    h.c.sorcerousRestorationMacro();
    const m = h.merged();
    assert("Sorcerous Restoration: regains floor(7/2)=3", m["data.abilityGroups.0.data.dailyUses"], 3);
    assert("Sorcerous Restoration: spends its use", m["data.abilityGroups.1.data.dailyUses"], 1);
  }
  // Magical Cunning
  {
    const rec5 = mk({ levelByClass: { Warlock: 5 }, numPactMagic3: 2, pactMagic3: 2 });
    const rec20 = mk({ levelByClass: { Warlock: 20 }, numPactMagic5: 4, pactMagic5: 4 });
    const { c } = harness(rec5);
    assert("Magical Cunning: half (rounded up) of 2", c.magicalCunningPlan(rec5).regain, 1);
    assert("Magical Cunning: all slots at Warlock 20", c.magicalCunningPlan(rec20).regain, 4);
  }
  // Wild Resurgence: no Wild Shape uses left → expend a slot
  {
    const rec = mk({ abilityGroups: [group("Wild Shape", 2, 2), group("Wild Resurgence", 0, 1)], numSpellSlots2: 3, spellSlots2: 0 });
    const h = harness(rec, ["slot:2"]);
    h.c.wildResurgenceMacro();
    const m = h.merged();
    assert("Wild Resurgence: regains a Wild Shape use", m["data.abilityGroups.0.data.dailyUses"], 1);
    assert("Wild Resurgence: expends the level 2 slot", m["data.spellSlots2"], 1);
  }
  // Grapple card
  {
    const rec = mk({ strengthMod: 3, proficiencyBonus: 2 });
    const h = harness(rec);
    h.c.unarmedStrikeOptionMacro("grapple");
    const msg = h.msgs.join("\n");
    assert("Grapple: DC 13 shown", msg.includes("DC 13"), true);
    assert("Grapple: Strength save button", msg.includes("rollSavingThrow('strength', 13"), true);
    assert("Grapple: Dexterity save button", msg.includes("rollSavingThrow('dexterity', 13"), true);
    assert("Grapple: applies Grappled", msg.includes('api.addEffect("Grappled"'), true);
  }
  // macroButtonHtml round trip
  {
    const { c } = harness(mk({}));
    const html = c.macroButtonHtml("Grapple", 'unarmedStrikeOptionMacro("grapple");');
    const attr = html.match(/recordlink="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const parsed = JSON.parse(attr);
    assert("macro link: type macro", parsed.value.type, "macro");
    assert("macro link: code preserved", parsed.value.code, 'unarmedStrikeOptionMacro("grapple");');
  }
}

section("getMinRollModifier — active gating");
assert("active minroll3 → 3", getMinRollModifier([{ value: "minroll3", active: true }]), 3);
assert("inactive minroll3 → null", getMinRollModifier([{ value: "minroll3", active: false }]), null);

section("getEffectsAndModifiersForToken — non-array features/effects (REALMVTT-FRONTEND-2J4/2J5)");
{
  // Malformed stored data: a Mongo $set onto a missing array path leaves an
  // object with numeric keys. `|| []` let it through and `.map` threw
  // "c.map is not a function" on every NPC attack/damage roll at that target.
  const target = {
    data: {
      features: { 0: { name: "Darkvision", data: { modifiers: [] } } },
      inventory: [],
    },
    effects: { 0: { name: "Blessed", rules: [] } },
    effectIds: [],
    effectValues: {},
  };
  let threw = null;
  let res;
  try {
    res = getEffectsAndModifiersForToken(target, ["armorClass"], "");
  } catch (e) {
    threw = e.message;
  }
  assert("object-shaped features/effects do not throw", threw, null);
  assert("returns an empty modifier list", Array.isArray(res) && res.length, 0);
}

process.exit(summary());