# D&D 5th Edition (2024) Ruleset User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Creating a Character](#creating-a-character)
4. [The Character Sheet](#the-character-sheet)
5. [Managing Spells](#managing-spells)
6. [Managing Inventory & Equipment](#managing-inventory--equipment)
7. [Feats, Invocations & Features](#feats-invocations--features)
8. [Creating and Managing NPCs](#creating-and-managing-npcs)
9. [Creating Content for Your Campaign](#creating-content-for-your-campaign)
10. [Combat & Rolling Dice](#combat--rolling-dice)
11. [Advanced Features](#advanced-features)
12. [Tips & Tricks](#tips--tricks)

---

## Introduction

Welcome to the **D&D 5th Edition (2024)** ruleset for Realm VTT! This ruleset implements the updated 2024 rules for Dungeons & Dragons, including support for:

- Full character creation wizard with multiple ability score generation methods
- Automated dice rolling with modifiers
- Spell management with slot tracking
- Inventory system with weight calculations
- NPC stat blocks with legendary actions, lair actions, and more
- Weapon Masteries from the 2024 rules
- Wild Shape and Polymorph support
- And much more!

This guide will walk you through everything you need to know to use the ruleset effectively.

---

## Getting Started

### Accessing the Ruleset

When you create or join a campaign using the D&D 5th Edition (2024) ruleset, all the character sheets, compendiums, and game mechanics are automatically available.

[SCREENSHOT PLACEHOLDER: Campaign creation screen showing ruleset selection]

### Key Concepts

- **Records**: Everything in Realm VTT is a "record" - characters, NPCs, items, spells, feats, etc.
- **Compendiums**: Collections of records that can be searched and dragged onto character sheets
- **Drag-and-Drop**: Most content is added to characters by dragging from compendiums or other sources

---

## Creating a Character

### Using the Character Creation Wizard

When you create a new character, a 4-step wizard guides you through the process:

#### Step 1: Ability Scores

[SCREENSHOT PLACEHOLDER: Character wizard Step 1 - Ability Scores screen]

Choose from three methods to determine your ability scores:

1. **Manual Entry** - Type your scores directly (useful for pre-rolled stats or custom arrays)

2. **Roll 4d6 Drop Lowest** - Click the dice button next to each ability to roll 4d6 and drop the lowest die

   [SCREENSHOT PLACEHOLDER: Rolling ability scores with dice buttons visible]

3. **Point Buy** - Allocate 27 points across your abilities
   - Each ability starts at 8 (costs 0 points)
   - Raising to 9 costs 1 point, 10 costs 2, etc.
   - Maximum of 15 before racial bonuses
   - The system tracks your spent points and shows errors if you exceed limits

   [SCREENSHOT PLACEHOLDER: Point Buy system showing spent points counter]

#### Step 2: Class Selection

[SCREENSHOT PLACEHOLDER: Character wizard Step 2 - Class selection dropdown]

Select your class from the dropdown menu. This will:
- Set your hit die
- Apply saving throw proficiencies
- Prompt you to select skill proficiencies based on your class options
- Set your spellcasting ability (if applicable)

> **Tip**: After selecting your class, a prompt appears to choose your skill proficiencies. Make your selections carefully!

[SCREENSHOT PLACEHOLDER: Skill proficiency selection prompt after choosing a class]

#### Step 3: Background Selection

[SCREENSHOT PLACEHOLDER: Character wizard Step 3 - Background selection]

Select your background to:
- Gain additional skill proficiencies
- Receive your Origin Feat automatically
- Get your ability score increases applied

#### Step 4: Species Selection

[SCREENSHOT PLACEHOLDER: Character wizard Step 4 - Species selection]

Select your species to apply:
- Creature type
- Size
- Speed
- Special senses
- Racial features

> **Important**: After completing the wizard, you'll need to manually:
> - Add spells by dragging them from the Spells compendium to your Actions tab
> - Add equipment by dragging items from the Items compendium to your Inventory tab
> - Review your Origin Feat for any additional choices

---

## The Character Sheet

The character sheet has six main tabs:

### Main Tab

[SCREENSHOT PLACEHOLDER: Character sheet Main tab overview]

The Main tab displays your core statistics:

- **Portrait**: Click to upload a character image
- **Ability Scores**: STR, DEX, CON, INT, WIS, CHA with modifiers
- **Saving Throws**: Proficient saves are automatically calculated
- **Hit Points**: Current, Maximum, and Temporary HP
- **Armor Class**: Automatically calculated based on equipped armor
- **Initiative**: Click the dice button to roll
- **Speed**: Your movement speed
- **Proficiency Bonus**: Updates automatically based on level
- **Experience Points**: Track your XP here
- **Hit Dice**: Shows available hit dice by class

[SCREENSHOT PLACEHOLDER: Ability scores section with roll buttons highlighted]

#### Rolling Ability Checks and Saves

Click the dice icon next to any ability modifier to make an ability check, or next to a saving throw to make a save. The system automatically includes:
- Your ability modifier
- Proficiency bonus (for proficient saves)
- Any active effects or bonuses

### Skills Tab

[SCREENSHOT PLACEHOLDER: Skills tab showing all 18 skills]

The Skills tab shows all 18 D&D skills with:

- **Proficiency Toggle**: Click to cycle through Unproficient, Half-Proficient, Proficient, and Expertise
- **Ability**: Can be changed for variant skill checks (e.g., Strength-based Intimidation)
- **Modifier**: Automatically calculated
- **Roll Button**: Click to roll the skill check

[SCREENSHOT PLACEHOLDER: Close-up of skill with proficiency options visible]

#### Custom Skills

At the bottom of the Skills tab, you can add custom skills for campaign-specific abilities or unusual checks.

### Actions Tab

[SCREENSHOT PLACEHOLDER: Actions tab showing spell slots and spell list]

The Actions tab manages your spells and spell slots:

- **Spell Slots**: Track remaining slots for levels 1-9
- **Cantrips**: Always available spells at the top
- **Leveled Spells**: Organized by spell level

#### Adding Spells

1. Open the **Spells** compendium from the sidebar
2. Find the spell you want
3. **Drag and drop** the spell onto the Actions tab

[SCREENSHOT PLACEHOLDER: Dragging a spell from the compendium to the Actions tab]

The spell will automatically appear at the correct level section.

### Features Tab

[SCREENSHOT PLACEHOLDER: Features tab showing Feats and Class Features sections]

The Features tab displays:

- **Feats**: Your Origin Feat and any additional feats
- **Class Features**: Gained from your class and subclass
- **Classes/Subclasses**: Shows your class levels
- **Weapon Masteries**: Select which weapons you've mastered (2024 rules)
- **Resistances, Immunities, and Vulnerabilities**: Damage type modifiers
- **Shape-shifting**: Wild Shape and Polymorph support

#### Adding Feats (and Eldritch Invocations)

1. Open the **Feats** compendium from the sidebar
2. Find the feat you want
3. **Drag and drop** the feat onto the Features tab

[SCREENSHOT PLACEHOLDER: Dragging a feat to the Features tab]

> **Note**: Eldritch Invocations are implemented as feats with the type "Eldritch Invocation (Warlock Only)". Add them to your Features tab the same way you add feats!

[SCREENSHOT PLACEHOLDER: Feat dropdown showing Eldritch Invocation type]

### Inventory Tab

[SCREENSHOT PLACEHOLDER: Inventory tab showing items and currency]

The Inventory tab manages your equipment:

- **Equipment List**: All carried items with quantity and weight
- **Currency**: CP, SP, EP, GP, PP tracking
- **Total Weight**: Automatically calculated (optional coin weight)
- **Equipment Slots**: Main hand, Off hand, Armor

#### Adding Items

1. Open the **Items** compendium from the sidebar
2. Find the item you want
3. **Drag and drop** the item onto the Inventory tab

[SCREENSHOT PLACEHOLDER: Dragging an item from the compendium to inventory]

> **Tip**: If you drag the same item multiple times, it will increase the quantity rather than creating duplicates!

#### Item Packs

Item Packs (like "Explorer's Pack" or "Dungeoneer's Pack") automatically unpack their contents when dropped:
- All items are added to your inventory
- Any currency in the pack is added to your purse

### Notes Tab

[SCREENSHOT PLACEHOLDER: Notes tab with rich text editor]

The Notes tab provides a rich text editor for:
- Character backstory
- Session notes
- Appearance description
- Goals and bonds
- Any other notes you want to keep

---

## Managing Spells

### Spell Slots

[SCREENSHOT PLACEHOLDER: Spell slot counters at the top of the Actions tab]

Spell slots are displayed as counters at the top of the Actions tab:
- Click the **-** button to expend a slot
- Click the **+** button to recover a slot
- The counter shows current/maximum slots

### Casting Spells

[SCREENSHOT PLACEHOLDER: A spell entry with the cast button highlighted]

Each spell in your list shows:
- Spell name and level
- School of magic
- Casting time, range, components, duration
- Full description

Click on a spell to expand it and see all details. Use the cast button to roll any associated attacks or damage.

### Preparing Spells

For classes that prepare spells, use the preparation toggle on each spell to mark which spells you have prepared for the day.

[SCREENSHOT PLACEHOLDER: Spell with the "prepared" toggle visible]

---

## Managing Inventory & Equipment

### Item Properties

Each item in your inventory shows:

[SCREENSHOT PLACEHOLDER: Expanded inventory item showing all properties]

- **Quantity**: How many you have
- **Weight**: Per item (total calculated automatically)
- **Carried Status**: Carried, Dropped, or Stored
- **Attunement**: For magic items requiring attunement
- **Condition**: Note the item's condition

### Weapons in Inventory

Weapons show additional options:

[SCREENSHOT PLACEHOLDER: Weapon item with attack button and hand icons]

- **Attack Button**: Roll to attack with this weapon
- **Hand Icons**: Equip in main hand, off hand, or two-handed
- **Melee/Ranged Toggle**: For thrown weapons, switch between modes
- **Ammunition**: Track ammo count for ranged weapons

### Equipping Armor

Armor items can be set to your equipped armor slot, which automatically updates your AC calculation.

[SCREENSHOT PLACEHOLDER: Armor item being equipped]

### Weight and Encumbrance

The system tracks:
- Individual item weight
- Total carried weight
- Optional coin weight (50 coins = 1 lb)

[SCREENSHOT PLACEHOLDER: Total weight display at bottom of inventory]

---

## Feats, Invocations & Features

### Feats

Feats in the 2024 rules are categorized by type:

| Type | Description |
|------|-------------|
| **Origin Feat** | Gained from your background at level 1 |
| **General Feat** | Standard feats gained at various levels |
| **Fighting Style Feat** | Combat-focused feats for martial classes |
| **Epic Boon Feat** | Powerful feats for high-level characters |
| **Eldritch Invocation** | Warlock-only magical abilities |

[SCREENSHOT PLACEHOLDER: Feat creation screen showing type dropdown]

### Adding Eldritch Invocations

Warlock Eldritch Invocations are implemented as feats:

1. Open the **Feats** compendium
2. Filter or search for "Eldritch Invocation" or the specific invocation name
3. Drag the invocation to your **Features tab**

[SCREENSHOT PLACEHOLDER: Eldritch Invocation in the feats list with "Eldritch Invocation" type badge]

> **Note**: Invocations appear in your Feats section alongside other feats. They work identically but are marked as Warlock-only.

### Ability Score Increases

When you add a feat that grants ability score increases, a prompt will appear:

[SCREENSHOT PLACEHOLDER: ASI selection prompt when adding a feat]

Select which ability scores to increase. The system enforces the maximum (usually 20) automatically.

---

## Creating and Managing NPCs

### NPC Types

The NPC sheet supports three types:

| Type | Use For |
|------|---------|
| **Creature** | Monsters, beasts, humanoid enemies |
| **Vehicle** | Ships, carts, airships |
| **Trap** | Hazards and traps |

[SCREENSHOT PLACEHOLDER: NPC type dropdown]

### Creating an NPC

1. Create a new NPC record from the Records panel
2. Fill in the basic information:
   - Name and portrait
   - Type (Creature/Vehicle/Trap)
   - Size and creature type
   - Alignment

[SCREENSHOT PLACEHOLDER: NPC creation with basic fields filled in]

3. Set ability scores - modifiers and saves calculate automatically

[SCREENSHOT PLACEHOLDER: NPC ability scores section with roll buttons]

4. Add Skills, Speed, Senses, and Languages

5. Set the **Challenge Rating** - this automatically sets:
   - XP reward
   - Proficiency bonus
   - Level (for spellcasting calculations)

### Adding NPC Abilities

Use the checkboxes in the "Subsection Settings" to enable different ability sections:

[SCREENSHOT PLACEHOLDER: NPC subsection settings checkboxes]

| Section | Description |
|---------|-------------|
| **Traits** | Passive abilities (e.g., Pack Tactics) |
| **Actions** | Standard actions including attacks |
| **Bonus Actions** | Bonus action abilities |
| **Reactions** | Reaction abilities with counter |
| **Legendary Actions** | For boss monsters, with use counter |
| **Lair Actions** | Special actions in the creature's lair |

### NPC Actions

When adding actions, the system automatically parses:
- Attack bonuses from the description
- Damage formulas (e.g., "2d6+4 slashing")
- Recharge mechanics (e.g., "Recharge 5-6")
- Uses per day

[SCREENSHOT PLACEHOLDER: NPC action with attack roll and damage buttons]

### Legendary and Lair Actions

For legendary creatures:

1. Check "Has Legendary Actions"
2. The legendary action counter appears automatically
3. Add individual legendary actions to the list
4. Optionally add a description explaining how many actions can be used

[SCREENSHOT PLACEHOLDER: Legendary actions section with counter and action list]

---

## Creating Content for Your Campaign

### Creating Items

1. Create a new Item record
2. Select the **Type**:

[SCREENSHOT PLACEHOLDER: Item type dropdown]

| Type | Fields Shown |
|------|--------------|
| **Adventuring Gear** | Basic item fields |
| **Melee Weapon** | Damage, weapon type, mastery, properties |
| **Ranged Weapon** | Damage, range, ammo type, properties |
| **Armor** | AC, category, Dex modifier options |
| **Shield** | AC bonus |
| **Tool** | Basic item fields |
| **Magic Item** | Rarity, attunement, effects |
| **Item Pack** | Contains other items + currency |

3. For **Weapons**, set:
   - Damage dice (e.g., "1d8")
   - Weapon Type (for mastery benefits)
   - Mastery property (Cleave, Graze, Nick, etc.)
   - Weapon properties (Finesse, Heavy, Light, etc.)

   [SCREENSHOT PLACEHOLDER: Weapon creation with all weapon fields visible]

4. For **Armor**, set:
   - AC value
   - Category (Light/Medium/Heavy)
   - Whether to add Dex modifier
   - Maximum Dex modifier (for medium armor)
   - Strength requirement
   - Stealth disadvantage

   [SCREENSHOT PLACEHOLDER: Armor creation with armor fields visible]

5. For **Consumables**, set:
   - "Has Use" and/or "Consumable" checkbox
   - Effects to apply when used
   - Healing formula
   - Damage formula

   [SCREENSHOT PLACEHOLDER: Consumable item with healing field]

### Creating Feats

1. Create a new Feat record
2. Set the **Feat Type**:
   - Origin Feat
   - General Feat
   - Fighting Style Feat
   - Epic Boon Feat
   - **Eldritch Invocation (Warlock Only)** - for Warlock invocations

[SCREENSHOT PLACEHOLDER: Feat creation screen with all fields]

3. Set any Prerequisites
4. Specify Ability Score Increases if applicable
5. Write the Description

> **Important**: Use "Eldritch Invocation (Warlock Only)" type for all Warlock invocations. Players add these to their Features tab just like regular feats.

### Creating Spells

1. Create a new Spell record
2. Set spell level (Cantrip or 1-9)
3. Select the School of Magic
4. Choose which class Spell Lists include this spell
5. Fill in Casting Time, Range, Components, Duration
6. Write the full Description

[SCREENSHOT PLACEHOLDER: Spell creation form with all fields]

> **Tip**: When entering the Description, include damage formulas (like "3d8 fire damage") so players can reference them easily.

### Creating Classes, Subclasses, and Species

Classes, Subclasses, and Species are more complex records that include:
- Proficiency grants
- Feature progression
- Spellcasting information
- Ability score requirements

[SCREENSHOT PLACEHOLDER: Class creation overview]

These are typically set up once and shared across campaigns via the compendium system.

---

## Combat & Rolling Dice

### Initiative

Roll initiative by clicking the dice button on the Main tab or NPC sheet. The roll includes:
- Dexterity modifier
- Initiative bonus/penalty effects
- Any other applicable modifiers

[SCREENSHOT PLACEHOLDER: Initiative roll in chat showing modifiers]

### Making Attacks

Click the attack button on a weapon in your inventory to:
1. Show the roll prompt with all applicable modifiers
2. Toggle advantage/disadvantage if needed
3. Roll the attack

[SCREENSHOT PLACEHOLDER: Attack roll prompt with modifier toggles]

After the attack, click to roll damage. Critical hits are handled automatically.

### Saving Throws

Saving throws can be rolled from:
- The Main tab (for characters)
- The NPC sheet (for NPCs)
- Spell effects that require saves

[SCREENSHOT PLACEHOLDER: Saving throw roll with DC shown]

### Concentration

When a concentrating character takes damage, the system can prompt for a concentration save with the appropriate DC.

### Death Saves

When a character drops to 0 HP, use death saving throws. Track successes and failures until the character stabilizes or dies.

---

## Advanced Features

### Wild Shape and Polymorph

The Features tab supports shape-shifting abilities:

1. Enable the Shape-shifting section on the Features tab
2. Drag an NPC onto the Features tab
3. Select the type of transformation:
   - **Polymorph**: Replaces all ability scores, gains NPC's HP as temp HP
   - **Wild Shape**: Replaces physical stats only, gains temp HP based on druid level
   - **Animal Shapes**: For the Druid spell affecting multiple targets

[SCREENSHOT PLACEHOLDER: Shape-shifting selection prompt]

When transformed:
- Your stats update to the new form
- A token change effect is applied (if on the map)
- The NPC's actions become available
- Click "Remove Shape-shift" to revert

[SCREENSHOT PLACEHOLDER: Active shape-shift showing NPC link and remove button]

### Weapon Masteries (2024 Rules)

Weapon Masteries are tracked on the Features tab:

[SCREENSHOT PLACEHOLDER: Weapon Masteries dropdown with selections]

Select which weapons you've mastered. Each weapon type has a specific Mastery property:
- **Cleave**: Hit additional adjacent enemies
- **Graze**: Deal damage even on a miss
- **Nick**: Extra attack with light weapons
- **Push**: Push enemies back
- **Sap**: Impose disadvantage
- **Slow**: Reduce enemy speed
- **Topple**: Knock enemies prone
- **Vex**: Gain advantage on next attack

### Ability Groups

Class features often grant abilities that share a resource pool (like Channel Divinity or Ki Points). These are managed through Ability Groups:

[SCREENSHOT PLACEHOLDER: Ability Group with daily uses counter]

- Uses are tracked together
- Abilities within the group share the counter
- Restoration conditions can be set (short rest, long rest, etc.)

---

## Tips & Tricks

### Keyboard Shortcuts

- Use drag-and-drop extensively - it's the fastest way to add content
- Hold Shift when clicking roll buttons for advantage
- Hold Ctrl when clicking roll buttons for disadvantage

### Efficient Character Setup

1. Complete the wizard fully before adding extra content
2. Add spells before equipment (the Actions tab populates your spell slots)
3. Use Item Packs for starting equipment instead of individual items
4. Check your Origin Feat for skill proficiency choices

### For Game Masters

1. Create NPCs using the dedicated NPC record type, not character sheets
2. Use the Challenge Rating field - it auto-calculates XP and proficiency
3. Enable only the sections you need (Traits, Actions, etc.) to keep NPC sheets clean
4. Description fields for actions auto-parse attack/damage formulas

### Common Issues

**Q: My ability modifiers aren't calculating correctly**
A: Check that your proficiency bonus is set correctly. Changes to proficiency bonus update all dependent calculations.

**Q: Spells aren't appearing at the right level**
A: Ensure the spell's level is set correctly in the spell record itself, not just dragged to a section.

**Q: My AC isn't updating when I equip armor**
A: Make sure the armor is set to your equipped armor slot, not just in your inventory.

**Q: I can't find Eldritch Invocations**
A: They're in the Feats compendium! Filter by "Eldritch Invocation" type and drag them to your Features tab.

---

## Quick Reference

### Drag-and-Drop Summary

| Source | Target | Result |
|--------|--------|--------|
| Spell (from Compendium) | Actions Tab | Adds spell to spell list |
| Item (from Compendium) | Inventory Tab | Adds item to inventory |
| Feat (from Compendium) | Features Tab | Adds feat and applies bonuses |
| NPC (from Compendium) | Features Tab | Initiates Wild Shape/Polymorph |
| Class (from Compendium) | Character | Applies class (use wizard for best results) |

### Proficiency Levels

| Level | Bonus | Description |
|-------|-------|-------------|
| Unproficient | +0 | No proficiency bonus |
| Half | +PB/2 | Half proficiency (round down) |
| Proficient | +PB | Full proficiency bonus |
| Expertise | +PB×2 | Double proficiency bonus |

### Ability Score Modifier Chart

| Score | Modifier |
|-------|----------|
| 1 | -5 |
| 2-3 | -4 |
| 4-5 | -3 |
| 6-7 | -2 |
| 8-9 | -1 |
| 10-11 | +0 |
| 12-13 | +1 |
| 14-15 | +2 |
| 16-17 | +3 |
| 18-19 | +4 |
| 20 | +5 |

---

*This guide was created for the D&D 5th Edition (2024) ruleset in Realm VTT. For the latest updates and additional documentation, check the Realm VTT website.*
