#!/usr/bin/env node
// Tests for rollhandlers/spells.js — the shared spellcasting path behind the
// character spell list, NPC spellcasting actions, and items that cast spells.
//
// These lock down the behavior the three callers used to each implement
// separately, so a change in the shared path can't silently regress one of them:
//   • resource consumption (spell slots, pact magic, spell points, NPC slots, items)
//   • damage / healing scaling by cast level and caster level
//   • save DC math and which modifiers apply to it
//   • the attack-modifier seed and which effect modifiers get layered on
//   • the chat card: buttons emitted and tags attached
//
// Run with: node tests/test-spells.js

const { createSandbox, loadScript } = require("./sandbox");
const {
  assert,
  assertIncludes,
  assertNotIncludes,
  section,
  summary,
} = require("./test-helpers");

// ── Harness ──────────────────────────────────────────────────────────────────

// Builds a sandbox with spells.js loaded and api.getValue/setValue wired to the
// record's data, so the resource handlers and DC math read and write real state.
// Returns the context plus the captured chat messages and roll prompts.
function makeCtx(recordData = {}, options = {}) {
  const ctx = createSandbox();
  loadScript(ctx, "feature-utils.js");
  loadScript(ctx, "spells.js");

  ctx.record.data = { ...recordData };
  ctx.record.recordType = options.recordType || "characters";

  const messages = [];
  const writes = {};
  const notifications = [];

  const resolve = (path) => {
    // Only "data.<field>" style paths are used by the code under test; anything
    // else (a list row path) is handled by the test's own override.
    const parts = String(path).split(".");
    if (parts[0] === "data" && parts.length === 2) {
      return ctx.record.data[parts[1]];
    }
    return undefined;
  };

  ctx.api.getValue = (path) => {
    if (
      options.values &&
      Object.prototype.hasOwnProperty.call(options.values, path)
    ) {
      return options.values[path];
    }
    const v = resolve(path);
    return v === undefined ? null : v;
  };
  ctx.api.setValue = (path, value) => {
    writes[path] = value;
    const parts = String(path).split(".");
    if (parts[0] === "data" && parts.length === 2) {
      ctx.record.data[parts[1]] = value;
    }
  };
  ctx.api.sendMessage = (message, _a, _b, tags) => {
    messages.push({ message, tags: tags || [] });
  };
  ctx.api.showNotification = (text, color, title) => {
    notifications.push({ text, color, title });
  };
  ctx.api.getToken = () => options.token || null;

  return { ctx, messages, writes, notifications };
}

function spellFixture(data = {}, extra = {}) {
  return {
    _id: "spell1",
    name: extra.name || "Test Spell",
    recordType: "spells",
    data: { level: "1", prepared: "prepared", ...data },
    ...extra,
  };
}

// Character with a full complement of slots at every level.
function slotsAtEveryLevel(count = 2) {
  const data = {};
  for (let i = 1; i <= 9; i++) {
    data[`numSpellSlots${i}`] = String(count);
    data[`spellSlots${i}`] = "0";
  }
  return data;
}

// Finds the tag with the given name from a captured message.
function tagNamed(tags, name) {
  return (tags || []).find((t) => t.name === name);
}

// ── isRangedSpell ────────────────────────────────────────────────────────────

section("isRangedSpell — range field and description overrides");
{
  const { ctx } = makeCtx();
  const { isRangedSpell } = ctx;
  assert(
    "no range is melee",
    isRangedSpell(spellFixture({ range: "0" })),
    false,
  );
  assert(
    "a numeric range is ranged",
    isRangedSpell(spellFixture({ range: "120" })),
    true,
  );
  assert(
    "a feet range is ranged",
    isRangedSpell(spellFixture({ range: "120 feet" })),
    true,
  );
  assert(
    "'melee spell attack' in the description wins over a range",
    isRangedSpell(
      spellFixture({
        range: "5 feet",
        description: "Make a melee spell attack against the target.",
      }),
    ),
    false,
  );
  assert("no range field at all", isRangedSpell(spellFixture({})), false);
}

// ── getSpellShape ────────────────────────────────────────────────────────────

section("getSpellShape — self-originating areas are detected from the text");
{
  const { ctx } = makeCtx();
  const { getSpellShape, isRangedSpell } = ctx;

  const lightningBolt = spellFixture({
    range: "Self",
    description:
      "<p>A stroke of lightning forming a 100-foot-long, 5-foot-wide <strong>Line</strong> blasts out from you in a direction you choose.</p>",
  });
  assert("Lightning Bolt is a line", getSpellShape(lightningBolt), "line");
  assert(
    "Lightning Bolt is still not a ranged attack",
    isRangedSpell(lightningBolt),
    false,
  );

  assert(
    "Burning Hands is a cone",
    getSpellShape(
      spellFixture({
        range: "Self",
        description: "A 15-foot <strong>Cone</strong> of flame erupts.",
      }),
    ),
    "cone",
  );
  assert(
    "Thunderwave is an emanation",
    getSpellShape(
      spellFixture({
        range: "Self",
        description:
          "Each creature in a 15-foot <strong>Cube</strong> from you.",
      }),
    ),
    "emanation",
  );
  assert(
    "an explicit Emanation is one at any range",
    getSpellShape(
      spellFixture({
        range: "Self",
        description: "A 10-foot <strong>Emanation</strong> surrounds you.",
      }),
    ),
    "emanation",
  );
  assert(
    "the Area field is read when present",
    getSpellShape(spellFixture({ range: "Self", area: "60-foot cone" })),
    "cone",
  );
}

