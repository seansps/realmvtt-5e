// Tests for 5e rollhandlers/feature-utils.js (pure helpers)
// Run: node tests/test-feature-utils.js   (or via tests/run-all.js)

const { createSandbox, loadScript } = require("./sandbox");
const {
  assert,
  assertIncludes,
  assertNotIncludes,
  section,
  summary,
} = require("./test-helpers");

const ctx = createSandbox();
loadScript(ctx, "feature-utils.js");

const {
  getTotalLevel,
  guessAbility,
  parseToolProficiencyChoices,
  mergeCommaSeparated,
  mergeWeaponProficiencies,
  resolveModifierValue,
  resolveSkillCheckAbility,
} = ctx;

section("getTotalLevel — sums class levels from a classLevels string");
{
  assert("single class", getTotalLevel("Fighter 5"), 5);
  assert("multiclass", getTotalLevel("Fighter 5 / Wizard 3"), 8);
  assert("empty", getTotalLevel(""), 0);
}

section("guessAbility — 5e (2024) tool-to-ability mapping");
{
  assert("Thieves' Tools -> dexterity", guessAbility("Thieves' Tools"), "dexterity");
  assert("Smith's Tools -> strength", guessAbility("Smith's Tools"), "strength");
  assert("Alchemist's Supplies -> intelligence", guessAbility("Alchemist's Supplies"), "intelligence");
  assert("Herbalism Kit -> intelligence", guessAbility("Herbalism Kit"), "intelligence");
  assert("Disguise Kit -> charisma", guessAbility("Disguise Kit"), "charisma");
  assert("Navigator's Tools -> wisdom", guessAbility("Navigator's Tools"), "wisdom");
}

section("parseToolProficiencyChoices — artisan category expands to the artisan list");
{
  const result = parseToolProficiencyChoices(
    "Choose one type of artisan's tools",
    [],
  );
  assert("returns a result", result !== null, true);
  if (result) {
    assert("numChoices = 1", result.numChoices, 1);
    assertIncludes("includes Alchemist's Supplies", result.options, "Alchemist's Supplies");
    assertIncludes("includes Smith's Tools", result.options, "Smith's Tools");
    assertNotIncludes("excludes Thieves' Tools (not an artisan tool)", result.options, "Thieves' Tools");
  }
}

section("mergeCommaSeparated — dedupes and appends");
{
  assert("appends new", mergeCommaSeparated("Common", "Elvish"), "Common, Elvish");
  assert("dedupes existing", mergeCommaSeparated("Common, Elvish", "Elvish"), "Common, Elvish");
  assert("from empty", mergeCommaSeparated("", "Dwarvish"), "Dwarvish");
}

section("mergeWeaponProficiencies — full category supersedes its limited form");
{
  assert(
    "full Martial replaces the Finesse/Light limited form",
    mergeWeaponProficiencies(
      "Simple weapons and Martial weapons that have the Finesse or Light property",
      "Martial weapons",
    ),
    "Simple Weapons, Martial Weapons",
  );
  assert(
    "adding the limited form when full already present is a no-op",
    mergeWeaponProficiencies(
      "Martial Weapons",
      "Martial weapons that have the Finesse or Light property",
    ),
    "Martial Weapons",
  );
  assert(
    "two simple categories normalize + join",
    mergeWeaponProficiencies("Simple weapons", "Martial weapons"),
    "Simple Weapons, Martial Weapons",
  );
  assert(
    "specific weapons are preserved and deduped",
    mergeWeaponProficiencies("Simple weapons, Longswords", "Shortswords"),
    "Simple Weapons, Longswords, Shortswords",
  );
}

section("resolveModifierValue — number/string/field value types");
{
  const rec = { data: { proficiencyBonus: "3", level: "5" } };
  assert("number type", resolveModifierValue({ data: { valueType: "number", value: "4" } }, rec), 4);
  assert("field type reads from record", resolveModifierValue({ data: { valueType: "field", value: "proficiencyBonus" } }, rec), 3);
}

