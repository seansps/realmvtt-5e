#!/usr/bin/env node

const fs = require("fs");
const vm = require("vm");
const { assert, section, summary } = require("./test-helpers");

const html = fs.readFileSync(__dirname + "/../npcs-main.html", "utf8");
const script = html.slice(
  html.indexOf("<script>") + "<script>".length,
  html.indexOf("</script>"),
);
const context = vm.createContext({ console });
new vm.Script(script, { filename: "npcs-main.html" }).runInContext(context);

section("mergeConditionImmunities");

assert(
  "adds Level Up condition immunities",
  context.mergeConditionImmunities("fire, poison", "charmed, frightened"),
  "fire, poison; charmed, frightened",
);

assert(
  "does not add them a second time",
  context.mergeConditionImmunities(
    "fire, poison; charmed, frightened",
    "charmed, frightened",
  ),
  "fire, poison; charmed, frightened",
);

assert(
  "matches existing condition immunities case-insensitively",
  context.mergeConditionImmunities(
    "fire, poison; Charmed, Frightened",
    "charmed, frightened",
  ),
  "fire, poison; Charmed, Frightened",
);

assert(
  "removes duplicates left by previous loads",
  context.mergeConditionImmunities(
    "fire, poison; charmed, frightened; charmed, frightened",
    "charmed, frightened",
  ),
  "fire, poison; charmed, frightened",
);

assert(
  "leaves 5e NPC immunities unchanged when no Level Up field exists",
  context.mergeConditionImmunities("fire, poison", ""),
  "fire, poison",
);

process.exit(summary());