section("getSpellShape — distant areas and prose are not shapes");
{
  const { ctx } = makeCtx();
  const { getSpellShape } = ctx;

  assert(
    "Fireball's sphere at range has no self-shape",
    getSpellShape(
      spellFixture({
        range: "150 feet",
        description: "A 20-foot-radius <strong>Sphere</strong> of flame.",
      }),
    ),
    null,
  );
  assert(
    "'line of sight' is prose, not a Line",
    getSpellShape(
      spellFixture({
        range: "60 feet",
        description: "Choose a creature you can see within line of sight.",
      }),
    ),
    null,
  );
  assert(
    "a plain single-target spell has no shape",
    getSpellShape(
      spellFixture({
        range: "60 feet",
        description: "One creature you can see makes a Wisdom saving throw.",
      }),
    ),
    null,
  );
}

// ── getSpellPredicateContext ─────────────────────────────────────────────────

section("getSpellPredicateContext — carries every gating field");
{
  const { ctx } = makeCtx();
  const spellCtx = ctx.getSpellPredicateContext(
    spellFixture(
      {
        school: "evocation",
        spellLists: ["Wizard", "Sorcerer"],
        spellTags: ["fire"],
      },
      { name: "Fireball" },
    ),
  );
  assert("name", spellCtx.spellName, "Fireball");
  assert("school", spellCtx.spellSchool, "evocation");
  assert("lists", spellCtx.spellLists, ["Wizard", "Sorcerer"]);
  assert("tags", spellCtx.spellTags, ["fire"]);

  const empty = ctx.getSpellPredicateContext(undefined);
  assert("undefined spell is safe", empty.spellName, "");
  assert("lists default to empty", empty.spellLists, []);
}

// ── buildSpellAttackModifiers ────────────────────────────────────────────────

section("buildSpellAttackModifiers — seed and effect collection");
{
  const { ctx } = makeCtx();
  const seed = [{ name: "Intelligence", value: 4, active: true }];

  assert(
    "a non-attack spell gets no modifiers at all",
    ctx.buildSpellAttackModifiers(spellFixture({ isAttack: false }), {
      flatModifiers: seed,
    }),
    [],
  );

  const attackSpell = spellFixture({ isAttack: true, range: "120 feet" });
  const withSeed = ctx.buildSpellAttackModifiers(attackSpell, {
    flatModifiers: seed,
  });
  assert("the seed survives", withSeed[0].name, "Intelligence");

  // collectEffects:false is how an item casting on its OWN fixed numbers keeps
  // the holder's spellcasting modifiers out of the roll.
  const itemOnly = ctx.buildSpellAttackModifiers(attackSpell, {
    flatModifiers: [{ name: "Wand Spell Attack", value: 7, active: true }],
    collectEffects: false,
  });
  assert("item numbers stand alone", itemOnly.length, 1);
  assert("and are the item's", itemOnly[0].value, 7);
}

// ── consumeCharacterSpellResource: spell slots ───────────────────────────────

section("consumeCharacterSpellResource — spell slots");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel());
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "3" }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
  });
  assert("proceeds", result.proceed, true);
  assert("casts at level 3", result.spellLevel, 3);
  assert("spends a level 3 slot", writes["data.spellSlots3"], 1);
}

section("consumeCharacterSpellResource — upcastLevel spends the higher slot");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel());
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "3", upcastLevel: "5" }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 5,
  });
  assert("casts at level 5", result.spellLevel, 5);
  assert("spends a level 5 slot", writes["data.spellSlots5"], 1);
  assert("leaves level 3 alone", writes["data.spellSlots3"], undefined);
}

section("consumeCharacterSpellResource — falls up to the next available slot");
{
  const data = slotsAtEveryLevel(0);
  data.numSpellSlots5 = "1";
  data.spellSlots5 = "0";
  const { ctx, writes } = makeCtx(data);
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "3" }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
  });
  assert("casts at the slot actually spent", result.spellLevel, 5);
  assert("spends the level 5 slot", writes["data.spellSlots5"], 1);
}

section("consumeCharacterSpellResource — no resource at all aborts the cast");
{
  const { ctx, writes, notifications } = makeCtx(slotsAtEveryLevel(0));
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "3" }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
  });
  assert("does not proceed", result.proceed, false);
  assert("nothing spent", Object.keys(writes).length, 0);
  assert("the player is told why", notifications.length, 1);
  assertIncludes("names the spell", notifications[0].text, "Fireball");
}