section("resolveSkillCheckAbility — effect-driven skill ability override (use if higher)");
{
  const mkRec = (overrides) => ({
    data: {
      strengthMod: "1",
      intelligenceMod: "5",
      classes: [{ data: { spellcastingAbility: "intelligence" } }],
      ...overrides,
    },
    effects: [
      {
        name: "Mighty Magic",
        rules: [
          {
            type: "skillAbility",
            field: "athletics",
            value: "Spellcasting Ability",
            valueType: "string",
            data: {},
          },
        ],
      },
    ],
  });

  // Spellcasting ability (INT +5) beats configured Strength (+1) → swap.
  let r = resolveSkillCheckAbility(mkRec(), "athletics", "strength", 1);
  assert("sentinel → intelligence", r.ability, "intelligence");
  assert("sentinel mod → 5", r.abilityMod, 5);

  // Strength higher than spellcasting → keep base.
  r = resolveSkillCheckAbility(mkRec({ strengthMod: "6" }), "athletics", "strength", 6);
  assert("keeps strength when higher", r.ability, "strength");
  assert("keeps mod 6", r.abilityMod, 6);

  // Scoped to athletics — unrelated skill untouched.
  r = resolveSkillCheckAbility(mkRec(), "stealth", "dexterity", 2);
  assert("unrelated skill untouched", r.ability, "dexterity");

  // Literal ability value.
  const litRec = {
    data: { strengthMod: "1", dexterityMod: "4" },
    effects: [
      {
        name: "Cat's Grace",
        rules: [
          { type: "skillAbility", field: "athletics", value: "dexterity", valueType: "string", data: {} },
        ],
      },
    ],
  };
  r = resolveSkillCheckAbility(litRec, "athletics", "strength", 1);
  assert("literal dexterity wins", r.ability, "dexterity");
  assert("literal mod 4", r.abilityMod, 4);
}

section("providesItems level gating — class level for class/subclass features");
{
  const { _classNameForSource, _providesItemsLevel } = ctx;
  const multi = {
    data: {
      level: 8,
      classLevels: "Fighter 5 / Cleric 3",
      classes: [{ name: "Fighter" }, { name: "Cleric" }],
      subclasses: [{ name: "Life Domain", data: { class: "Cleric" } }],
    },
  };
  assert("class source maps to itself", _classNameForSource("Cleric", multi), "Cleric");
  assert("subclass source maps to parent", _classNameForSource("Life Domain", multi), "Cleric");
  assert("species source has no class", _classNameForSource("Elf", multi), "");
  assert("empty source has no class", _classNameForSource("", multi), "");

  assert(
    "subclass feature uses Cleric level, not total",
    _providesItemsLevel({ data: { source: "Life Domain" } }, multi),
    3,
  );
  assert(
    "class feature uses its class level",
    _providesItemsLevel({ data: { source: "Fighter" } }, multi),
    5,
  );
  assert(
    "explicit class name overrides source",
    _providesItemsLevel(null, multi, "Cleric"),
    3,
  );
  assert(
    "non-class feature uses total level",
    _providesItemsLevel({ data: { source: "Sage" } }, multi),
    8,
  );
  assert(
    "unknown class level falls back to total",
    _providesItemsLevel(null, { data: { level: 4, classLevels: "" } }, "Wizard"),
    4,
  );
  assert("missing record defaults to level 1", _providesItemsLevel(null, {}), 1);
}

