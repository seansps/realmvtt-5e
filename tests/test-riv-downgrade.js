#!/usr/bin/env node
// Tests for the resistance re-rank fields on getRIV.
//
// A `resistance` rule whose FIELD is "upgrade" or "downgrade" does not grant a
// defense — it re-ranks one the creature already has:
//   upgrade    resistance -> immunity   (or grants the resistance if it has none)
//   downgrade  immunity   -> resistance (or strips the resistance outright)
//
// Written for effect rules — e.g. an orb that shatters on a creature and knocks
// one of its defenses down a step for 1d6+1 rounds, with the damage type chosen
// by an Input and referenced as @record.data.effectChoices.downgrade.
//
// Run with: node tests/test-riv-downgrade.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();

// getRIV pulls rules via getEffectsAndModifiersForToken; stub it so each case
// can state exactly which rules are on the creature.
function riv(base, mods) {
  ctx.getEffectsAndModifiersForToken = (token, types) =>
    mods.filter((m) => types.includes(m.modifierType));
  return ctx.getRIV({ data: { ...base } }, false, false, false);
}

// A resistance rule with the given field.
const rule = (field, value) => ({
  modifierType: "resistance",
  valueType: "string",
  value,
  field,
  active: true,
});

section("downgrade — immunity drops to resistance");
{
  const r = riv({ immunities: "fire, cold" }, [rule("downgrade", "fire")]);
  assert("fire is no longer an immunity", r.immunities.includes("fire"), false);
  assert("fire is now a resistance", r.resistances.includes("fire"), true);
  assert("cold immunity is untouched", r.immunities.includes("cold"), true);
}

section("downgrade — a plain resistance is lost outright");
{
  const r = riv({ resistances: "fire, cold" }, [rule("downgrade", "fire")]);
  assert("fire resistance is gone", r.resistances.includes("fire"), false);
  assert("and was not promoted", r.immunities.includes("fire"), false);
  assert("cold resistance is untouched", r.resistances.includes("cold"), true);
}

section("downgrade — a creature with neither is unaffected");
{
  const r = riv({ resistances: "cold" }, [rule("downgrade", "fire")]);
  assert("no fire resistance appears", r.resistances.includes("fire"), false);
  assert("no fire immunity appears", r.immunities.includes("fire"), false);
}

section("downgrade — sees defenses granted by other rules, not just the sheet");
{
  // The grant is listed BEFORE the downgrade here, but ordering must not matter:
  // re-ranks run in a second pass after every grant is collected.
  const r = riv({}, [rule("", "fire"), rule("downgrade", "fire")]);
  assert("granted, then stripped", r.resistances.includes("fire"), false);
  const flipped = riv({}, [rule("downgrade", "fire"), rule("", "fire")]);
  assert("same when listed first", flipped.resistances.includes("fire"), false);
}

section("downgrade — clears every copy, from the sheet and from rules");
{
  const r = riv({ resistances: "fire" }, [rule("", "fire"), rule("downgrade", "fire")]);
  assert("no fire left", r.resistances.filter((x) => x === "fire").length, 0);
}

section("downgrade — an unresolved Input reference is ignored");
{
  // Nothing chosen yet: checkForReplacements leaves the @record.data path in
  // place, and it must not be treated as a damage type.
  const r = riv({ immunities: "fire" }, [
    rule("downgrade", "@record.data.effectChoices.downgrade"),
  ]);
  assert("immunity survives", r.immunities.includes("fire"), true);
  assert("no path-shaped resistance", r.resistances.some((x) => x.includes("@")), false);
}

section("upgrade — still promotes, and still grants when there is nothing to promote");
{
  const promoted = riv({ resistances: "fire" }, [rule("upgrade", "fire")]);
  assert("resistance became immunity", promoted.immunities.includes("fire"), true);
  assert("and left resistances", promoted.resistances.includes("fire"), false);
  const granted = riv({}, [rule("upgrade", "fire")]);
  assert("grants a resistance instead", granted.resistances.includes("fire"), true);
}

section("upgrade — now sees a resistance granted by another rule");
{
  const r = riv({}, [rule("", "fire"), rule("upgrade", "fire")]);
  assert("granted then upgraded", r.immunities.includes("fire"), true);
}

section("downgrade is applied after upgrade");
{
  const r = riv({ resistances: "fire" }, [
    rule("upgrade", "fire"),
    rule("downgrade", "fire"),
  ]);
  assert("nets out as a resistance", r.resistances.includes("fire"), true);
  assert("not an immunity", r.immunities.includes("fire"), false);
}

section("re-rank rules never grant the type as a side effect");
{
  const r = riv({}, [rule("downgrade", "fire")]);
  assert("no resistance granted", r.resistances.includes("fire"), false);
  assert("no immunity granted", r.immunities.includes("fire"), false);
}

process.exit(summary());
