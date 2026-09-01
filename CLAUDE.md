# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication

- Answer at the altitude asked. Do not restate what the code already shows.
- Do not narrate steps as you take them, and do not explain reasoning that was not requested.
- Report what changed and anything that broke or is still outstanding. Skip the rest — no preamble, no recap of small edits, no summarizing the summary.

## Overview

This is a D&D 5e 2024 ruleset implementation for Realm VTT. The codebase consists of HTML files with embedded JavaScript that interact with the Realm VTT API.

**Important**: This ruleset uses the Realm VTT API (https://www.realmvtt.com/wiki/ruleset-editor-and-api). HTML and JavaScript must be written to conform to this API. Field values cannot be directly embedded into HTML - all data access must go through the API.

## Building & Deploying

This ruleset is authored as local source files and assembled into `realmdb.rulesets.json` by the **ruleset-compiler** (`../tools/ruleset-compiler/`).

**`realmdb.rulesets.json` is the compiled artifact — do not hand-edit it.** Edit the source files + `ruleset.config.json` and recompile.

See the `build-ruleset` skill for compiler commands, the `{file}` reference mapping, and the round-trip caveat.

## Architecture

### Data Path System

- `dataPath` - Current field's data path context
- `getNearestParentDataPath(dataPath)` - Navigate to parent object in data hierarchy
- `record` - The current record being edited
- Field paths use dot notation: `data.ancestries`, `fields.levelLabel.hidden`

### Modifier System - Critical for All Rolls

**Always check for relevant modifiers before making any roll** using `getEffectsAndModifiersForToken`:

```javascript
getEffectsAndModifiersForToken(
  record,
  modifierTypes,
  field,
  itemId,
  appliedById
);
```

**Parameters**:

- `record` - The character/token record
- `modifierTypes` - Array of modifier types (e.g., `['saveBonus', 'savePenalty']`)
- `field` - **Third parameter (often required)** - The relevant field/context (e.g., 'fortitude', 'dex', 'perception')
- `itemId` - Fourth parameter - Only for attack rolls with specific items
- `appliedById` - Fifth parameter - Only when checking for effects from specific tokens

**Implementation Pattern**:

1. Always make TWO modifier checks:

   - Specific modifiers for the roll type
   - General modifiers using `['allBonus', 'allPenalty']` with the relevant attribute

2. Example for saving throws:

```javascript
// Get save-specific modifiers (e.g., fortitude bonus)
const saveMods = getEffectsAndModifiersForToken(
  record,
  ["saveBonus", "savePenalty"],
  saveType // 'fortitude', 'reflex', or 'will'
);

// Get attribute-based all modifiers
const allMods = getEffectsAndModifiersForToken(
  record,
  ["allBonus", "allPenalty"],
  attribute // 'con' for fort, 'dex' for reflex, 'wis' for will
);
```

**Note**: The field parameter may not be relevant for all modifier types, but include it when there's a relevant context.

### UI Conventions

- Lists use `_id` field with `generateUuid()` for unique identifiers
- Trait objects structure: `{ _id, name, identified, data }`
- Hidden field control via `fields.[fieldname].hidden` properties
- Conditional visibility based on data values

## Development Guidelines

### Working with HTML Files

1. All JavaScript must be within `<script>` tags in the HTML files
2. Functions can reference the global `record`, `dataPath`, and `api` objects
3. Use `api.setValues()` for all data modifications - never modify data directly
4. Always provide callbacks when chaining operations that depend on data updates

Fields such as `onload` and `onchange` only work on Realm VTT field HTML, not on plain elements like `div` or `span`.

### Adding New Features

1. Check existing patterns in similar files (e.g., other `-main.html` or `-list.html` files)
2. Use `generateUuid()` when adding items to lists
3. Implement `showHideFields()` for dynamic UI elements
4. Handle drag-and-drop via `onDrop()` functions

### Modifying Game Mechanics

1. Core mechanics are in `rollhandlers/common.js`
2. Proficiency calculations, ability scores, and modifiers are centralized
3. Use `onAddEditFeature()` to trigger recalculations after data changes

### Data Structure

- Character data is nested under `record.data`
- UI state is under `record.fields`
- Lists (traits, features, etc.) typically have both array and object representations
- Always check for existing data before initializing defaults

## Realm VTT API Reference

See the `realm-vtt-api` skill for the API surface (data management, dice rolling, token management), the roll-type and metadata rules, and recipes for adding character options, calculations, and UI components.

## Language

All writing uses **American English**. This covers UI copy, marketing text, docs,
comments, commit messages, and anything else that ships. No British English:
write "color" not "colour", "organization" not "organisation", "math" not
"maths", "license" not "licence", "traveling" not "travelling", "gray" not
"grey". No em dashes in user-facing copy either.
