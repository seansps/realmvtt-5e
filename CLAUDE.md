# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a D&D 5e 2024 ruleset implementation for Realm VTT. The codebase consists of HTML files with embedded JavaScript that interact with the Realm VTT API.

**Important**: This ruleset uses the Realm VTT API (https://www.realmvtt.com/wiki/ruleset-editor-and-api). HTML and JavaScript must be written to conform to this API. Field values cannot be directly embedded into HTML - all data access must go through the API.

## Building & Deploying (Ruleset Compiler)

This ruleset is authored as local source files and assembled into the single API payload `realmdb.rulesets.json` by the **ruleset-compiler** (`../tools/ruleset-compiler/`).

- **Source of truth**: [`ruleset.config.json`](ruleset.config.json) — defines the 33 record types, their tabs, and all `settings`. It references the HTML/JS source files via `{ "file": "relative/path" }` markers, which the compiler inlines.
- **Output**: `realmdb.rulesets.json` is the compiled artifact (and a server-normalized Mongo dump of the live ruleset). **Do not hand-edit it** — edit the source files + `ruleset.config.json` and recompile.

### How file references map

- **Record tabs** — `{ "name": "Main", "file": "character-main.html" }` → `{ "name": "Main", "layout": "<html>" }`
- **Roll types** — `settings.rollTypes[] = { "name": "attack", "file": "rollhandlers/attack.js" }` → `{ "name": "attack", "handleResult": "<js>" }`
- **Settings scripts** — `commonScript`, `onReroll`, `damage.damageScript`/`healingScript`, and `combatTracker` hooks (`onTokenAdd`, `onEncounterEnd`, `onTurnStart`, `onRollInitiative`, `onRollInitiativeGroup`) are `{ "file": "rollhandlers/*.js" }`.
- **Characters record extras** — `jsonImport.script`/`postScript` → `importers/dnd-beyond.js` / `importers/post-dnd-beyond.js`; `pdfExport.script` → `exporters/characters.js`; `wizard.steps[].layout` → `wizards/characters/step{1-4}.html`.
- The compiler only auto-resolves `{file}` refs inside record `tabs`, `jsonImport`, `pdfExport`, and `wizard.steps`; everything under `settings` is resolved generically.

### Commands

```bash
# Compile to a file (no upload) and inspect
node ../tools/ruleset-compiler/src/cli.js rulesets . --output /tmp/build.json

# Preview to stdout
node ../tools/ruleset-compiler/src/cli.js rulesets . --dry-run

# Compile and upload to the live ruleset by ID
node ../tools/ruleset-compiler/src/cli.js rulesets . -e you@example.com -p PASS -i <rulesetId>
```

Note the `rulesets` subcommand (not a bare directory argument).

### Round-trip caveat

Compiling reproduces `realmdb.rulesets.json` content-exactly **except**: server-only fields (`_id`, `ownerId`, `createdAt`, `updatedAt`) the compiler can't emit, and ~32 inert default keys (`filters: {}` on list records, default `hideFromCompendium`) that the compiler fills via `fillRecordDefaults` but the server strips on save. Both are harmless — the server re-normalizes on upload.

## Architecture

### File Structure

The ruleset is organized by game entity types and UI components:

- **Character sheets**: `characters-*.html` - Main character sheet and its tabs (skills, features, notes)
- **Entity definitions**: `ancestry-*.html`, `class-*.html`, `heritage-*.html`, `backgrounds-*.html`, `feats-*.html`, `features-*.html`, `items-*.html`
- **List components**: `*-list.html` files - Reusable list components for various data types
- **Rules**: `*-rules.html` files - Rule-specific UI and logic
- **Shared logic**: `rollhandlers/common.js` - Core game mechanics and utility functions

### Key API Patterns

The Realm VTT API provides these core functions used throughout:

#### Data Management

- `api.getValue(path)` - Get value at data path
- `api.setValues(object, callback)` - Set multiple values with optional callback
- `api.setHidden(field, boolean, callback)` - Show/hide UI elements
- `api.showPrompt()` - Display selection dialogs
- `api.showNotification()` - Display user notifications

#### Dice Rolling

**Important**: Always use `api.promptRoll()` for standard rolls to give players control over modifiers. Only use `api.roll()` for quick one-off rolls that don't need modifier prompts.

- `api.promptRoll(name, roll, modifiers, metadata, rollType)` - **Primary rolling method** - Opens modifier prompt for players

  ```javascript
  api.promptRoll(
    "Fire Sword",
    "1d6 piercing + 1 piercing",
    [
      {
        name: "Fire Enchantment",
        type: "fire",
        value: "1d4 fire",
        active: true,
      },
    ],
    { isAttack: true },
    "damage"
  );
  ```

- `api.roll(roll, metadata, rollType)` - Direct roll without prompting (use sparingly)

  ```javascript
  api.roll("2d20dl1 + 5", { rollName: "Attack Roll" }, "attack");
  ```

- `api.rollInstant(roll)` - Immediate roll returning result without animation

  ```javascript
  const result = api.rollInstant("1d20");
  console.log(`Rolled a ${result.total}`);
  ```

- `api.promptRollForToken(token, name, roll, modifiers, metadata, rollType)` - Roll prompt for specific token (mainly for combat tracking)
  ```javascript
  api.promptRollForToken(
    token,
    "Dexterity Save",
    "1d20",
    [{ name: "Dex Mod", type: "", value: tokenDexMod }],
    { saveDC: 15 },
    "save"
  );
  ```

**Roll Type Parameter**: Defaults to "chat" but should match Roll Types defined in Settings (e.g., "attack", "damage", "save", "skill", etc.)

**Metadata Note**: Keep metadata lightweight - pass IDs instead of entire records to avoid performance issues.

#### Token Management

- `api.getToken()` - Returns current contextual token (priority: data context → selected → player's token → record token)
- `api.getSelectedTokens()` - Returns all selected tokens
- `api.getSelectedOwnedTokens()` - Returns selected tokens owned by player (or default token if none)
- `api.getSelectedOrDroppedToken()` - Returns dropped token, selected tokens, player's character, or empty array (in priority order)
- `api.getTargets()` - Gets targeted tokens with distances
- `api.getOtherTokens()` - All tokens except the contextual one
- `api.getDistance(token1, token2)` - Calculate distance between tokens
- `api.isOwner(token)` - Check if current user owns token (GM always returns true)

### Data Path System

- `dataPath` - Current field's data path context
- `getNearestParentDataPath(dataPath)` - Navigate to parent object in data hierarchy
- `record` - The current record being edited
- Field paths use dot notation: `data.ancestries`, `fields.levelLabel.hidden`

### Common Functions

Located primarily in `rollhandlers/common.js`:

- `generateUuid()` - Create unique identifiers for list items
- `onAddEditFeature(record, callback)` - Recalculate character features and abilities
- `calculateAbilityBoosts(record)` - Handle ability score calculations
- `updateProficiencies(record, valuesToSet)` - Update skill/save proficiencies
- `calculateProficiencyBonus(record, training)` - Calculate proficiency bonuses
- `rollSave(record, type)` - Roll a saving throw with proper modifiers

#### Modifier System - Critical for All Rolls

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

### Event Handlers

- `onDrop(type, recordLink)` - Handle drag-and-drop of game entities
- `showHideFields()` - Dynamic UI visibility based on data state
- Various `onDrop*` functions for specific entity types (ancestry, class, heritage, etc.)

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

## Common Tasks

### Adding a new character option (ancestry, class, feat, etc.)

1. Create the appropriate `-main.html` file following existing patterns
2. Implement `showHideFields()` for conditional UI
3. Add drag-and-drop support if needed
4. Update character sheet handlers to accept the new type

### Modifying character calculations

1. Locate the calculation in `rollhandlers/common.js`
2. Update the relevant `calculate*` or `update*` function
3. Ensure `onAddEditFeature()` triggers the recalculation

### Adding UI components

1. Create as a `-list.html` file if reusable
2. Follow the pattern of checking `getNearestParentDataPath()` for context
3. Use `api.setValues()` for all data updates
4. Implement proper `onchange` handlers
- memorize Fields such as onload and onchange only work on Realm VTT field HTML, not things like divs or spans.