# Modifiers & Effects

Modifiers are the engine behind almost every automatic adjustment on a character
sheet — a feat that adds your Proficiency Bonus to a save, a magic item that
boosts your AC, a class feature that lets you use your spellcasting ability to
attack. Instead of editing your numbers by hand, you attach **modifiers** to the
things that grant them, and the sheet recalculates everything for you.

## Where modifiers live

A modifier can be placed on any of three things:

- **Features** (class features, feats, species traits, background features) —
  apply while the character has the feature.
- **Items** (weapons, armor, wondrous items) — apply only while the item is
  **equipped**. If the item **requires attunement**, the modifier applies only
  while it is **both equipped and attuned**; un-attuning or unequipping removes
  it automatically.
- **Effects** (conditions, spells, auras) — apply while the effect is active, and
  can include duration, stacking, and target-aware logic.

**Tip:** Put one-time, "always-on" bonuses on the feature or item that grants
them. Use **Effects** for anything temporary (a spell buff, a condition) or
anything that depends on who applied it.

## Anatomy of a modifier

Every modifier row has the same columns:

| Column                | Purpose                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Type**              | _What_ it changes (e.g. **Attack Bonus**, **Armor Class Bonus**, **Speed Bonus**).                                     |
| **Field**             | The _context_ it applies to (an ability, a skill, a damage type, `melee`/`ranged`, etc.). Many types leave this blank. |
| **Value Type**        | How the **Value** is read: **Number**, **String**, or **From Field**.                                                  |
| **Value**             | The amount or expression (e.g. `2`, `1d6 fire`, `Proficiency Bonus`).                                                  |
| **Active by Default** | Whether it's on automatically, or appears as a toggle the player checks at roll time.                                  |
| **Predicate**         | An optional condition that must be true for the modifier to apply (see _Conditional modifiers_).                       |

### Value Types

- **Number** — a plain integer (`2`, `-1`). For _Penalty_ types you can enter a
  positive number; it's subtracted for you.
- **String** — text that can contain dynamic tokens and dice (`1d6 fire`,
  `Proficiency Bonus`, `advantage`).
- **From Field** — reads the number live from another sheet field (e.g.
  `proficiencyBonus`), so it stays current as the character levels.

### Dynamic values (String type)

String values support these tokens, resolved when the roll happens:

- **Ability modifiers** — `Strength Modifier`, `Dexterity Modifier`, …
  `Charisma Modifier`
- **Level & proficiency** — `Character Level`, `Half Character Level`,
  `<Class> Level`, `Half <Class> Level`, `Proficiency Bonus`
- **Shield AC** — `Shield AC` resolves to your equipped shield's AC bonus
  (0 if none)
- **Field references** — `@record.data.<field>` reads any field from this
  character; `@caster.data.<field>` reads from the creature that _applied_ the
  effect (for effects only)
- **Math expressions** — wrap in braces: `{floor(Character Level / 2)}`,
  `{max(1, Charisma Modifier)}`. Supports `floor`, `ceil`, `min`, `max`, `abs`.
  Without an explicit `floor`/`ceil`, results round **down** (D&D convention).

**Example —** a Cleric feature that adds your Wisdom modifier to a damage roll:
**Type** `Damage Bonus`, **Value Type** `String`, **Value** `Wisdom Modifier`.

---

## The modifier catalog

### Attack & damage

