#!/usr/bin/env node
// Tests for item Spells-tab rows.
//
// A row is a SPELL (dropped, carries the spell record) or an ACTION (added, has
// data.actionText). The distinction is inferred from the spell's own fields, so
// rows authored before actions existed still read as spells — the point of the
// design is that no backfill is needed.
//
// Run with: node tests/test-item-actions.js

const { createSandbox } = require("./sandbox");
const { assert, section, summary } = require("./test-helpers");

const ctx = createSandbox();
const { isItemSpellRow, getItemRowCharges } = ctx;

// ── Row classification ───────────────────────────────────────────────────────

section("isItemSpellRow — rows that predate actions still read as spells");
{
  assert(
    "dropped spell record",
    isItemSpellRow({ recordType: "spells", name: "Fireball", data: { level: "3" } }),
    true,
  );
  // recordType is NOT the discriminator — every row carries "spells" so the list
  // renders it with a portrait and name field, action rows included.
  assert(
    "action row also carries recordType spells",
    isItemSpellRow({
      recordType: "spells",
      name: "Ball Lightning",
      data: { charges: 2, actionText: "<p>x</p>" },
    }),
    false,
  );
  assert(
    "actionText wins even if a level slipped in",
    isItemSpellRow({
      recordType: "spells",
      name: "Ball Lightning",
      data: { level: "3", actionText: "<p>x</p>" },
    }),
    false,
  );
  assert(
    "blank actionText does not make it an action",
    isItemSpellRow({ recordType: "spells", name: "Fireball", data: { level: "3", actionText: "   " } }),
    true,
  );
  assert(
    "row with only a level",
    isItemSpellRow({ name: "Light", data: { level: "Cantrip" } }),
    true,
  );
  assert(
    "row with only a description",
    isItemSpellRow({ name: "Augury", data: { description: "<p>x</p>" } }),
    true,
  );
  assert(
    "level 0 cantrip still a spell",
    isItemSpellRow({ name: "Light", data: { level: 0, charges: 0 } }),
    true,
  );
}

section("isItemSpellRow — an added row with no spell fields is an action");
{
  assert("blank added row", isItemSpellRow({ name: "New Action", data: {} }), false);
  assert(
    "action with body and charges",
    isItemSpellRow({ name: "Ball Lightning", data: { charges: 2, actionText: "<p>x</p>" } }),
    false,
  );
  assert("no data at all", isItemSpellRow({ name: "x" }), false);
  assert("undefined row", isItemSpellRow(undefined), false);
}

// ── Charge cost ──────────────────────────────────────────────────────────────

section("getItemRowCharges — a row with no chargesMax is a flat cost");
{
  assert("charges 2", getItemRowCharges({ data: { charges: 2 } }), { min: 2, max: 2, isRange: false });
  assert("charges 0 is free", getItemRowCharges({ data: { charges: 0 } }), { min: 0, max: 0, isRange: false });
  // Legacy rows never had chargesMax; the default must stay 1, as before.
  assert("no charges field", getItemRowCharges({ data: {} }), { min: 1, max: 1, isRange: false });
  assert("no data", getItemRowCharges({}), { min: 1, max: 1, isRange: false });
}

section("getItemRowCharges — chargesMax above charges makes a range");
{
  assert("1 to 3", getItemRowCharges({ data: { charges: 1, chargesMax: 3 } }), { min: 1, max: 3, isRange: true });
  assert("0 to 2", getItemRowCharges({ data: { charges: 0, chargesMax: 2 } }), { min: 0, max: 2, isRange: true });
}

section("getItemRowCharges — a max at or below the cost is not a range");
{
  assert("equal", getItemRowCharges({ data: { charges: 2, chargesMax: 2 } }), { min: 2, max: 2, isRange: false });
  assert("below is clamped up", getItemRowCharges({ data: { charges: 3, chargesMax: 1 } }), { min: 3, max: 3, isRange: false });
  assert("blank max", getItemRowCharges({ data: { charges: 2, chargesMax: "" } }), { min: 2, max: 2, isRange: false });
}

section("getItemRowCharges — negatives floor at zero");
{
  assert("negative cost", getItemRowCharges({ data: { charges: -3 } }), { min: 0, max: 0, isRange: false });
}

// ── The action card ──────────────────────────────────────────────────────────

function captureAction(row, amount, itemName = "Ring of Shooting Stars") {
  let sent = null;
  let tags = null;
  ctx.api.sendMessage = (message, _a, _b, t) => {
    sent = message;
    tags = t;
  };
  ctx.api.getValue = (path) => (path.endsWith(".name") ? itemName : null);
  ctx.useItemAction("data.inventory.0", row, amount);
  return { sent, tags };
}

section("useItemAction — {charges} is replaced with the amount spent");
{
  const row = { name: "Shooting Stars", data: { actionText: "You fire {charges} motes for {charges}d4." } };
  assert("substituted everywhere", captureAction(row, 3).sent.includes("You fire 3 motes for 3d4."), true);
  assert("a different amount", captureAction(row, 1).sent.includes("You fire 1 motes for 1d4."), true);
}

section("useItemAction — the card is headed by the action name");
{
  const { sent } = captureAction({ name: "Ball Lightning", data: { actionText: "<p>x</p>" } }, 2);
  assert("heading", sent.startsWith("#### "), true);
  assert("names the action", sent.includes("Ball Lightning"), true);
}

section("useItemAction — tags carry the item and the charges spent");
{
  const { tags } = captureAction({ name: "Ball Lightning", data: { actionText: "x" } }, 2);
  const names = tags.map((t) => t.name);
  assert("item name tag", names.includes("Ring of Shooting Stars"), true);
  assert("charge tag", names.includes("2 charges"), true);

  const one = captureAction({ name: "Faerie Fire", data: { actionText: "x" } }, 1);
  assert("singular charge", one.tags.map((t) => t.name).includes("1 charge"), true);

  const free = captureAction({ name: "Light", data: { actionText: "x" } }, 0);
  assert("no charge tag at zero", free.tags.length, 1);
}

section("useItemAction — an empty body still posts a card");
{
  const { sent } = captureAction({ name: "Bare", data: {} }, 1);
  assert("headed", sent.includes("Bare"), true);
}

process.exit(summary());