section("skillExpertise choice — proficient skills only, sets 5e Expertise");
{
  const runExpertise = (charData, pick) => {
    const c = createSandbox();
    loadScript(c, "feature-utils.js");
    const charRec = { _id: "pc1", recordType: "characters", data: charData };
    const writes = [];
    const seen = { prompted: false, options: [], notified: false };
    c.api.getRecord = (_t, _id, cb) => cb(charRec);
    c.api.setValues = (fields, cb) => {
      writes.push(fields);
      if (cb) cb(charRec);
    };
    c.api.showNotification = () => {
      seen.notified = true;
    };
    c.api.showPrompt = (_n, _l, _t, options, _q, cb) => {
      seen.prompted = true;
      seen.options = options.map((o) => o.value);
      cb(pick);
    };
    let done = false;
    c.promptForChoices(
      charRec,
      [
        {
          feature: { name: "Expertise", data: { level: 1 } },
          featureName: "Expertise",
          sourceName: "Rogue",
          dataPath: "data.classes.0.data.feature_list.0",
          choiceObj: { data: { choiceType: "skillExpertise", count: 2 } },
          choiceIndex: 0,
        },
      ],
      0,
      () => {
        done = true;
      },
    );
    const merged = Object.assign({}, ...writes);
    return { seen, merged, done };
  };

  const base = {
    proficiencyBonus: 2,
    dexterityMod: 3,
    stealthProf: "true",
    sleightOfHandProf: "true",
    athleticsProf: "expertise",
    perceptionProf: "false",
  };
  const r = runExpertise(base, ["stealth", "sleightOfHand"]);
  assert("prompt shown", r.seen.prompted, true);
  assert(
    "only proficient, non-expertise skills offered",
    JSON.stringify(r.seen.options.slice().sort()),
    JSON.stringify(["sleightOfHand", "stealth"]),
  );
  assert("stealth set to expertise", r.merged["data.stealthProf"], "expertise");
  assert("stealth mod = dex 3 + 2x PB 2", r.merged["data.stealthMod"], 7);
  assert(
    "sleight of hand set to expertise",
    r.merged["data.sleightOfHandProf"],
    "expertise",
  );
  const featureWrite = r.merged["data.features"] || [];
  assert(
    "no expertiseDie modifier added",
    JSON.stringify(featureWrite).includes("expertiseDie"),
    false,
  );
  assert("choice flow continues", r.done, true);

  const none = runExpertise({ proficiencyBonus: 2 }, []);
  assert("no proficient skills: no prompt", none.seen.prompted, false);
  assert("no proficient skills: player notified", none.seen.notified, true);
  assert("no proficient skills: flow continues", none.done, true);
}

section("levelByClass — per-class levels for effect expressions");
{
  const { getLevelByClass, levelByClassNeedsSync } = ctx;
  assert(
    "multiclass string parsed",
    JSON.stringify(getLevelByClass("Fighter 5 / Paladin 18")),
    JSON.stringify({ Fighter: 5, Paladin: 18 }),
  );
  assert("empty string → {}", JSON.stringify(getLevelByClass("")), "{}");
  assert(
    "missing levelByClass needs sync",
    levelByClassNeedsSync({ data: { classLevels: "Paladin 6" } }),
    true,
  );
  assert(
    "matching levelByClass is in sync",
    levelByClassNeedsSync({ data: { classLevels: "Paladin 6", levelByClass: { Paladin: 6 } } }),
    false,
  );
  assert(
    "stale level needs sync",
    levelByClassNeedsSync({ data: { classLevels: "Paladin 7", levelByClass: { Paladin: 6 } } }),
    true,
  );
  assert(
    "removed class needs sync",
    levelByClassNeedsSync({ data: { classLevels: "Paladin 7", levelByClass: { Paladin: 7, Fighter: 1 } } }),
    true,
  );
  assert("no classes, no field → in sync", levelByClassNeedsSync({ data: {} }), false);
}

section("ASI prompts — each ability once, repeats allowed");
{
  const capture = (abilityScores, firstPick) => {
    const c = createSandbox();
    loadScript(c, "feature-utils.js");
    const prompts = [];
    c.api.showPrompt = (...args) => {
      prompts.push(args);
      // Answer the first prompt (Feat-or-ASI) when asked; leave the rest open.
      if (prompts.length === 1 && firstPick) args[5]([firstPick]);
    };
    c.promptAbilityScoreIncrease(
      { name: "ASI", data: { abilityScores } },
      { _id: "pc1", recordType: "characters", data: {} },
      () => {},
    );
    return prompts;
  };
  const SIX = JSON.stringify([
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
  ]);

  const feat = capture(
    "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1. This feat can’t increase an ability score above 20.",
  );
  const fp = feat[0];
  assert("feat ASI: six options, no duplicates", JSON.stringify(fp[3].map((o) => o.value)), SIX);
  assert("feat ASI: two picks", fp[8], 2);
  assert("feat ASI: allowRepeats on", fp[9], true);

  const choice = capture("Choice of Feat or ASI", "asi");
  const cp = choice[1];
  assert("feat-or-ASI → ASI: six options", JSON.stringify(cp[3].map((o) => o.value)), SIX);
  assert("feat-or-ASI → ASI: two picks", cp[8], 2);
  assert("feat-or-ASI → ASI: allowRepeats on", cp[9], true);
}

process.exit(summary());