// ── consumeCharacterSpellResource: spell points (2014 variant) ───────────────

section("consumeCharacterSpellResource — spell points");
{
  const data = slotsAtEveryLevel(0);
  data.useSpellPoints = true;
  data.numSpellPoints = "20";
  data.spellPoints = "20";
  const { ctx, writes } = makeCtx(data);
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "3" }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
  });
  assert("proceeds", result.proceed, true);
  assert("casts at level 3", result.spellLevel, 3);
  // A level 3 spell costs 5 points.
  assert("spends 5 points", writes["data.spellPoints"], 15);
  assert("no slot spent", writes["data.spellSlots3"], undefined);
}

section("consumeCharacterSpellResource — points are preferred over slots");
{
  const data = slotsAtEveryLevel(2);
  data.useSpellPoints = true;
  data.numSpellPoints = "20";
  data.spellPoints = "20";
  const { ctx, writes } = makeCtx(data);
  ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "1" }),
    spellName: "Magic Missile",
    casterRecord: ctx.record,
    actualSpellLevel: 1,
    requestedSlot: 1,
  });
  assert("spends 2 points", writes["data.spellPoints"], 18);
  assert("slots untouched", writes["data.spellSlots1"], undefined);
}

section("consumeCharacterSpellResource — 6th+ points are once per long rest");
{
  const base = () => {
    const data = slotsAtEveryLevel(0);
    data.useSpellPoints = true;
    data.numSpellPoints = "40";
    data.spellPoints = "40";
    return data;
  };

  const first = makeCtx(base());
  const ok = first.ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "6" }),
    spellName: "Chain Lightning",
    casterRecord: first.ctx.record,
    actualSpellLevel: 6,
    requestedSlot: 6,
  });
  assert("the first level 6 cast proceeds", ok.proceed, true);
  assert("costs 9 points", first.writes["data.spellPoints"], 31);
  assert(
    "and marks the slot used",
    first.writes["data.spellPointSlot6Used"],
    true,
  );

  const data = base();
  data.spellPointSlot6Used = true;
  const second = makeCtx(data);
  const blocked = second.ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "6" }),
    spellName: "Chain Lightning",
    casterRecord: second.ctx.record,
    actualSpellLevel: 6,
    requestedSlot: 6,
  });
  assert("the second is refused", blocked.proceed, false);
  assertIncludes(
    "and says why",
    second.notifications[0].text,
    "this long rest",
  );
}

section("consumeCharacterSpellResource — not enough points refuses");
{
  const data = slotsAtEveryLevel(0);
  data.useSpellPoints = true;
  data.numSpellPoints = "20";
  data.spellPoints = "1";
  const { ctx, notifications } = makeCtx(data);
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "3" }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
  });
  assert("does not proceed", result.proceed, false);
  assertIncludes("names the shortfall", notifications[0].text, "spell points");
}

// ── consumeCharacterSpellResource: pact magic ───────────────────────────────

section("consumeCharacterSpellResource — pact magic when the toggle is on");
{
  const data = slotsAtEveryLevel(2);
  data.usePactMagic = true;
  data.numPactMagic3 = "2";
  data.pactMagic3 = "0";
  const { ctx, writes } = makeCtx(data);
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "1" }),
    spellName: "Hex",
    casterRecord: ctx.record,
    actualSpellLevel: 1,
    requestedSlot: 1,
  });
  assert("proceeds", result.proceed, true);
  // Pact slots are all the same level, so a level 1 spell cast through one is
  // cast at the pact slot's level.
  assert("casts at the pact slot level", result.spellLevel, 3);
  assert("spends a pact slot", writes["data.pactMagic3"], 1);
  assert("leaves spell slots alone", writes["data.spellSlots1"], undefined);
}

section("consumeCharacterSpellResource — pact magic covers a missing slot");
{
  const data = slotsAtEveryLevel(0);
  data.numPactMagic2 = "1";
  data.pactMagic2 = "0";
  const { ctx, writes } = makeCtx(data);
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "2" }),
    spellName: "Misty Step",
    casterRecord: ctx.record,
    actualSpellLevel: 2,
    requestedSlot: 2,
  });
  assert("proceeds without the toggle", result.proceed, true);
  assert("spends the pact slot", writes["data.pactMagic2"], 1);
}

section("consumeCharacterSpellResource — a pact slot below the spell refuses");
{
  const data = slotsAtEveryLevel(0);
  data.usePactMagic = true;
  data.numPactMagic1 = "1";
  data.pactMagic1 = "0";
  const { ctx, writes, notifications } = makeCtx(data);
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "5" }),
    spellName: "Hold Monster",
    casterRecord: ctx.record,
    actualSpellLevel: 5,
    requestedSlot: 5,
  });
  assert("does not proceed", result.proceed, false);
  assert("nothing spent", Object.keys(writes).length, 0);
  assertIncludes("says why", notifications[0].text, "pact magic");
}

