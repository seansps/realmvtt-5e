#!/usr/bin/env node
// Idempotency tests for items-main.html.
//
// showHideFields() is wired to onload. A write re-renders the sheet, and a
// re-render re-fires onload — so if showHideFields ever writes a value that is
// already set, it calls itself forever. The same hazard applies to every
// onchange handler in the file: an unconditional write churns the record and,
// across a list of rows, trips the client's per-record rate limit.
//
// These tests run each handler twice against the state its own first pass
// produced and assert the SECOND pass writes nothing at all.
//
// Run with: node tests/test-items-main.js

const fs = require("fs");
const vm = require("vm");
const { assert, section, summary } = require("./test-helpers");

const HTML = fs.readFileSync(__dirname + "/../items-main.html", "utf8");
const SCRIPT = HTML.slice(
  HTML.indexOf("<script>") + "<script>".length,
  HTML.indexOf("</script>"),
);
const COMMON = fs.readFileSync(__dirname + "/../rollhandlers/common.js", "utf8");

// ── Harness ──────────────────────────────────────────────────────────────────

function setPath(root, path, value) {
  const parts = path.split(".");
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null) {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(root, path) {
  if (!path) return root;
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), root);
}

// Builds a context around one item record. Writes are captured AND applied, so
// a second call sees the state the first one produced. `spells` maps a spell id
// to the record api.getRecord should hand back (the scroll handlers re-fetch
// the chosen spell, because the dropdown only stores { _id, name }).
function makeItem(data = {}, fields = {}, spells = {}) {
  const record = { _id: "item1", recordType: "items", data, fields };
  let writes = {};
  const api = {
    getValue: (path) => {
      const v = getPath(record, path);
      return v === undefined ? undefined : v;
    },
    setValue: (path, value) => {
      writes[path] = value;
      setPath(record, path, value);
    },
    setValues: (obj) => {
      Object.entries(obj || {}).forEach(([path, value]) => {
        writes[path] = value;
        setPath(record, path, value);
      });
    },
    setHidden: () => {},
    getSetting: () => null,
    getToken: () => null,
    getRecord: (type, id, cb) => cb && cb(spells[id]),
  };
  const ctx = vm.createContext({
    api,
    record,
    console,
    dataPath: "",
    assetUrl: "https://assets.test/",
    // No parent path — the handlers then treat `record` as the item itself,
    // which is the compendium-record case (the riskiest one, since that is
    // where onload fires on open).
    getNearestParentDataPath: () => "",
  });
  // The scroll handlers lean on applyScrollDefaults (commonScript), so load it.
  new vm.Script(COMMON, { filename: "common.js" }).runInContext(ctx);
  new vm.Script(SCRIPT, { filename: "items-main.html" }).runInContext(ctx);
  return {
    ctx,
    record,
    resetWrites: () => {
      writes = {};
    },
    getWrites: () => writes,
  };
}

// Runs fn twice; returns the write set from the SECOND pass.
function secondPassWrites(item, fn) {
  fn();
  item.resetWrites();
  fn();
  return item.getWrites();
}

// ── showHideFields ───────────────────────────────────────────────────────────

const ITEM_SHAPES = {
  "melee weapon": {
    type: "melee weapon",
    subtype: "Martial Melee Weapon",
    damage: "1d8 slashing",
    weaponProperties: ["Versatile"],
  },
  "ranged weapon": {
    type: "ranged weapon",
    subtype: "Martial Ranged Weapon",
    damage: "1d8 piercing",
    normalRange: 150,
    maxRange: 600,
  },
  armor: {
    type: "armor",
    subtype: "Medium Armor",
    armorClass: 14,
    armorCategory: "Medium",
  },
  shield: { type: "shield", subtype: "Shield", armorClass: 2 },
  pack: { type: "pack", subtype: "Pack" },
  gear: { type: "gear", subtype: "Adventuring Gear" },
  consumable: { type: "gear", consumable: true, count: 3 },
  "magic item with uses": {
    type: "magic item",
    rarity: "rare",
    hasUseBtn: true,
    maxUses: 3,
    usesRemaining: 3,
    attunement: true,
    recharge: "1d3",
  },
  "item with spells": {
    type: "magic item",
    rarity: "rare",
    hasUseBtn: true,
    hasSpells: true,
    maxUses: 5,
    usesRemaining: 5,
    itemSpells: [],
  },
  scroll: {
    type: "magic item",
    subtype: "Scroll",
    rarity: "common",
    spellLevel: 1,
    consumable: true,
    hasUseBtn: true,
    maxUses: 1,
    usesRemaining: 1,
  },
  "empty item": {},
};

section("showHideFields — second pass writes nothing (onload loop guard)");
Object.entries(ITEM_SHAPES).forEach(([label, data]) => {
  const item = makeItem({ ...data });
  const writes = secondPassWrites(item, () => item.ctx.showHideFields());
  assert(label, Object.keys(writes), []);
});

