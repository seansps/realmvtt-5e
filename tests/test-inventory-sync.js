#!/usr/bin/env node
// Regression test for the grid-inventory equip bug.
//
// The grid's equip/attune actions run their handler from an api.setValue
// callback, which still sees the pre-change `record` snapshot. getBestEquippedArmor
// reads record.data.inventory directly, so AC came out one step behind — still
// counting armor that was just unequipped, or missing armor just equipped.
// syncInventoryItemValue mirrors the new value onto the snapshot first.
//
// Run with: node tests/test-inventory-sync.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const { syncInventoryItemValue, getBestEquippedArmor } = ctx;

function seed(carried) {
  ctx.record.data = {
    inventory: [
      {
        name: "Plate Armor",
        data: { type: "armor", armorClass: 18, carried },
      },
    ],
  };
}

section("syncInventoryItemValue — equip");

seed("carried");
assert("stale snapshot: unequipped armor gives no AC", getBestEquippedArmor().ac, 0);
syncInventoryItemValue("data.inventory.0", "carried", "equipped");
assert("after sync: newly equipped armor counts", getBestEquippedArmor().ac, 18);

section("syncInventoryItemValue — unequip");

seed("equipped");
assert("stale snapshot: equipped armor gives AC", getBestEquippedArmor().ac, 18);
syncInventoryItemValue("data.inventory.0", "carried", "carried");
assert("after sync: newly unequipped armor is dropped", getBestEquippedArmor().ac, 0);

section("syncInventoryItemValue — guards");

seed("equipped");
syncInventoryItemValue("data.inventory.9", "carried", "carried");
assert("out-of-range index is a no-op", getBestEquippedArmor().ac, 18);
syncInventoryItemValue("data.someItem", "carried", "carried");
assert("non-inventory path is a no-op", getBestEquippedArmor().ac, 18);
syncInventoryItemValue("", "carried", "carried");
assert("empty path is a no-op", getBestEquippedArmor().ac, 18);

section("syncInventoryItemValue — leaves sibling keys alone");

seed("carried");
syncInventoryItemValue("data.inventory.0", "carried", "equipped");
assert(
  "armorClass survives the merge",
  ctx.record.data.inventory[0].data.armorClass,
  18,
);
assert("name survives the merge", ctx.record.data.inventory[0].name, "Plate Armor");

summary();