// ── consumeCharacterSpellResource: daily / at-will ──────────────────────────

section("consumeCharacterSpellResource — daily uses");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel());
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({
      level: "3",
      prepared: "daily",
      dailyUses: 0,
      maxDailyUses: 2,
    }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
    dailyUsesPath: "data.spells3.0.data.dailyUses",
  });
  assert("proceeds", result.proceed, true);
  assert("spends a daily use", writes["data.spells3.0.data.dailyUses"], 1);
  assert("no slot spent", writes["data.spellSlots3"], undefined);
}

section("consumeCharacterSpellResource — daily uses stops at the max");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel());
  ctx.consumeCharacterSpellResource({
    spell: spellFixture({
      level: "3",
      prepared: "daily",
      dailyUses: 2,
      maxDailyUses: 2,
    }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
    dailyUsesPath: "data.spells3.0.data.dailyUses",
  });
  assert("nothing written", Object.keys(writes).length, 0);
}

section("consumeCharacterSpellResource — at-will spends nothing");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel());
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "3", prepared: "atwill" }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
  });
  assert("proceeds", result.proceed, true);
  assert("nothing spent", Object.keys(writes).length, 0);
}

section("consumeCharacterSpellResource — cantrips spend nothing");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel());
  const result = ctx.consumeCharacterSpellResource({
    spell: spellFixture({ level: "Cantrip" }),
    spellName: "Fire Bolt",
    casterRecord: ctx.record,
    actualSpellLevel: 0,
    requestedSlot: 1,
  });
  assert("proceeds", result.proceed, true);
  assert("nothing spent", Object.keys(writes).length, 0);
}

// ── consumeNpcSpellResource ─────────────────────────────────────────────────

section("consumeNpcSpellResource — a plain slot at the spell's level");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel(), { recordType: "npcs" });
  const result = ctx.consumeNpcSpellResource({
    spell: spellFixture({ level: "3" }),
    actualSpellLevel: 3,
  });
  assert("casts at level 3", result.spellLevel, 3);
  assert("spends the level 3 slot", writes["data.spellSlots3"], 1);
}

section(
  "consumeNpcSpellResource — exhausted slots still cast (NPCs don't gate)",
);
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel(0), { recordType: "npcs" });
  const result = ctx.consumeNpcSpellResource({
    spell: spellFixture({ level: "3" }),
    actualSpellLevel: 3,
  });
  assert("still proceeds", result.proceed, true);
  assert("still reports the level", result.spellLevel, 3);
  assert("but nothing is spent", Object.keys(writes).length, 0);
}

section("consumeNpcSpellResource — daily cantrips do not burn a daily use");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel(), { recordType: "npcs" });
  ctx.consumeNpcSpellResource({
    spell: spellFixture({
      level: "Cantrip",
      prepared: "daily",
      dailyUses: 0,
      maxDailyUses: 3,
    }),
    actualSpellLevel: 0,
    dailyUsesPath: "data.actions.0.data.spells.0.data.dailyUses",
  });
  assert("nothing written", Object.keys(writes).length, 0);

  const leveled = makeCtx(slotsAtEveryLevel(), { recordType: "npcs" });
  leveled.ctx.consumeNpcSpellResource({
    spell: spellFixture({
      level: "3",
      prepared: "daily",
      dailyUses: 0,
      maxDailyUses: 3,
    }),
    actualSpellLevel: 3,
    dailyUsesPath: "data.actions.0.data.spells.0.data.dailyUses",
  });
  assert(
    "but a leveled daily spell does",
    leveled.writes["data.actions.0.data.spells.0.data.dailyUses"],
    1,
  );
}

// ── makeFixedLevelResource ──────────────────────────────────────────────────

section("makeFixedLevelResource — items pin the level and spend nothing");
{
  const { ctx, writes } = makeCtx(slotsAtEveryLevel());
  const handler = ctx.makeFixedLevelResource(5);
  const result = handler({
    spell: spellFixture({ level: "3" }),
    spellName: "Fireball",
    casterRecord: ctx.record,
    actualSpellLevel: 3,
    requestedSlot: 3,
  });
  assert("proceeds", result.proceed, true);
  assert("uses the pinned level", result.spellLevel, 5);
  assert("no writes", Object.keys(writes).length, 0);

  assert("level 0 is honored", ctx.makeFixedLevelResource(0)({}).spellLevel, 0);
  assert(
    "undefined level falls back to 0",
    ctx.makeFixedLevelResource(undefined)({}).spellLevel,
    0,
  );
}

// ── castSpellShared: level scaling ──────────────────────────────────────────
//
// This is the block that guards the bug the shared path was written to fix: an
// item casting a spell used to roll the spell's base damage regardless of the
// level it was cast at, and ignored every scaling field.

