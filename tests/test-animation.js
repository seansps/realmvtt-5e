#!/usr/bin/env node
// Tests for getAnimationFor — the fallback that guesses an animation from an
// attack's name, damage type, and range when the record has none configured.
//
// The bow matcher is the part with teeth: it used to test /\bbow\b/, which a
// one-word magic-item name like "Oathbow" never satisfies (there's no word
// boundary between "oath" and "bow"), so those weapons silently fell through to
// the generic arrow_2 instead of firing arrow_1.
//
// Run with: node tests/test-animation.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const { getAnimationFor } = ctx;

const rangedPiercing = (abilityName) =>
  getAnimationFor({ abilityName, damage: "1d8 piercing", isRanged: true })
    ?.animationName;

// ── Bow detection ────────────────────────────────────────────────────────────

section("getAnimationFor — plain bow names fire arrow_1");
["Bow", "Longbow", "Shortbow", "Crossbow"].forEach((n) =>
  assert(n, rangedPiercing(n), "arrow_1"),
);

section("getAnimationFor — compound and decorated bow names fire arrow_1");
[
  "Oathbow", // the reported bug: one word, no \b before "bow"
  "Greatbow",
  "Heavy Crossbow",
  "Hand Crossbow",
  "+1 Longbow",
  "Longbow of Warning",
  "Oathbow (Longbow)",
].forEach((n) => assert(n, rangedPiercing(n), "arrow_1"));

section("getAnimationFor — words merely ending in 'bow' are not bows");
assert("Elbow", rangedPiercing("Elbow"), "arrow_2");
assert("Elbow Strike", rangedPiercing("Elbow Strike"), "arrow_2");
assert("Rainbow Blast", rangedPiercing("Rainbow Blast"), "arrow_2");

section("getAnimationFor — other ranged piercing still falls back to arrow_2");
["Javelin", "Dart", "Sling Bullet"].forEach((n) =>
  assert(n, rangedPiercing(n), "arrow_2"),
);

section("getAnimationFor — melee piercing is unaffected by the bow matcher");
assert(
  "melee Oathbow",
  getAnimationFor({
    abilityName: "Oathbow",
    damage: "1d8 piercing",
    isRanged: false,
  })?.animationName,
  "pierce_1",
);
assert(
  "melee Dagger",
  getAnimationFor({
    abilityName: "Dagger",
    damage: "1d4 piercing",
    isRanged: false,
  })?.animationName,
  "pierce_1",
);

section("getAnimationFor — bow sound is arrow_1 regardless of the name match");
assert(
  "Oathbow sound",
  getAnimationFor({
    abilityName: "Oathbow",
    damage: "1d8 piercing",
    isRanged: true,
  })?.sound,
  "arrow_1",
);

// ── Regression guards on the surrounding branches ────────────────────────────

section("getAnimationFor — damage-type branches still win where they should");
assert(
  "ranged fire keeps fire_1",
  getAnimationFor({
    abilityName: "Flaming Bow",
    damage: "1d8 fire",
    isRanged: true,
  })?.animationName,
  "fire_1",
);
assert(
  "gun names still fire bullet_2",
  getAnimationFor({
    abilityName: "Sword pistol",
    damage: "1d8 piercing",
    isRanged: true,
  })?.animationName,
  "bullet_2",
);
assert(
  "ranged bludgeoning is bullet_1",
  getAnimationFor({
    abilityName: "Sling",
    damage: "1d4 bludgeoning",
    isRanged: true,
  })?.animationName,
  "bullet_1",
);

// ── Area shape drives delivery ───────────────────────────────────────────────
//
// Lightning Bolt is the reported bug: its range is "Self" (a 100-foot Line), so
// isRangedSpell reports false and the animation used to play parked on the
// caster instead of stretching down the line.

section("getAnimationFor — a line projects even when not ranged");
{
  const bolt = getAnimationFor({
    abilityName: "Lightning Bolt",
    damage: "8d6 lightning",
    isRanged: false,
    shape: "line",
  });
  assert(
    "line keeps the lightning animation",
    bolt.animationName,
    "lightning_1",
  );
  assert("line moves to destination", bolt.moveToDestination, true);
  assert("line stretches to destination", bolt.stretchToDestination, true);
  assert("line is not destination-only", bolt.destinationOnly, false);
}

// A cone reads fine as the melee/self variant of the animation, so it is
// deliberately NOT projected — only the Line shape overrides delivery.
section("getAnimationFor — cones keep the melee variant");
{
  const cone = getAnimationFor({
    abilityName: "Cone of Cold",
    damage: "8d8 cold",
    isRanged: false,
    shape: "cone",
  });
  assert("cone keeps the ice animation", cone.animationName, "ice_1");
  assert("cone does not travel", cone.moveToDestination, false);
  assert("cone does not stretch", cone.stretchToDestination, false);

  // A cone on a spell that IS a ranged attack still delivers as ranged.
  const rangedCone = getAnimationFor({
    abilityName: "Scorching Cone",
    damage: "4d6 fire",
    isRanged: true,
    shape: "cone",
  });
  assert("a ranged cone still travels", rangedCone.moveToDestination, true);
}

section("getAnimationFor — emanations stay centered on the caster");
{
  const wave = getAnimationFor({
    abilityName: "Thunderwave",
    damage: "2d8 thunder",
    isRanged: false,
    shape: "emanation",
  });
  assert("emanation does not travel", wave.moveToDestination, false);
  assert("emanation does not stretch", wave.stretchToDestination, false);
  assert("emanation starts at center", wave.startAtCenter, true);
}

section("getAnimationFor — no shape leaves melee delivery untouched");
{
  const melee = getAnimationFor({
    abilityName: "Longsword",
    damage: "1d8 slashing",
    isRanged: false,
  });
  assert("melee still does not travel", melee.moveToDestination, false);
  assert("melee still does not stretch", melee.stretchToDestination, false);
}

section("getAnimationFor — no name or no damage yields no animation");
assert("missing name", getAnimationFor({ abilityName: "" }), null);
assert(
  "no damage and no healing",
  getAnimationFor({ abilityName: "Oathbow", damage: "", isRanged: true }),
  null,
);

process.exit(summary());
