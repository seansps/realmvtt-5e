// Tests for 5e RIV (resistance / immunity / vulnerability) handling in
// rollhandlers/common.js — getRIV parsing plus the getDamageMacro damage math
// (resistance halves, immunity zeroes, vulnerability doubles, and the
// ignore-resistance / ignore-immunity bypass used by NPC actions & traits).
// Run: node tests/test-riv.js   (or via tests/run-all.js)

const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const { getRIV, getDamageMacro } = ctx;

// ---- getRIV parsing --------------------------------------------------------

section("getRIV — parses resistance / immunity / vulnerability strings");
{
  const riv = getRIV({
    data: { resistances: "Acid, Fire", immunities: "Poison", vulnerabilities: "Cold" },
  });
  assertIncludes("acid resistance parsed", riv.resistances, "acid");
  assertIncludes("fire resistance parsed", riv.resistances, "fire");
  assertIncludes("poison immunity parsed", riv.immunities, "poison");
  assertIncludes("cold vulnerability parsed", riv.vulnerabilities, "cold");
}

section("getRIV — 'BPS from nonmagical attacks' phrase expands (incl. silvered)");
{
  const riv = getRIV({
    data: { resistances: "bludgeoning, piercing, and slashing from nonmagical attacks" },
  });
  assertIncludes("bludgeoning", riv.resistances, "bludgeoning");
  assertIncludes("piercing", riv.resistances, "piercing");
  assertIncludes("slashing", riv.resistances, "slashing");
  assertIncludes("silveredslashing", riv.resistances, "silveredslashing");
}

// ---- getDamageMacro damage math --------------------------------------------

// Evaluate the generated Apply_Damage / Apply_Half_Damage macro against a dummy
// NPC (huge HP so it never drops / triggers death or concentration logic) and
// return how much damage it actually took. `rivStrings` are the target's
// resistances/immunities/vulnerabilities data fields.
function damageTaken(damageByType, options, rivStrings) {
  const macro = getDamageMacro("Apply_Damage", damageByType, options);
  // Strip the ```label ... ``` fences to get the runnable body.
  const body = macro.replace(/^```[^\n]*\n/, "").replace(/\n```$/, "");

  let captured = 1000;
  const target = {
    _id: "t1",
    recordType: "npcs",
    name: "Dummy",
    record: { name: "Dummy" },
    identified: true,
    data: { curhp: 1000, hitpoints: 1000, tempHp: 0, ...rivStrings },
    effects: [],
  };

  // Swap in a mock api for the duration of the eval; record=null + isGM so the
  // macro targets our dummy via getSelectedOrDroppedToken.
  ctx.api = {
    getSelectedOrDroppedToken: () => [target],
    getSelectedOwnedTokens: () => [],
    setValueOnToken: (t, path, val) => {
      if (path === "data.curhp") captured = val;
    },
    setValueOnTokenById: () => {},
    floatText: () => {},
    sendMessage: () => {},
    addEffect: () => {},
    addEffects: () => {},
    removeEffectById: () => {},
    editMessage: () => {},
    showNotification: () => {},
  };
  ctx.record = null;
  ctx.isGM = true;
  ctx.userId = "u1";

  new vm.Script(`(function(){\n${body}\n})();`, {
    filename: "apply-damage.js",
  }).runInContext(ctx);

  return 1000 - captured;
}

section("getDamageMacro — base RIV math");
{
  assert("no RIV → full damage", damageTaken({ acid: 20 }, {}, {}), 20);
  assert("resistance → half", damageTaken({ acid: 20 }, {}, { resistances: "acid" }), 10);
  assert("immunity → zero", damageTaken({ acid: 20 }, {}, { immunities: "acid" }), 0);
  assert(
    "vulnerability → double",
    damageTaken({ acid: 20 }, {}, { vulnerabilities: "acid" }),
    40,
  );
  assert(
    "RIV is type-scoped: fire resistance doesn't reduce acid damage",
    damageTaken({ acid: 20 }, {}, { resistances: "fire" }),
    20,
  );
}

section("getDamageMacro — ignore-resistance / ignore-immunity bypass");
{
  assert(
    "ignore resistance → full despite resistance",
    damageTaken({ acid: 20 }, { damageIgnoresResistances: ["acid"] }, { resistances: "acid" }),
    20,
  );
  assert(
    "ignore immunity → full despite immunity",
    damageTaken({ acid: 20 }, { damageIgnoresImmunities: ["acid"] }, { immunities: "acid" }),
    20,
  );
  assert(
    "ignore is type-scoped: ignoring acid doesn't bypass fire resistance",
    damageTaken({ fire: 20 }, { damageIgnoresResistances: ["acid"] }, { resistances: "fire" }),
    10,
  );
  assert(
    "mixed instance: acid resistance ignored (full) + fire resisted (half)",
    damageTaken(
      { acid: 20, fire: 20 },
      { damageIgnoresResistances: ["acid"] },
      { resistances: "acid, fire" },
    ),
    30,
  );
}

section("getDamageMacro — half damage (save for half) with RIV");
{
  assert("isHalf, no RIV → half", damageTaken({ acid: 20 }, { isHalf: true }, {}), 10);
  assert(
    "isHalf + resistance: floor(20/2)=10 then halved → 5",
    damageTaken({ acid: 20 }, { isHalf: true }, { resistances: "acid" }),
    5,
  );
  assert(
    "isHalf + immunity → 0",
    damageTaken({ acid: 20 }, { isHalf: true }, { immunities: "acid" }),
    0,
  );
}

process.exit(summary());