function scalingSpell(extra = {}) {
  return spellFixture(
    {
      level: "3",
      isSave: true,
      savingThrow: "dexterity",
      damage: "8d6 fire",
      damageLevel4: "9d6 fire",
      damageLevel5: "10d6 fire",
      healing: "2d8",
      healingLevel4: "3d8",
      healingLevel5: "4d8",
      damage2: "1d4 cold",
      damage2Level5: "2d4 cold",
      ...extra,
    },
    { name: "Scaling Spell" },
  );
}

function castAt(level, spellExtra = {}, opts = {}) {
  const harness = makeCtx(
    {
      level: "5",
      intelligenceMod: "4",
      proficiencyBonus: "3",
      ...(opts.recordData || {}),
    },
    opts.ctxOptions,
  );
  harness.ctx.castSpellShared(scalingSpell(spellExtra), {
    consumeResource: harness.ctx.makeFixedLevelResource(level),
    casterLevel: opts.casterLevel || 5,
    ...(opts.castOptions || {}),
  });
  return harness;
}

section("castSpellShared — leveled spell scales damage to the cast level");
{
  const base = castAt(3);
  assert("one message sent", base.messages.length, 1);
  assertIncludes(
    "level 3 uses base damage",
    base.messages[0].message,
    "8d6 fire",
  );

  const four = castAt(4);
  assertIncludes("level 4 damage", four.messages[0].message, "9d6 fire");
  assertNotIncludes(
    "level 4 does not use base damage",
    four.messages[0].message,
    "8d6 fire",
  );

  const five = castAt(5);
  assertIncludes("level 5 damage", five.messages[0].message, "10d6 fire");
}

section("castSpellShared — healing scales to the cast level");
{
  assertIncludes("level 3 healing", castAt(3).messages[0].message, "'2d8'");
  assertIncludes("level 5 healing", castAt(5).messages[0].message, "'4d8'");
}

section("castSpellShared — alternate damage scales to the cast level");
{
  assertIncludes(
    "level 3 alt damage",
    castAt(3).messages[0].message,
    "1d4 cold",
  );
  assertIncludes(
    "level 5 alt damage",
    castAt(5).messages[0].message,
    "2d4 cold",
  );
}

section(
  "castSpellShared — cantrips scale off the caster's level, not the slot",
);
{
  const cantrip = () =>
    spellFixture(
      {
        level: "Cantrip",
        isAttack: false,
        damage: "1d10 fire",
        damageCharacterLevel5: "2d10 fire",
        damageCharacterLevel11: "3d10 fire",
        damageCharacterLevel17: "4d10 fire",
      },
      { name: "Fire Bolt" },
    );

  const at = (casterLevel) => {
    const h = makeCtx({ level: String(casterLevel), intelligenceMod: "4" });
    h.ctx.castSpellShared(cantrip(), {
      consumeResource: h.ctx.makeFixedLevelResource(0),
      casterLevel,
    });
    return h.messages[0].message;
  };

  assertIncludes("level 1", at(1), "1d10 fire");
  assertIncludes("level 5", at(5), "2d10 fire");
  assertIncludes("level 11", at(11), "3d10 fire");
  assertIncludes("level 17", at(17), "4d10 fire");
}

// ── castSpellShared: buttons ────────────────────────────────────────────────

section("castSpellShared — save spell emits save and damage buttons");
{
  const { message } = castAt(3).messages[0];
  assertIncludes("save button", message, "Roll_Dexterity_Save");
  assertIncludes("damage button", message, "Roll_Fire_Damage");
  assertNotIncludes("no attack button", message, "Roll_Attack");
}

section("castSpellShared — additional saving throws each get a button");
{
  const h = makeCtx({
    level: "5",
    intelligenceMod: "4",
    proficiencyBonus: "3",
  });
  h.ctx.castSpellShared(
    scalingSpell({ additionalSavingThrows: ["wisdom", "constitution"] }),
    { consumeResource: h.ctx.makeFixedLevelResource(3) },
  );
  const { message } = h.messages[0];
  assertIncludes("primary", message, "Roll_Dexterity_Save");
  assertIncludes("wisdom", message, "Roll_Wisdom_Save");
  assertIncludes("constitution", message, "Roll_Constitution_Save");
}

section(
  "castSpellShared — attack spell emits an attack button, not a damage one",
);
{
  const h = makeCtx({
    level: "5",
    intelligenceMod: "4",
    proficiencyBonus: "3",
  });
  h.ctx.castSpellShared(
    spellFixture(
      { level: "1", isAttack: true, damage: "4d6 radiant", range: "120 feet" },
      { name: "Guiding Bolt" },
    ),
    { consumeResource: h.ctx.makeFixedLevelResource(1) },
  );
  const { message } = h.messages[0];
  assertIncludes("attack button", message, "Roll_Attack");
  assertNotIncludes(
    "no standalone damage button",
    message,
    "Roll_Radiant_Damage",
  );
  assertIncludes("damage rides on the attack", message, "4d6 radiant");
}

// ── castSpellShared: save DC ────────────────────────────────────────────────

