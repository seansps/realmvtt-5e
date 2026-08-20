#!/usr/bin/env node
// Tests for predicate-gated senses modifiers.
//
// recalcSenses re-derives data.senses from data.sensesBase plus every grant that
// currently applies, so gating _collectSenseGrants on the modifier's predicate is
// enough to make a sense appear and disappear with a toggle — no delta tracking.
//
// Run with: node tests/test-senses-predicate.js

const { createSandbox, loadScript } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
loadScript(ctx, "feature-utils.js");
const { recalcSenses } = ctx;

function makeChar({ predicate, toggleActive, base = "Darkvision 60" } = {}) {
  const mod = { data: { type: "senses", value: "Tremorsense 30" } };
  if (predicate) mod.data.predicate = predicate;
  return {
    effects: [],
    data: {
      sensesBase: base,
      senses: base,
      toggles: [
        { name: "Beast Sense", data: { field: "beast-sense", active: !!toggleActive } },
      ],
      features: [{ name: "Beast Sense", data: { modifiers: [mod] } }],
      inventory: [],
    },
  };
}

function derive(rec) {
  const fields = {};
  recalcSenses(fields, rec);
  return fields["data.senses"] !== undefined ? fields["data.senses"] : rec.data.senses;
}

section("senses — toggle predicate");

assert(
  "toggle off: sense withheld",
  derive(makeChar({ predicate: "beast-sense", toggleActive: false })),
  "Darkvision 60",
);
assert(
  "toggle on: sense granted",
  derive(makeChar({ predicate: "beast-sense", toggleActive: true })),
  "Darkvision 60, Tremorsense 30",
);
assert(
  "no predicate: sense always granted",
  derive(makeChar({})),
  "Darkvision 60, Tremorsense 30",
);

section("senses — removal is a re-derive, not a delta");

// data.senses already carries the grant from when the toggle was on; flipping it
// off must take it back out rather than leaving it stuck on the sheet.
const stuck = makeChar({ predicate: "beast-sense", toggleActive: false });
stuck.data.senses = "Darkvision 60, Tremorsense 30";
stuck.data.sensesDerived = "Darkvision 60, Tremorsense 30";
assert("toggling off removes the granted sense", derive(stuck), "Darkvision 60");

section("senses — other predicate vocabularies");

assert(
  "feature:<slug> present",
  derive({
    effects: [],
    data: {
      sensesBase: "",
      senses: "",
      toggles: [],
      features: [
        { name: "Keen Senses", data: {} },
        {
          name: "Grant",
          data: {
            modifiers: [
              {
                data: {
                  type: "senses",
                  value: "Blindsight 10",
                  predicate: "feature:keen-senses",
                },
              },
            ],
          },
        },
      ],
      inventory: [],
    },
  }),
  "Blindsight 10",
);
assert(
  "feature:<slug> absent",
  derive({
    effects: [],
    data: {
      sensesBase: "",
      senses: "",
      toggles: [],
      features: [
        {
          name: "Grant",
          data: {
            modifiers: [
              {
                data: {
                  type: "senses",
                  value: "Blindsight 10",
                  predicate: "feature:keen-senses",
                },
              },
            ],
          },
        },
      ],
      inventory: [],
    },
  }),
  "",
);

summary();
