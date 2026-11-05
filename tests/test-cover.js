#!/usr/bin/env node
// Tests for getCoverAttackModifier: cover detected from the map (api.getCover)
// and from creatures in the way, per the 5e cover rules.
//
//   - Walls and creatures both count; only the most protective degree applies.
//   - A creature gives at most three-quarters cover, never total.
//   - The modifier is -2 / -5 on the attack and starts toggled off.
//   - Total cover adds no modifier, only the notice.
//   - A target with an effect named "Cover ..." is skipped (GM applied it).
//   - The floating notice is behind the "coverNotice" campaign setting.
//
// Run with: node tests/test-cover.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const attacker = { _id: "attacker1", data: {}, effects: [] };
const target = (effects = []) => ({ _id: "target1", data: {}, effects });

let floats = [];
ctx.api.floatText = (token, text) => floats.push(text);
let setting = null;
ctx.api.getSetting = (key) => (key === "coverNotice" ? setting : null);

function run(cover, opts = {}) {
  floats = [];
  setting = opts.setting ?? null;
  ctx.api.getCover = () => cover;
  return ctx.getCoverAttackModifier(attacker, opts.target || target());
}

const wall = (degree) => ({ degree, creatures: [] });
const creature = (blockedFraction, name = "Goblin") => ({ name, blockedFraction });

section("walls");
{
  assert("no cover -> null", run(wall("none")), null);
  assert("no float with no cover", floats.length, 0);
  const half = run(wall("standard"));
  assert("half cover value", half.value, -2);
  assert("half cover starts off", half.active, false);
  assert("half cover name", half.name, "Target Has Half Cover (+2 AC)");
  assert("half cover floats", floats[0], "Half Cover");
  const tq = run(wall("greater"));
  assert("three-quarters value", tq.value, -5);
  assert("three-quarters name", tq.name, "Target Has Three-Quarters Cover (+5 AC)");
  assert("total cover -> no modifier", run(wall("full")), null);
  assert("total cover floats", floats[0], "Total Cover");
  assert("unmeasurable cover -> null", run(null), null);
}

section("creatures");
{
  const half = run({ degree: "none", creatures: [creature(0.25)] });
  assert("creature blocking some lines -> half", half.value, -2);
  assert("creature named in modifier", half.name, "Target Has Half Cover from Goblin (+2 AC)");
  const tq = run({ degree: "none", creatures: [creature(0.75, "Ogre")] });
  assert("creature blocking most lines -> three-quarters", tq.value, -5);
  const capped = run({ degree: "none", creatures: [creature(1, "Ogre")] });
  assert("creature never gives total cover", capped.value, -5);
  assert("capped creature cover floats three-quarters", floats[0], "Three-Quarters Cover");
  assert(
    "creature listed but blocking nothing -> null",
    run({ degree: "none", creatures: [creature(0)] }),
    null,
  );
}

section("walls and creatures: most protective applies, not added");
{
  const wallWins = run({ degree: "greater", creatures: [creature(0.25)] });
  assert("three-quarters wall beats half creature", wallWins.name, "Target Has Three-Quarters Cover (+5 AC)");
  const creatureWins = run({ degree: "standard", creatures: [creature(0.75, "Ogre")] });
  assert("three-quarters creature beats half wall", creatureWins.name, "Target Has Three-Quarters Cover from Ogre (+5 AC)");
  const tie = run({ degree: "standard", creatures: [creature(0.25)] });
  assert("equal degrees don't add", tie.value, -2);
  assert("tie credits the wall", tie.name, "Target Has Half Cover (+2 AC)");
  assert("total wall cover beats creature", run({ degree: "full", creatures: [creature(0.75)] }), null);
}

section("GM-applied Cover effect skips detection");
{
  assert(
    "Cover effect -> null",
    run(wall("greater"), { target: target([{ name: "Cover (Half)" }]) }),
    null,
  );
  assert("no float when skipped", floats.length, 0);
  assert(
    "lowercase cover effect -> null",
    run(wall("greater"), { target: target([{ name: "cover" }]) }),
    null,
  );
  assert(
    "unrelated effect doesn't skip",
    run(wall("greater"), { target: target([{ name: "Blessed" }]) }).value,
    -5,
  );
}

section("coverNotice campaign setting");
{
  run(wall("standard"), { setting: "no" });
  assert("setting no -> no float", floats.length, 0);
  assert("setting no still offers the modifier", run(wall("standard"), { setting: "no" }).value, -2);
  run(wall("standard"), { setting: "yes" });
  assert("setting yes -> float", floats[0], "Half Cover");
  run(wall("standard"), { setting: null });
  assert("unset -> float", floats[0], "Half Cover");
}

section("getAttackModifiersForTarget includes cover");
{
  ctx.api.getCover = () => wall("standard");
  const res = ctx.getAttackModifiersForTarget(target(), 30, attacker, true, false);
  assert("cover modifier present", res.some((m) => m.isCover && m.value === -2), true);
  const noAttacker = ctx.getAttackModifiersForTarget(target(), 30, undefined, true, false);
  assert("no attacker -> no cover", noAttacker.some((m) => m.isCover), false);
}

summary();