| Modifier                        | Field                                                            | Value                                               | Example                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attack Bonus / Penalty**      | `melee`, `ranged`, `all`, or blank                               | number/string                                       | `+1` magic weapon: Attack Bonus, blank field, `1`                                                                                                       |
| **Damage Bonus / Penalty**      | `melee`/`ranged`/`all`, a weapon property, weapon type, or blank | number/string (may include a type, e.g. `1d6 fire`) | Flame Tongue: Damage Bonus, `2d6 fire`. Add ` noCrit` to a flat bonus to exclude it from crit-doubling.                                                 |
| **Attack Calculation**          | ability name, or `Spellcasting Ability`                          | —                                                   | Pact of the Blade: field `Spellcasting Ability` to attack & damage with your casting stat                                                               |
| **Unarmed Damage Override**     | —                                                                | damage string                                       | Unarmed Fighting: `1d6/1d8 bludgeoning` (the d8 is used when the attack's hand toggle is **Two-Handed** / hands free). Strength is added automatically. |
| **Weapon Damage Type Override** | —                                                                | a damage type                                       | Turn a weapon's damage to `radiant`                                                                                                                     |
| **Additional Weapon Mastery**   | —                                                                | a mastery name (`Cleave`, `Sap`, `Topple`, …)       | Grants an extra mastery property when attacking with that weapon                                                                                        |
| **Martial Arts Die**            | a `level:die` scaling table (e.g. `1:1d6,5:1d8,11:1d10,17:1d12`) | — (the **Field** holds the table)                   | Monk's scaling unarmed die — see _Special case: Martial Arts Die_ below                                                                                 |
| **Weapon Finesse**              | a weapon type/category                                           | —                                                   | Grants Finesse (use the higher of STR/DEX) to matching weapons                                                                                          |

#### Special case: Martial Arts Die

**Martial Arts Die** is unusual — the scaling table lives in the **Field**, not
the Value. Put a comma-separated list of `level:die` thresholds there, and the
sheet picks the die for your current level:

```
1:1d6,5:1d8,11:1d10,17:1d12
```

This reads as "1d6 at level 1, 1d8 at 5, 1d10 at 11, 1d12 at 17." The **Value**
is left blank.

It scales by the level of the **class that granted the feature** (not your total
character level), so a multiclassed Monk 5 / Fighter 3 still gets the level-5 die.
It only _upgrades_ the unarmed/monk-weapon damage die — if your weapon already
rolls a larger die, that larger die is kept.

**Example — Monk's Martial Arts:** on the Martial Arts feature, **Type**
`Martial Arts Die`, **Field** `1:1d6,5:1d8,11:1d10,17:1d12`, **Value** blank.

### Spells & healing

| Modifier                            | Field                          | Value         | Example                                      |
| ----------------------------------- | ------------------------------ | ------------- | -------------------------------------------- |
| **Spell Attack Bonus / Penalty**    | `melee`, `ranged`, or a school | number/string | `+1` to spell attacks                        |
| **Spell DC Bonus**                  | a school, or blank             | number        | `+1` to all spell save DCs                   |
| **Spell Damage Bonus / Penalty**    | `attack` or `all`              | number/string | Add `Charisma Modifier` to spell damage      |
| **Cantrip Damage Bonus / Penalty**  | `attack` or `all`              | number/string | Add a flat bonus to cantrips only            |
| **Healing Bonus / Penalty**         | —                              | number/string | Increase healing received                    |
| **Hit Die Healing Multiplier**      | —                              | number        | Double HP regained from Hit Dice (value `2`) |
| **Hit Die Healing Bonus (Per Die)** | —                              | number        | Durable: extra HP per Hit Die spent          |

### Saves, checks & skills

| Modifier                          | Field                                       | Value                                    | Example                                                                                      |
| --------------------------------- | ------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Saving Throw Bonus / Penalty**  | ability, `all`, or `spell`                  | number/string/`advantage`/`disadvantage` | Add Prof to Wis saves; `advantage` on a save; `spell` = only saves forced by a spell         |
| **Saving Throw Proficiency**      | ability                                     | —                                        | Grant proficiency in a save                                                                  |
| **Saving Throw Note**             | ability/`{ability}Save`/`saves`/`all`/blank | `Tag(PIPE)Tooltip`                       | A reminder tag (e.g. **Evasion**) shown on the result — no math - replace (PIPE) with a pipe |
| **Ability Check Bonus / Penalty** | ability                                     | number/string/`advantage`/`disadvantage` | Advantage on Strength checks                                                                 |
| **Skill Check Bonus / Penalty**   | a skill, `proficient`, or `all`             | number/string/`advantage`/`disadvantage` | `+2` to Stealth; `proficient` = only skills you're proficient in                             |
| **Skill Proficiency**             | a skill or `all`                            | `true`, `half`, `expertise`              | Expertise: doubles proficiency if already proficient                                         |

### Passive scores

| Modifier                    | Field   | Value         | Example                              |
| --------------------------- | ------- | ------------- | ------------------------------------ |
| **Passive Bonus / Penalty** | a skill | number/string | Observant: `+5` Passive Perception   |
| **Passive Proficiency**     | a skill | —             | Count as proficient for passive only |

### Armor Class & defense

| Modifier                        | Field                             | Value          | Example                                                       |
| ------------------------------- | --------------------------------- | -------------- | ------------------------------------------------------------- |
| **Armor Class Calculation**     | the bonus ability                 | base AC number | Unarmored Defense: base `10` + DEX + the field ability        |
| **Armor Class Ability Swap**    | the ability to use                | armor category | Use a different ability than DEX for AC in that armor         |
| **Armor Class Bonus / Penalty** | blank or conditions               | number         | `+1` shield; Defensive Duelist via weapon-property condition  |
| **Armor Max Dex Bonus**         | `light`/`medium`/`heavy` or blank | cap number     | "Max Dex bonus while in medium armor becomes 3" (only raises) |

### Resistances, immunities & vulnerabilities

| Modifier              | Field               | Value                     | Example                                                               |
| --------------------- | ------------------- | ------------------------- | --------------------------------------------------------------------- |
| **Add Resistance**    | blank, or `upgrade` | a damage type             | Resistance to fire; `upgrade` turns existing resistance into immunity |
| **Add Immunity**      | —                   | a damage type             | Immunity to poison                                                    |
| **Add Vulnerability** | —                   | a type, `all`, or `spell` | Vulnerability to radiant                                              |

**Tip:** Resistance can also do **flat reduction** — set **Field** to a damage
type and **Value** to a number (e.g. Heavy Armor Master: field
`bludgeoning nonmagical`, value `3`).

#### Bypassing resistance & immunity

To make _your own_ damage ignore a target's defenses (e.g. a sorcerer's Elemental
Adept, or a feature that says "your fire damage ignores resistance"), use a
**Damage Bonus** with a **String** value in one of these forms:

