#!/usr/bin/env node
// Tests for field scoping on getAttackModifiersForTarget.
//
// An `attackTargeting` modifier on a creature affects attacks made AGAINST it.
// Its field narrows which attacks:
//
//   ""       every attack
//   "melee"  melee attacks only
//   "ranged" ranged attacks only
//   "spell"  SPELL attacks only — "spell attacks against you have disadvantage"
//
// "spell" is not a melee/ranged axis (a spell attack can be either), so it is
// checked on its own and the melee/ranged filter does not apply to it.
//
// Run with: node tests/test-attack-targeting.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();

// Puts one attackTargeting modifier with the given field on the target, then
// asks whether it survives the filter for an attack described by `opts`.
function applies(field, opts = {}) {
  ctx.getEffectsAndModifiersForToken = () => [
    {
      name: "Prismatic Gown",
      value: "disadvantage",
      field,
      active: true,
      isEffect: false,
      modifierType: "attackTargeting",
    },
  ];
  const token = { _id: "target1", data: {}, record: {} };
  const res = ctx.getAttackModifiersForTarget(
    token,
    opts.distance ?? 30,
    { _id: "attacker1" },
    opts.isRanged,
    opts.isSpellAttack,
  );
  return res.length > 0;
}

section('field "spell" applies to spell attacks only');
{
  assert("ranged spell attack", applies("spell", { isSpellAttack: true, isRanged: true }), true);
  assert("melee spell attack", applies("spell", { isSpellAttack: true, isRanged: false }), true);
  assert("ranged weapon attack", applies("spell", { isSpellAttack: undefined, isRanged: true }), false);
  assert("melee weapon attack", applies("spell", { isSpellAttack: undefined, isRanged: false }), false);
  assert("explicitly false", applies("spell", { isSpellAttack: false, isRanged: true }), false);
}

section("an unscoped modifier still applies to everything");
{
  assert("spell attack", applies("", { isSpellAttack: true, isRanged: true }), true);
  assert("weapon attack", applies("", { isSpellAttack: undefined, isRanged: true }), true);
  assert("melee weapon attack", applies("", { isSpellAttack: undefined, isRanged: false }), true);
}

section("melee/ranged scoping is unchanged");
{
  assert("melee excluded from a ranged attack", applies("melee", { isRanged: true }), false);
  assert("melee on a melee attack", applies("melee", { isRanged: false }), true);
  assert("ranged on a ranged attack", applies("ranged", { isRanged: true }), true);
  assert("ranged excluded from a melee attack", applies("ranged", { isRanged: false }), false);
  // Undefined isRanged means the caller didn't say — no melee/ranged filtering.
  assert("melee with no range context", applies("melee", {}), true);
  assert("ranged with no range context", applies("ranged", {}), true);
}

section("the spell flag does not leak into melee/ranged scoping");
{
  // A melee-scoped modifier on a MELEE spell attack still applies: it is scoped
  // by weapon axis, not by whether the attack is magical.
  assert("melee field, melee spell attack", applies("melee", { isRanged: false, isSpellAttack: true }), true);
  assert("melee field, ranged spell attack", applies("melee", { isRanged: true, isSpellAttack: true }), false);
  assert("ranged field, ranged spell attack", applies("ranged", { isRanged: true, isSpellAttack: true }), true);
}

section("field matching is case-insensitive");
{
  assert("Spell", applies("Spell", { isSpellAttack: true, isRanged: true }), true);
  assert("SPELL on a weapon attack", applies("SPELL", { isRanged: true }), false);
}

process.exit(summary());