section("castSpellShared — computed DC is 8 + ability mod + proficiency");
{
  const h = makeCtx({
    level: "5",
    intelligenceMod: "4",
    proficiencyBonus: "3",
  });
  h.ctx.castSpellShared(
    spellFixture({
      isSave: true,
      savingThrow: "dexterity",
      damage: "1d6 fire",
    }),
    { consumeResource: h.ctx.makeFixedLevelResource(1) },
  );
  assertIncludes("DC 15", h.messages[0].message, '"dc": 15');
}

section("castSpellShared — flat spellDCBonus on the sheet raises the DC");
{
  const h = makeCtx({
    level: "5",
    intelligenceMod: "4",
    proficiencyBonus: "3",
    spellDCBonus: "2",
  });
  h.ctx.castSpellShared(
    spellFixture({
      isSave: true,
      savingThrow: "dexterity",
      damage: "1d6 fire",
    }),
    { consumeResource: h.ctx.makeFixedLevelResource(1) },
  );
  assertIncludes("DC 17", h.messages[0].message, '"dc": 17');
}

section("castSpellShared — baseSaveDc overrides the computation (NPC / item)");
{
  const h = makeCtx({
    level: "5",
    intelligenceMod: "4",
    proficiencyBonus: "3",
    spellDCBonus: "2",
  });
  h.ctx.castSpellShared(
    spellFixture({
      isSave: true,
      savingThrow: "dexterity",
      damage: "1d6 fire",
    }),
    {
      consumeResource: h.ctx.makeFixedLevelResource(1),
      baseSaveDc: 13,
      applyDcModifiers: false,
    },
  );
  assertIncludes(
    "the fixed DC is used verbatim",
    h.messages[0].message,
    '"dc": 13',
  );
}

section("castSpellShared — the spell row's saveDc override wins when allowed");
{
  const spell = spellFixture({
    isSave: true,
    savingThrow: "dexterity",
    damage: "1d6 fire",
    saveDc: 19,
  });

  const allowed = makeCtx({ intelligenceMod: "4", proficiencyBonus: "3" });
  allowed.ctx.castSpellShared(spell, {
    consumeResource: allowed.ctx.makeFixedLevelResource(1),
  });
  assertIncludes("override applies", allowed.messages[0].message, '"dc": 19');

  // An item's Spells tab owns the numbers, so the row's own override is ignored.
  const denied = makeCtx({ intelligenceMod: "4", proficiencyBonus: "3" });
  denied.ctx.castSpellShared(spell, {
    consumeResource: denied.ctx.makeFixedLevelResource(1),
    allowSpellOverrides: false,
    baseSaveDc: 13,
    applyDcModifiers: false,
  });
  assertIncludes("override ignored", denied.messages[0].message, '"dc": 13');
}

// ── castSpellShared: tags ───────────────────────────────────────────────────

section("castSpellShared — cast level tag reflects the effective level");
{
  const five = castAt(5);
  assert(
    "level tag",
    tagNamed(five.messages[0].tags, "Level 5") !== undefined,
    true,
  );

  const h = makeCtx({ level: "5", intelligenceMod: "4" });
  h.ctx.castSpellShared(
    spellFixture(
      { level: "Cantrip", damage: "1d10 fire" },
      { name: "Fire Bolt" },
    ),
    { consumeResource: h.ctx.makeFixedLevelResource(0), casterLevel: 5 },
  );
  assert(
    "cantrips tag as Cantrip",
    tagNamed(h.messages[0].tags, "Cantrip") !== undefined,
    true,
  );
}

section("castSpellShared — the standard tag set is attached");
{
  const h = makeCtx({ intelligenceMod: "4", proficiencyBonus: "3" });
  h.ctx.castSpellShared(
    spellFixture({
      level: "3",
      castingTime: "1 action",
      range: "150 feet",
      duration: "Instantaneous",
      components: "V,S,M (a tiny ball of bat guano)",
      damage: "8d6 fire",
      isSave: true,
    }),
    { consumeResource: h.ctx.makeFixedLevelResource(3) },
  );
  const { tags } = h.messages[0];
  assert("Spell", tagNamed(tags, "Spell") !== undefined, true);
  assert("casting time", tagNamed(tags, "1 action") !== undefined, true);
  assert("range", tagNamed(tags, "150 feet") !== undefined, true);
  assert("duration", tagNamed(tags, "Instantaneous") !== undefined, true);
  assert("verbal", tagNamed(tags, "Verbal") !== undefined, true);
  assert("somatic", tagNamed(tags, "Somatic") !== undefined, true);
  assert("material", tagNamed(tags, "Material") !== undefined, true);
}

section("castSpellShared — costly material components are marked");
{
  const h = makeCtx({ intelligenceMod: "4" });
  h.ctx.castSpellShared(
    spellFixture({
      level: "3",
      components: "V,S,M (a diamond worth at least 300 gp)",
      damage: "1d6 fire",
    }),
    { consumeResource: h.ctx.makeFixedLevelResource(3) },
  );
  assert(
    "flagged with a cost",
    tagNamed(h.messages[0].tags, "Material $") !== undefined,
    true,
  );
}