| Value                      | Effect                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| `ignore <type> resistance` | The target's **resistance** to `<type>` is ignored for this attack |
| `ignore <type> immunity`   | The target's **immunity** to `<type>` is ignored for this attack   |

The middle word is the damage type, so the value is exactly three words —
`ignore fire resistance`, `ignore cold immunity`. These are **directives, not
damage**: they don't add anything to the roll and never appear as a toggle; they
simply tell the damage step to skip that defense for the listed type. Add one
modifier per type/defense you need to pierce.

**Example — Elemental Adept (Fire):** _"Spells you cast ignore resistance to fire
damage."_ Put a **Damage Bonus**, **Value Type** `String`, **Value**
`ignore fire resistance` on the feat. (For a version that also pierces immunity,
add a second one with `ignore fire immunity`.)

**Tip:** Combine with a **Predicate** to scope it — e.g.
`{"and": ["spell:fire"]}` so it only fires on fire spells, not weapon attacks.

### Hit points & ability scores

| Modifier               | Field      | Value           | Example                                                         |
| ---------------------- | ---------- | --------------- | --------------------------------------------------------------- |
| **Hit Point Maximum**  | —          | number/string   | Tough: `{Character Level * 2}`                                  |
| **Temporary HP Bonus** | —          | number/string   | Add to temp HP whenever it's granted                            |
| **Attribute Bonus**    | an ability | number          | `+2` Strength (with optional max, e.g. `4:24`)                  |
| **Attribute Set**      | an ability | target score    | Amulet of Health: set CON to `19` (no effect if already higher) |
| **Dual Concentration** | —          | spell-level cap | Maintain two concentration spells at once                       |

### Movement & initiative

| Modifier                       | Field              | Value          | Example                                            |
| ------------------------------ | ------------------ | -------------- | -------------------------------------------------- |
| **Initiative Bonus / Penalty** | —                  | number/string  | Alert-style initiative boost                       |
| **Base Speed**                 | —                  | number         | Set walking speed (only raises)                    |
| **Speed Bonus / Penalty**      | —                  | number or mode | `10` faster; or `Fly 30 ft` to add a movement mode |
| **Weapon Range Bonus**         | `normal` or `long` | number         | Extend a ranged weapon's range                     |

### Senses, proficiencies & utility

| Modifier                                                  | Field                             | Value              | Example                                                   |
| --------------------------------------------------------- | --------------------------------- | ------------------ | --------------------------------------------------------- |
| **Senses**                                                | —                                 | sense string       | `Darkvision 60`, `Darkvision 120/60`, or `Darkvision +30` |
| **Armor / Weapon / Tool Proficiency**                     | (tool: blank or `expertise`)      | a proficiency name | `Martial Weapons`; or `Choose 1 from …` prompts           |
| **Add Language**                                          | —                                 | a language         | Add Draconic                                              |
| **Wild Shape Bonus**                                      | `tempHp`/`ac`/`attack`/`damage`/… | varies             | Tune Wild Shape temp HP, AC, attacks                      |
| **Regeneration (Start/End of Turn)**                      | —                                 | number             | Troll-style regrowth                                      |
| **Death Save Threshold**                                  | —                                 | number             | Adjust the death-save success target                      |
| **Encumbrance Size Increase**                             | —                                 | `1` / `-1`         | Powerful Build (carry as one size larger)                 |
| **Ignore Worn Armor Weight / Ignore Armor Skill Penalty** | —                                 | —                  | Remove armor weight or Stealth disadvantage               |
| **Ability Group Uses Bonus**                              | a group name                      | number             | Extra uses of a limited feature                           |
| **Set Value**                                             | a data field                      | any                | Write a raw field directly (advanced)                     |
| **Toggle**                                                | a toggle key                      | display name       | Adds a checkbox above the attack list, used by Predicates |