section("showHideFields — converges after one pass from a hostile start");
{
  // Every field pre-set to the WRONG visibility: the first pass must correct
  // them, the second must be silent.
  const fields = {};
  [
    "damage",
    "armorClass",
    "attunement",
    "hasUseBtn",
    "maxUses",
    "usesRemaining",
    "recharge",
    "curseBox",
    "hasSpells",
    "promptCharges",
    "spell",
    "spellLevel",
  ].forEach((f) => {
    fields[f] = { hidden: true };
  });
  const item = makeItem(
    { type: "melee weapon", damage: "1d8 slashing" },
    fields,
  );
  item.ctx.showHideFields();
  const firstPass = Object.keys(item.getWrites()).length;
  assert("first pass corrects something", firstPass > 0, true);
  item.resetWrites();
  item.ctx.showHideFields();
  assert("second pass is silent", Object.keys(item.getWrites()), []);
}

section("showHideFields — only ever writes fields.* / tabs.*, never data.*");
{
  const item = makeItem({
    type: "magic item",
    rarity: "rare",
    hasUseBtn: true,
    hasSpells: true,
  });
  item.ctx.showHideFields();
  const dataWrites = Object.keys(item.getWrites()).filter((k) =>
    k.startsWith("data."),
  );
  assert("no data writes", dataWrites, []);
}

section("showHideFields — the Spells tab follows Has Spells");
{
  const on = makeItem({ type: "gear", hasUseBtn: true, hasSpells: true });
  on.ctx.showHideFields();
  assert("shown when checked", on.record.tabs.Spells.hidden, false);

  const off = makeItem({ type: "gear", hasUseBtn: true, hasSpells: false });
  off.ctx.showHideFields();
  assert("hidden when unchecked", off.record.tabs.Spells.hidden, true);

  // Has Spells itself only applies to an item with tracked uses, so an item
  // that is neither consumable nor "Has Use" keeps the tab closed even if the
  // flag somehow got set.
  const untracked = makeItem({ type: "gear", hasSpells: true });
  untracked.ctx.showHideFields();
  assert("hidden without uses", untracked.record.tabs.Spells.hidden, true);
}

// ── The onchange handlers ────────────────────────────────────────────────────

section("onMaxUsesChanged — idempotent");
{
  const item = makeItem({ hasUseBtn: true, usesRemaining: 3 });
  const writes = secondPassWrites(item, () => item.ctx.onMaxUsesChanged(5));
  assert("maxUses 5", Object.keys(writes), []);

  // maxUses of 1 hides the label and writes no label text.
  const single = makeItem({ hasUseBtn: true, usesRemaining: 1 });
  const w2 = secondPassWrites(single, () => single.ctx.onMaxUsesChanged(1));
  assert("maxUses 1", Object.keys(w2), []);
}

section("onMaxUsesChanged — label tracks usesRemaining, not maxUses");
{
  const item = makeItem({ hasUseBtn: true, usesRemaining: 2 });
  item.ctx.onMaxUsesChanged(9);
  assert(
    "label uses the remaining count",
    item.record.data.usesRemainingLabel,
    "Uses: 2",
  );
  // Falls back to maxUses when remaining isn't set yet.
  const fresh = makeItem({ hasUseBtn: true });
  fresh.ctx.onMaxUsesChanged(9);
  assert("falls back to maxUses", fresh.record.data.usesRemainingLabel, "Uses: 9");
}

section("onUsesRemainingChanged — idempotent");
{
  const item = makeItem({ hasUseBtn: true, maxUses: 9 });
  const writes = secondPassWrites(item, () =>
    item.ctx.onUsesRemainingChanged(4),
  );
  assert("usesRemaining 4", Object.keys(writes), []);
  assert("label written once", item.record.data.usesRemainingLabel, "Uses: 4");
}

// ── Spell scrolls ────────────────────────────────────────────────────────────

const FIREBALL = {
  _id: "spell-fireball",
  name: "Fireball",
  recordType: "spells",
  data: {
    level: "3",
    description: "<p>A bright streak...</p>",
    damage: "8d6 fire",
    isSave: true,
    savingThrow: "dexterity",
  },
};
const LIGHT = {
  _id: "spell-light",
  name: "Light",
  recordType: "spells",
  data: { level: "Cantrip", description: "<p>You touch an object...</p>" },
};

section("onScrollSpellChanged — derives the 2024 table row");
{
  const item = makeItem(
    { type: "magic item", subtype: "Scroll" },
    {},
    { "spell-fireball": FIREBALL },
  );
  item.ctx.onScrollSpellChanged(
    JSON.stringify({ _id: "spell-fireball", name: "Fireball" }),
  );
  const d = item.record.data;
  assert("level from the spell", d.spellLevel, 3);
  assert("rarity", d.rarity, "uncommon");
  assert("save DC", d.defaultSpellDC, 15);
  assert("attack bonus", d.defaultSpellAttack, 7);
  assert("casts on its own numbers", d.useOwnSpellcasting, false);
  assert("one use", d.maxUses, 1);
  assert("consumable", d.consumable, true);
  assert("has spells", d.hasSpells, true);
}

