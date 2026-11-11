#!/usr/bin/env node
// Attunement counter and limit (data.attunedCount / data.maxAttunedItems).
//
// The count includes only items that require attunement and are flagged
// attuned. The limit is 3 plus every active "Max Attuned Items" modifier.
// onItemAttunedFor recounts with the toggled item's new value, because
// `record` can still hold the pre-change flag, and warns past the limit.
//
// Run with: node tests/test-attunement-limit.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const { getAttunedCount, getMaxAttunedItems, mergeAttunementFields } = ctx;

function ring(name, attuned, attunement = true) {
  return { name, data: { type: "wondrous", attunement, attuned } };
}

function feature(value, active = true) {
  return {
    name: "Magic Item Adept",
    data: {
      modifiers: [
        { data: { type: "maxAttunedItems", valueType: "number", value, active } },
      ],
    },
  };
}

section("getAttunedCount");

ctx.record.data = {
  inventory: [
    ring("Ring A", "true"),
    ring("Ring B", "false"),
    ring("Cloak", "true"),
    ring("Mundane, flagged attuned", "true", false),
  ],
};
assert("counts attuned items that require attunement", getAttunedCount(ctx.record), 2);
assert(
  "override counts the toggled item's new value",
  getAttunedCount(ctx.record, { index: 1, value: "true" }),
  3,
);
assert(
  "override can un-attune",
  getAttunedCount(ctx.record, { index: 0, value: "false" }),
  1,
);
assert("empty inventory is 0", getAttunedCount({ data: {} }), 0);

section("attunement slots per item");

ctx.record.data = {
  inventory: [
    { name: "Resonant", data: { attunement: true, attuned: "true", attunementExempt: true } },
    {
      name: "Walking Chicken Hut",
      data: {
        attunement: true,
        attuned: "true",
        modifiers: [{ data: { type: "attunementSlots", valueType: "number", value: "1", active: true } }],
      },
    },
    { name: "Ring", data: { attunement: true, attuned: "true" } },
  ],
};
assert("exempt item is free, +1 item uses two slots", getAttunedCount(ctx.record), 3);
ctx.record.data.inventory[1].data.attuned = "false";
assert("un-attuned +1 item uses nothing", getAttunedCount(ctx.record), 1);

section("getMaxAttunedItems");

ctx.record.data = { inventory: [] };
assert("base limit is 3", getMaxAttunedItems(ctx.record), 3);
ctx.record.data = { inventory: [], features: [feature("1"), feature("2")] };
assert("modifiers add to the limit", getMaxAttunedItems(ctx.record), 6);
ctx.record.data = { inventory: [], features: [feature("1", false)] };
assert("inactive modifier is ignored", getMaxAttunedItems(ctx.record), 3);

section("mergeAttunementFields");

ctx.record.data = {
  inventory: [ring("A", "true"), ring("B", "true"), ring("C", "true"), ring("D", "true")],
};
let values = {};
mergeAttunementFields(ctx.record, values);
assert("sets attunedCount", values["data.attunedCount"], 4);
assert("sets maxAttunedItems", values["data.maxAttunedItems"], 3);
assert("shows over-limit banner", values["fields.attunementOverLimit.hidden"], false);
ctx.record.data.features = [feature("1")];
values = {};
mergeAttunementFields(ctx.record, values);
assert("banner hidden at the limit", values["fields.attunementOverLimit.hidden"], true);

section("onItemAttunedFor — stale record, warning");

ctx.record.data = {
  inventory: [ring("A", "true"), ring("B", "true"), ring("C", "true"), ring("D", "false")],
};
const fresh = ring("D", "true");
let written = null;
let notified = null;
ctx.api.getValue = (path) => (path === "data.inventory.3" ? fresh : null);
ctx.api.setValues = (v) => {
  if (!written) written = v;
};
ctx.api.showNotification = (msg) => {
  notified = msg;
};
ctx.onItemAttunedFor("data.inventory.3");
assert("count uses the new flag despite the stale record", written["data.attunedCount"], 4);
assert("warns when attuning past the limit", typeof notified, "string");

written = null;
notified = null;
ctx.record.data.inventory[3] = ring("D", "true");
const unattuned = ring("D", "false");
ctx.api.getValue = (path) => (path === "data.inventory.3" ? unattuned : null);
ctx.onItemAttunedFor("data.inventory.3");
assert("un-attuning lowers the count", written["data.attunedCount"], 3);
assert("no warning when un-attuning", notified, null);

summary();