**Important:** Use **Attribute Set** (not **Set Value**) for ability scores — it
floors the score correctly, reverts when removed, and recalculates everything
that depends on it (modifier, HP, saves). **Set Value** writes a field once with
no revert.

---

## Conditional modifiers: Predicates

A **Predicate** makes a modifier apply only when a condition is true. The
simplest case ties a modifier to a **Toggle** the player checks before rolling;
more advanced predicates inspect the roll itself.

- **A toggle name** — `focused-shot` — only when that toggle is checked
- **`weapon:<property>`** — only with a matching weapon: `weapon:finesse`,
  `weapon:ranged`, `weapon:heavy`, `weapon:name:dagger`
- **`self:proficient`** — only on a check/skill you're proficient in
- **`effect:<name>` / `feature:<name>`** — only if the character has that effect
  or feature
- **Combine with logic** — JSON like `{"or": ["weapon:finesse", "weapon:ranged"]}`,
  `{"not": "feature:heavy-armor-master"}`, or an array
  `["sneak-attack", "weapon:finesse"]` (all must be true)

**Example — Sneak Attack die** only on a finesse or ranged weapon: a Damage Bonus
with **Predicate** `["sneak-attack", {"or": ["weapon:finesse", "weapon:ranged"]}]`.

---

## Special value keywords

These work in bonus/penalty values:

- **`advantage` / `disadvantage`** — grant advantage/disadvantage on the roll
- **`criticalN`** (e.g. `critical19`) — crit on N–20; works on attacks _and_ checks
- **`minrollN`** (e.g. `minroll10`) — treat any d20 result below N as N
  (Reliable Talent)
- **`<value> noCrit [type]`** — a damage bonus added on a hit but **not** doubled
  on a crit
- **`ignore <type> resistance` / `ignore <type> immunity`** — on a **Damage
  Bonus**, makes this attack bypass the target's resistance/immunity to that
  damage type (see _Bypassing resistance & immunity_ above)

---

## Effect-only modifier types

When building an **Effect** (rather than a feature/item), a few extra types
become available because they're aimed _at_ a creature:

- **Attacks Targeting You** — adjusts attacks made against the affected creature.
  Supported values:
  - `advantage` / `disadvantage` — attacker rolls with adv/disadv
  - `critical` — attacks against this creature auto-crit (also `critical19`, etc.
    to widen the attacker's crit range)
  - `noAdvantage` — cancels any Advantage the attacker would otherwise have
    (e.g. "attack rolls against you don't have Advantage"); does not grant
    disadvantage
    Honored by every attack path (weapon, spell, NPC action, Wild Shape). Pair with
    predicates like `{"not": "target:applied_by"}` for "disadvantage on attacks,
    except from me."

Effects also support target-aware predicates (`target:creature_type:dragon`,
`self:senses:darkvision`) and special value sources (stack count, externally-set
values).

---

## Worked examples

**Amulet of Health** — _"Your Constitution score is 19."_
On the item: **Type** `Attribute Set`, **Field** `constitution`, **Value Type**
`Number`, **Value** `19`. Mark the item as requiring attunement; the change
applies only while attuned and reverts when you remove it.

**Unarmed Fighting fighting style** — _"1d6 + STR, becomes 1d8 if you have no
weapon or shield in hand."_
On the feature: **Type** `Unarmed Damage Override`, **Value Type** `String`,
**Value** `1d6/1d8 bludgeoning`. Flip the unarmed strike's hand toggle to
**Two-Handed** for the d8.

**Dueling fighting style** — _"+2 damage with a one-handed melee weapon."_
**Type** `Damage Bonus`, **Field** `melee`, **Value** `2`, **Predicate**
`{"not": "weapon:two-handed"}`.

**Observant** — _"+5 to Passive Perception."_
**Type** `Passive Bonus`, **Field** `perception`, **Value** `5`.

---

## Tips & gotchas

- **Number vs String:** use **String** the moment you need a die, a damage type,
  or a token like `Proficiency Bonus`.
- **Penalties:** enter a positive number on a _Penalty_ type — it's subtracted
  automatically.
- **Active by Default off** turns a modifier into a _roll-time toggle_ (great for
  optional bonuses like a feat you choose to use).
- **Attunement:** item modifiers respect attunement automatically — no need to
  gate them yourself.
- **Rounding** is always down unless you write `ceil()`.
