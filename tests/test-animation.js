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

// ---------------------------------------------------------------------------
// Damage-type vs weapon: the elemental branches run before the physical ones,
// and the tint-only types (poison/force/psychic) never set an animationName —
// so a bow dealing poison used to keep the "bolt_1" default and read as a green
// magic missile.
const anim = (abilityName, damage, isRanged = true) =>
  getAnimationFor({ abilityName, damage, isRanged })?.animationName;
const hue = (abilityName, damage, isRanged = true) =>
  getAnimationFor({ abilityName, damage, isRanged })?.hue;

section("a bow fires an arrow whatever damage it deals");
{
  assert("bow, poison only", anim("Shortbow", "2d6 poison"), "arrow_1");
  assert("bow, piercing + poison", anim("Shortbow", "1d6 piercing + 2d6 poison"), "arrow_1");
  assert("bow, force only", anim("Shortbow", "2d6 force"), "arrow_1");
  assert("bow, psychic only", anim("Shortbow", "2d6 psychic"), "arrow_1");
  assert("the poison tint survives", hue("Shortbow", "2d6 poison"), 128);
}

section("a damage type with its own animation still beats the bow fallback");
{
  // Only the untouched generic default is replaced. fire/cold/acid/lightning/
  // necrotic/radiant each supply an animation that already reads correctly.
  assert("bow, fire", anim("Flaming Bow", "1d8 fire"), "fire_1");
  assert("bow, necrotic", anim("Longbow", "2d6 necrotic"), "necrotic_1");
  assert("bow, cold", anim("Longbow", "2d6 cold"), "ice_1");
  assert("bow, no damage yields nothing", anim("Shortbow", ""), undefined);
}

section("a weapon with an elemental rider keeps its own animation");
{
  assert("longbow + lightning", anim("Longbow", "1d8 piercing + 1d6 lightning"), "arrow_1");
  assert("lightning tint applied", hue("Longbow", "1d8 piercing + 1d6 lightning"), 244);
  assert("maul + necrotic", anim("Maul", "2d6 bludgeoning + 1d6 necrotic", false), "bludgeon_1");
  assert("sword + fire", anim("Longsword", "1d8 slashing + 2d6 fire", false), "slash_1");
  assert("sling + acid", anim("Sling", "1d4 bludgeoning + 1d6 acid"), "bullet_1");
}

section("conjured arrow spells fire arrow_2, not a bow's arrow_1");
{
  assert("Melf's Acid Arrow", anim("Melf's Acid Arrow", "4d4 acid"), "arrow_2");
  assert("Acid Arrow", anim("Acid Arrow", "4d4 acid"), "arrow_2");
  assert("acid tint survives", hue("Melf's Acid Arrow", "4d4 acid"), 100);
  assert("melee is untouched", anim("Acid Arrow", "4d4 acid", false), "splash_1");
}

section("pure elemental effects are unchanged");
{
  assert("Poison Spray", anim("Poison Spray", "2d12 poison"), "bolt_1");
  assert("Fireball", anim("Fireball", "8d6 fire"), "fire_2");
  assert("Ray of Frost", anim("Ray of Frost", "1d8 cold"), "bolt_2");
  assert("Magic Missile", anim("Magic Missile", "3d4+3 force"), "orb_1");
  assert("Disintegrate keeps its hue override", hue("Disintegrate", "10d6 force"), 128);
}

section("plain physical weapons are unchanged");
{
  assert("Shortbow", anim("Shortbow", "1d6 piercing"), "arrow_1");
  assert("Oathbow", anim("Oathbow", "1d8 piercing"), "arrow_1");
  assert("Elbow Strike", anim("Elbow Strike", "1d4 piercing"), "arrow_2");
  assert("Rainbow Blast", anim("Rainbow Blast", "1d4 piercing"), "arrow_2");
  assert("melee dagger", anim("Dagger", "1d4 piercing", false), "pierce_1");
  assert("melee longsword", anim("Longsword", "1d8 slashing", false), "slash_1");
  assert("sling", anim("Sling", "1d4 bludgeoning"), "bullet_1");
}

process.exit(summary());