section("castSpellShared — concentration is tagged and the prefix stripped");
{
  const h = makeCtx({ intelligenceMod: "4" });
  h.ctx.castSpellShared(
    spellFixture({
      level: "2",
      duration: "Concentration, up to 10 minutes",
      damage: "1d6 fire",
    }),
    { consumeResource: h.ctx.makeFixedLevelResource(2) },
  );
  const { tags } = h.messages[0];
  assert(
    "concentration tag",
    tagNamed(tags, "Concentration") !== undefined,
    true,
  );
  assert(
    "duration without the prefix",
    tagNamed(tags, "10 minutes") !== undefined,
    true,
  );
}

section("castSpellShared — upcast duration is used for the duration tag");
{
  const h = makeCtx({ intelligenceMod: "4" });
  h.ctx.castSpellShared(
    spellFixture({
      level: "3",
      duration: "1 minute",
      durationLevel5: "10 minutes",
      damage: "1d6 fire",
    }),
    { consumeResource: h.ctx.makeFixedLevelResource(5) },
  );
  assert(
    "level 5 duration",
    tagNamed(h.messages[0].tags, "10 minutes") !== undefined,
    true,
  );
}

section("castSpellShared — subHeader is inserted under the spell name");
{
  const h = makeCtx({ intelligenceMod: "4" });
  h.ctx.castSpellShared(spellFixture({ level: "1", damage: "1d6 fire" }), {
    consumeResource: h.ctx.makeFixedLevelResource(1),
    subHeader: "_Wand of Fireballs_ — _using its own spellcasting_",
  });
  assertIncludes(
    "present",
    h.messages[0].message,
    "_Wand of Fireballs_ — _using its own spellcasting_",
  );
  // The plain character cast must not grow a stray blank block.
  const plain = makeCtx({ intelligenceMod: "4" });
  plain.ctx.castSpellShared(spellFixture({ level: "1", damage: "1d6 fire" }), {
    consumeResource: plain.ctx.makeFixedLevelResource(1),
  });
  assertIncludes(
    "header then rule",
    plain.messages[0].message,
    "Test Spell\n\n---",
  );
}

// ── castSpellShared: guards ─────────────────────────────────────────────────

section("castSpellShared — a nonexistent spell is a no-op");
{
  const h = makeCtx();
  h.ctx.castSpellShared(undefined, {});
  assert("nothing sent", h.messages.length, 0);
}

section("castSpellShared — an aborted resource stops before sending anything");
{
  const h = makeCtx(slotsAtEveryLevel(0));
  h.ctx.castSpellShared(spellFixture({ level: "3", damage: "8d6 fire" }), {});
  assert("nothing sent", h.messages.length, 0);
  assert("the player was told", h.notifications.length, 1);
}

section("castSpellShared — afterCast reports the resolved cast");
{
  const h = makeCtx({ intelligenceMod: "4", proficiencyBonus: "3" });
  let seen = null;
  h.ctx.castSpellShared(
    spellFixture({ level: "3", isSave: true, damage: "8d6 fire" }),
    {
      consumeResource: h.ctx.makeFixedLevelResource(5),
      afterCast: (info) => {
        seen = info;
      },
    },
  );
  assert("called", seen !== null, true);
  assert("reports the level", seen.spellLevel, 5);
  assert("reports the DC", seen.saveDc, 15);
  assert("carries the resource result", seen.resource.spellLevel, 5);
  assert("and the spell", seen.spellName, "Test Spell");
}

// ── getItemSpellcasting ─────────────────────────────────────────────────────

// A character sheet with an item at data.inventory.0, so getItemSpellcasting's
// path reads resolve.
function makeItemCtx(itemData, recordData = {}) {
  const ctx = createSandbox();
  loadScript(ctx, "feature-utils.js");
  loadScript(ctx, "spells.js");
  ctx.record.data = {
    inventory: [{ _id: "item1", name: "Wand of Fireballs", data: itemData }],
    ...recordData,
  };
  const messages = [];
  ctx.api.getValue = (path) => {
    const v = String(path)
      .split(".")
      .reduce((o, k) => (o == null ? undefined : o[k]), ctx.record);
    return v === undefined ? null : v;
  };
  ctx.api.sendMessage = (message, _a, _b, tags) => {
    messages.push({ message, tags: tags || [] });
  };
  ctx.api.getRecord = () => {};
  return { ctx, messages };
}

