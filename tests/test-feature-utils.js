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

process.exit(summary());