section("onScrollSpellChanged — the row is the whole spell record");
{
  const item = makeItem(
    { type: "magic item", subtype: "Scroll" },
    {},
    { "spell-fireball": FIREBALL },
  );
  item.ctx.onScrollSpellChanged(
    JSON.stringify({ _id: "spell-fireball", name: "Fireball" }),
  );
  const rows = item.record.data.itemSpells;
  assert("exactly one row", rows.length, 1);
  // The dropdown stub carries no level and no description — a row built from it
  // would render a blank level button and cast nothing.
  assert("row carries the level", rows[0].data.level, "3");
  assert("row carries the description", rows[0].data.description !== undefined, true);
  assert("row carries the damage", rows[0].data.damage, "8d6 fire");
  assert("cast at the scroll's level", rows[0].data.castLevel, 3);
  assert("costs one charge", rows[0].data.charges, 1);
}

section("onScrollSpellChanged — a cantrip scroll is level 0, not 'no level'");
{
  const item = makeItem(
    { type: "magic item", subtype: "Scroll" },
    {},
    { "spell-light": LIGHT },
  );
  item.ctx.onScrollSpellChanged(
    JSON.stringify({ _id: "spell-light", name: "Light" }),
  );
  assert("level 0", item.record.data.spellLevel, 0);
  assert("common", item.record.data.rarity, "common");
  assert("DC 13", item.record.data.defaultSpellDC, 13);
  // Charges are always 1 regardless of level — a 0-charge row would let the
  // scroll be read over and over.
  assert("still one charge", item.record.data.itemSpells[0].data.charges, 1);
}

section("onScrollSpellChanged — swapping the spell replaces the stale level");
{
  const item = makeItem(
    { type: "magic item", subtype: "Scroll", spellLevel: 3 },
    {},
    { "spell-light": LIGHT },
  );
  item.ctx.onScrollSpellChanged(
    JSON.stringify({ _id: "spell-light", name: "Light" }),
  );
  assert("level follows the new spell", item.record.data.spellLevel, 0);
  assert("rarity follows too", item.record.data.rarity, "common");
}

section("onScrollLevelChanged — rescribing at a higher level re-derives");
{
  const item = makeItem(
    { type: "magic item", subtype: "Scroll" },
    {},
    { "spell-fireball": FIREBALL },
  );
  item.ctx.onScrollSpellChanged(
    JSON.stringify({ _id: "spell-fireball", name: "Fireball" }),
  );
  item.record.data.spellLevel = 7;
  item.ctx.onScrollLevelChanged();
  const d = item.record.data;
  assert("rarity", d.rarity, "very rare");
  assert("save DC", d.defaultSpellDC, 18);
  assert("attack bonus", d.defaultSpellAttack, 10);
  // Level-only change moves the cast level on the EXISTING row rather than
  // rebuilding it from the dropdown stub, so the spell's own fields survive.
  assert("cast level moved", d.itemSpells[0].data.castLevel, 7);
  assert("row still holds the spell", d.itemSpells[0].data.damage, "8d6 fire");
}

section("onScrollLevelChanged — idempotent");
{
  const item = makeItem(
    { type: "magic item", subtype: "Scroll" },
    {},
    { "spell-fireball": FIREBALL },
  );
  item.ctx.onScrollSpellChanged(
    JSON.stringify({ _id: "spell-fireball", name: "Fireball" }),
  );
  const writes = secondPassWrites(item, () => item.ctx.onScrollLevelChanged());
  assert("second pass silent", Object.keys(writes), []);
}

section("onScrollSpellChanged — idempotent");
{
  const item = makeItem(
    { type: "magic item", subtype: "Scroll" },
    {},
    { "spell-fireball": FIREBALL },
  );
  const run = () =>
    item.ctx.onScrollSpellChanged(
      JSON.stringify({ _id: "spell-fireball", name: "Fireball" }),
    );
  const writes = secondPassWrites(item, run);
  assert("second pass silent", Object.keys(writes), []);
}

section("applyScrollDefaults — never edits the description");
{
  const item = makeItem(
    {
      type: "magic item",
      subtype: "Scroll",
      description: "<p>Publisher prose, DC 15, +7 to hit.</p>",
    },
    {},
    { "spell-fireball": FIREBALL },
  );
  item.ctx.onScrollSpellChanged(
    JSON.stringify({ _id: "spell-fireball", name: "Fireball" }),
  );
  assert(
    "untouched",
    item.record.data.description,
    "<p>Publisher prose, DC 15, +7 to hit.</p>",
  );
}

section("applyScrollDefaults — no spell yet derives nothing");
{
  const item = makeItem({ type: "magic item", subtype: "Scroll" });
  const writes = item.ctx.applyScrollDefaults("", {});
  assert("nothing to derive from", Object.keys(writes), []);
}

process.exit(summary());