section("getItemSpellcasting — holder branch returns base, unmodified numbers");
{
  const { ctx } = makeItemCtx(
    { useOwnSpellcasting: true, defaultSpellDC: 13, defaultSpellAttack: 5 },
    {
      classes: [{ data: { spellcastingAbility: "intelligence" } }],
      intelligenceMod: "4",
      proficiencyBonus: "3",
      // A flat sheet bonus must NOT be pre-summed here — castSpellShared layers
      // it on, and doing it twice would double-count.
      spellDCBonus: "2",
    },
  );
  const casting = ctx.getItemSpellcasting("data.inventory.0");
  assert("source", casting.source, "holder");
  assert("ability", casting.ability, "intelligence");
  assert("base DC is 8 + 4 + 3", casting.saveDc, 15);
  assert("base attack is 4 + 3", casting.attackBonus, 7);
  assert(
    "caster modifiers get applied downstream",
    casting.applyCasterModifiers,
    true,
  );
}

section("getItemSpellcasting — item branch uses the item's fixed numbers");
{
  const { ctx } = makeItemCtx(
    { useOwnSpellcasting: false, defaultSpellDC: 15, defaultSpellAttack: 7 },
    {
      classes: [{ data: { spellcastingAbility: "intelligence" } }],
      intelligenceMod: "4",
      proficiencyBonus: "3",
    },
  );
  const casting = ctx.getItemSpellcasting("data.inventory.0");
  assert("source", casting.source, "item");
  assert("DC", casting.saveDc, 15);
  assert("attack", casting.attackBonus, 7);
  assert("no ability", casting.ability, null);
  assert("caster modifiers stay out", casting.applyCasterModifiers, false);
}

section("getItemSpellcasting — a non-caster holder falls back to the item");
{
  const { ctx } = makeItemCtx(
    { useOwnSpellcasting: true, defaultSpellDC: 13, defaultSpellAttack: 5 },
    { classes: [{ data: {} }], intelligenceMod: "4", proficiencyBonus: "3" },
  );
  const casting = ctx.getItemSpellcasting("data.inventory.0");
  assert("falls back", casting.source, "item");
  assert("item DC", casting.saveDc, 13);
  assert("item attack", casting.attackBonus, 5);
}

// ── An item cast end to end ─────────────────────────────────────────────────

section("castItemSpell — item numbers are used verbatim, not the holder's");
{
  const spellRow = spellFixture(
    {
      level: "3",
      isSave: true,
      savingThrow: "dexterity",
      damage: "8d6 fire",
      damageLevel5: "10d6 fire",
      castLevel: 5,
      charges: 3,
    },
    { name: "Fireball" },
  );
  const { ctx, messages } = makeItemCtx(
    {
      useOwnSpellcasting: false,
      defaultSpellDC: 15,
      defaultSpellAttack: 7,
      itemSpells: [spellRow],
    },
    {
      classes: [{ data: { spellcastingAbility: "intelligence" } }],
      intelligenceMod: "5",
      proficiencyBonus: "4",
      spellDCBonus: "3",
      level: "9",
    },
  );
  ctx.castItemSpell("data.inventory.0", spellRow);
  assert("a card was sent", messages.length, 1);
  const { message, tags } = messages[0];
  // The holder's own DC would be 8 + 5 + 4 + 3 = 20; the item's is 15.
  assertIncludes("the item's DC", message, '"dc": 15');
  // And the row's castLevel must actually scale the damage.
  assertIncludes("scaled to the cast level", message, "10d6 fire");
  assertNotIncludes("not the base damage", message, "8d6 fire");
  assert("cast level tag", tagNamed(tags, "Level 5") !== undefined, true);
  assertIncludes("the source is named", message, "Wand of Fireballs");
  assertIncludes("and how it casts", message, "own spellcasting");
}

section("castItemSpell — the holder's spellcasting is used when asked for");
{
  const spellRow = spellFixture(
    {
      level: "1",
      isSave: true,
      savingThrow: "dexterity",
      damage: "3d6 fire",
      castLevel: 1,
    },
    { name: "Burning Hands" },
  );
  const { ctx, messages } = makeItemCtx(
    {
      useOwnSpellcasting: true,
      defaultSpellDC: 13,
      defaultSpellAttack: 5,
      itemSpells: [spellRow],
    },
    {
      classes: [{ data: { spellcastingAbility: "intelligence" } }],
      intelligenceMod: "5",
      proficiencyBonus: "4",
      spellDCBonus: "3",
      level: "9",
    },
  );
  ctx.castItemSpell("data.inventory.0", spellRow);
  // 8 + 5 + 4 + the sheet's flat 3.
  assertIncludes("the holder's DC", messages[0].message, '"dc": 20');
  assertIncludes("and it says so", messages[0].message, "your spellcasting");
}

section("castItemSpell — an action row with no spell attached is refused");
{
  const actionRow = {
    _id: "row1",
    name: "Ball Lightning",
    recordType: "spells",
    data: { charges: 2 },
  };
  const { ctx, messages } = makeItemCtx({
    useOwnSpellcasting: false,
    defaultSpellDC: 15,
    itemSpells: [actionRow],
  });
  const notes = [];
  ctx.api.showNotification = (text) => notes.push(text);
  ctx.castItemSpell("data.inventory.0", actionRow);
  assert("nothing cast", messages.length, 0);
  assert("the player is told", notes.length, 1);
}

process.exit(summary());
