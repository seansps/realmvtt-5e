// ─── Shared spellcasting ─────────────────────────────────────────────────────
//
// castSpellShared() is the single implementation behind every way a spell can be
// cast in this ruleset:
//
//   • a character's spell list       (spell-list.html)
//   • an NPC's spellcasting action   (npc-spell-list.html)
//   • an item's Spells tab           (castItemSpell in common.js)
//
// Each caller supplies only what genuinely differs — where the resource comes
// from, which numbers back the save DC and attack bonus, and what "caster level"
// means for cantrip scaling — so damage/healing scaling, upcast handling, effect
// macros, saving throws, alternate damage, concentration, tags and animations
// are identical across all three by construction rather than by three copies
// being kept in step by hand.
//
// Depends on common.js (getEffectsAndModifiers, getDamageTypes, capitalize,
// getMinRollModifier, buildSpellDamageRuntimeMerge, getAltSpellDamageButtons,
// getEffectMacrosFor, getEffectDuration, getAnimationFor,
// buildSourceAttackerContext) and the ambient `record`, `api` and `assetUrl`.

// Predicate context for a cast, so spell:<value> predicates can gate spell
// attack / damage / DC / healing modifiers by School of Magic (data.school), by
// tag (spellTags), or by spell list / class (data.spellLists, e.g. spell:druid,
// spell:cleric).
function getSpellPredicateContext(spell) {
  return {
    spellName: spell?.name || "",
    spellSchool: spell?.data?.school || "",
    spellLists: spell?.data?.spellLists || [],
    spellTags: spell?.data?.spellTags || [],
  };
}

// True when the spell resolves as a ranged attack. The range field is the
// primary signal, but a description that explicitly says "melee spell attack"
// overrides it.
function isRangedSpell(spell) {
  const range = parseInt(spell?.data?.range || "0", 10);
  let ranged = range > 0;
  if (ranged && (spell?.data?.description || "").match(/melee spell attack/i)) {
    ranged = false;
  }
  return ranged;
}

// How a spell reaches its area, independent of whether it rolls a ranged
// attack. Self-originating area spells (Lightning Bolt, Burning Hands, Cone of
// Cold) have a range of "Self", so isRangedSpell — which answers a different
// question, "is this a ranged spell attack?" — reports false for them and the
// animation used to play parked on the caster instead of projecting outward.
//
// Returns "line" | "cone" | "emanation" | null. Areas centered on a distant
// point (Fireball's sphere at 150 feet) return null: they already deliver
// correctly off the ranged flag.
function getSpellShape(spell) {
  const rangeStr = spell?.data?.range || "";
  const text = [
    rangeStr,
    spell?.data?.area || "",
    spell?.data?.description || "",
  ]
    .join(" ")
    // "line of sight" / "line of effect" are prose, not the Line shape.
    .replace(/\bline\s+of\s+(sight|effect)\b/gi, " ");

  if (/\bline\b/i.test(text)) return "line";
  if (/\bcone\b/i.test(text)) return "cone";

  // Cubes, spheres and radii are only self-centered when the range says so.
  const selfRange = /^\s*self\b/i.test(rangeStr);
  if (/\bemanation\b/i.test(text)) return "emanation";
  if (selfRange && /\b(cube|sphere|cylinder|radius|aura)\b/i.test(text)) {
    return "emanation";
  }
  return null;
}

// Builds the attack-roll modifier list for a spell attack.
//
// `flatModifiers` is the caster-specific part — for a character that's their
// ability modifier + proficiency (+ any spellModBonus), for an NPC the flat
// "Spellcasting Modifier" from the action, for an item the resolved spell attack
// bonus. Everything after it (general "spell"-field attack modifiers and spell
// attack modifiers scoped by ranged/melee) is the same for all casters.
//
// Returns [] for non-attack spells — nothing downstream uses attack modifiers
// unless the spell rolls an attack.
function buildSpellAttackModifiers(spell, opts = {}) {
  if (!spell?.data?.isAttack) return [];
  const attackModifiers = (opts.flatModifiers || []).filter(Boolean);
  if (opts.collectEffects === false) return attackModifiers;

  const spellPredCtx = getSpellPredicateContext(spell);
  const spellAttackField = isRangedSpell(spell) ? "ranged" : "melee";

  // General attack modifiers scoped to the "spell" field.
  getEffectsAndModifiers(
    ["attackBonus", "attackPenalty"],
    "spell",
    undefined,
    undefined,
    spellPredCtx,
  ).forEach((modifier) => attackModifiers.push(modifier));

  // Spell attack modifiers, by ranged/melee.
  getEffectsAndModifiers(
    ["spellAttackBonus", "spellAttackPenalty"],
    spellAttackField,
    undefined,
    undefined,
    spellPredCtx,
  ).forEach((modifier) => {
    if (
      !attackModifiers.some(
        (m) => m.name === modifier.name && m.value === modifier.value,
      )
    ) {
      attackModifiers.push(modifier);
    }
  });

  return attackModifiers;
}

// ─── Resource consumption ────────────────────────────────────────────────────
//
// A resource handler receives
//   { spell, spellName, casterRecord, actualSpellLevel, requestedSlot, dailyUsesPath }
// and returns
//   { proceed, spellLevel }
// `proceed: false` aborts the cast (the handler is responsible for telling the
// player why). `spellLevel` is the effective level the spell is cast at; 0 means
// "not determined here", and castSpellShared falls back to the spell's own level
// / upcast level.

// Spell Point costs by level (2014 variant rule).
const SPELL_POINT_COSTS = {
  1: 2,
  2: 3,
  3: 5,
  4: 6,
  5: 7,
  6: 9,
  7: 10,
  8: 11,
  9: 13,
};

// Character resource: spell points, pact magic, or spell slots.
function consumeCharacterSpellResource(info) {
  const { spell, spellName, casterRecord, actualSpellLevel, dailyUsesPath } =
    info;
  const spellPrepared = spell?.data?.prepared || "prepared";
  const result = { proceed: true, spellLevel: 0 };

  if (spellPrepared === "prepared" && actualSpellLevel > 0) {
    let spellSlot =
      parseInt(spell?.data?.upcastLevel || `${actualSpellLevel}`, 10) || 1;

    // Check if using spell points variant
    const useSpellPointsSetting = casterRecord?.data?.useSpellPoints;
    const spellPointsCurrent = parseInt(
      casterRecord?.data?.spellPoints || "0",
      10,
    );
    const numSpellPoints = parseInt(
      casterRecord?.data?.numSpellPoints || "0",
      10,
    );
    const spellPointsCost = SPELL_POINT_COSTS[spellSlot] || 0;
    const hasSpellPointsPool = numSpellPoints > 0;

    // For 6th+ level spell points, check once-per-long-rest tracking
    let canUseSpellPointsForLevel = true;
    if (spellSlot >= 6 && hasSpellPointsPool) {
      if (casterRecord?.data?.[`spellPointSlot${spellSlot}Used`]) {
        canUseSpellPointsForLevel = false;
      }
    }

    let useSpellPoints = false;

    // Determine if we are using a spell slot or a pact magic slot
    let fieldToUse = "";
    let maxField = "";

    const pactAvailByLevel = [0];
    for (let i = 1; i <= 9; i++) {
      pactAvailByLevel.push(
        parseInt(casterRecord?.data?.[`numPactMagic${i}`] || "0", 10) -
          parseInt(casterRecord?.data?.[`pactMagic${i}`] || "0", 10),
      );
    }
    const slotAvailByLevel = [0];
    for (let i = 1; i <= 9; i++) {
      slotAvailByLevel.push(
        parseInt(casterRecord?.data?.[`numSpellSlots${i}`] || "0", 10) -
          parseInt(casterRecord?.data?.[`spellSlots${i}`] || "0", 10),
      );
    }

    const hasPactAvailable = pactAvailByLevel.some((n) => n > 0);

    // Check if there's a spell slot available at the casting level or higher
    let hasSlotAtLevel = false;
    for (let i = spellSlot; i <= 9; i++) {
      if (slotAvailByLevel[i] > 0) {
        hasSlotAtLevel = true;
        break;
      }
    }

    const lowestPactMagicLevel = () => {
      for (let i = 1; i <= 9; i++) {
        if (pactAvailByLevel[i] > 0) return i;
      }
      return 0;
    };

    // Determine resource to use: spell points > pact magic > spell slots
    // (based on toggles).
    if (
      useSpellPointsSetting &&
      hasSpellPointsPool &&
      spellPointsCurrent >= spellPointsCost &&
      canUseSpellPointsForLevel
    ) {
      // Spell Points toggle is ON and we can afford it
      useSpellPoints = true;
    } else if (
      hasPactAvailable &&
      (casterRecord?.data?.usePactMagic ||
        (!hasSlotAtLevel && !useSpellPointsSetting))
    ) {
      // Pact Magic: use if toggle ON, or if no spell slots and not using points
      const lowestPactMagic = lowestPactMagicLevel();
      if (lowestPactMagic > 0 && actualSpellLevel <= lowestPactMagic) {
        spellSlot = lowestPactMagic;
        fieldToUse = `pactMagic${lowestPactMagic}`;
        maxField = `numPactMagic${lowestPactMagic}`;
      }
    } else if (hasSlotAtLevel && !useSpellPointsSetting) {
      // Use spell slots — find lowest available slot at or above the cast level
      for (let i = spellSlot; i <= 9; i++) {
        if (slotAvailByLevel[i] > 0) {
          spellSlot = i;
          break;
        }
      }
      fieldToUse = `spellSlots${spellSlot}`;
      maxField = `numSpellSlots${spellSlot}`;
    } else if (hasPactAvailable) {
      // Fall back to pact magic
      const lowestPactMagic = lowestPactMagicLevel();
      if (lowestPactMagic > 0 && actualSpellLevel <= lowestPactMagic) {
        spellSlot = lowestPactMagic;
        fieldToUse = `pactMagic${lowestPactMagic}`;
        maxField = `numPactMagic${lowestPactMagic}`;
      }
    }

    // Bail out if we have no resources at all
    if (!useSpellPoints && !fieldToUse) {
      let reason = "";
      if (
        useSpellPointsSetting &&
        hasSpellPointsPool &&
        !canUseSpellPointsForLevel
      ) {
        reason = `Already used a level ${spellSlot} spell via spell points this long rest`;
      } else if (
        useSpellPointsSetting &&
        hasSpellPointsPool &&
        spellPointsCurrent < spellPointsCost
      ) {
        reason = `Not enough spell points (need ${spellPointsCost}, have ${spellPointsCurrent})`;
      } else if (useSpellPointsSetting && hasSpellPointsPool) {
        reason = `No spell points available`;
      } else if (hasPactAvailable) {
        reason = `No pact magic slots of high enough level`;
      } else {
        const resources = [];
        if (useSpellPointsSetting) resources.push("spell points");
        if (!useSpellPointsSetting) resources.push("spell slots");
        if (hasPactAvailable) resources.push("pact magic");
        reason = `No ${resources.join(" or ")} available`;
      }
      api.showNotification(
        `${reason} to cast ${spellName}.`,
        "red",
        "Cannot Cast Spell",
      );
      result.proceed = false;
      return result;
    }

    result.spellLevel = spellSlot;

    if (useSpellPoints) {
      api.setValue("data.spellPoints", spellPointsCurrent - spellPointsCost);
      // For 6th+ level, mark the slot as used for this long rest
      if (spellSlot >= 6) {
        api.setValue(`data.spellPointSlot${spellSlot}Used`, true);
      }
    } else {
      const numSpellSlots = parseInt(
        api.getValue(`data.${fieldToUse}`) || "0",
        10,
      );
      const numMaxSpellSlots = parseInt(
        api.getValue(`data.${maxField}`) || "0",
        10,
      );
      if (numSpellSlots < numMaxSpellSlots) {
        api.setValue(`data.${fieldToUse}`, numSpellSlots + 1);
      }
    }
  } else if (spellPrepared === "daily") {
    const dailyUses = parseInt(spell?.data?.dailyUses, 10) || 0;
    const maxDailyUses = parseInt(spell?.data?.maxDailyUses, 10) || 1;
    if (dailyUses < maxDailyUses && dailyUsesPath) {
      api.setValue(dailyUsesPath, dailyUses + 1);
    }
  }

  return result;
}

// NPC resource: a plain slot at the spell's level, and daily uses for
// non-cantrip daily spells. NPCs have no spell points and no pact magic.
function consumeNpcSpellResource(info) {
  const { spell, actualSpellLevel, dailyUsesPath } = info;
  const spellPrepared = spell?.data?.prepared || "prepared";
  const result = { proceed: true, spellLevel: 0 };

  if (spellPrepared === "prepared" && actualSpellLevel > 0) {
    const spellSlot =
      parseInt(spell?.data?.upcastLevel || `${actualSpellLevel}`, 10) || 1;
    result.spellLevel = spellSlot;
    const fieldToUse = `spellSlots${spellSlot}`;
    const maxField = `numSpellSlots${spellSlot}`;
    const numSpellSlots = parseInt(
      api.getValue(`data.${fieldToUse}`) || "0",
      10,
    );
    const numMaxSpellSlots = parseInt(
      api.getValue(`data.${maxField}`) || "0",
      10,
    );
    if (numSpellSlots < numMaxSpellSlots) {
      api.setValue(`data.${fieldToUse}`, numSpellSlots + 1);
    }
  } else if (spellPrepared === "daily" && spell?.data?.level !== "Cantrip") {
    const dailyUses = parseInt(spell?.data?.dailyUses, 10) || 0;
    const maxDailyUses = parseInt(spell?.data?.maxDailyUses, 10) || 1;
    if (dailyUses < maxDailyUses && dailyUsesPath) {
      api.setValue(dailyUsesPath, dailyUses + 1);
    }
  }

  return result;
}

// Item resource: the charge deduction is handled by useInventoryItem before the
// cast, so nothing is spent here — the level is simply pinned to what the item
// grants.
function makeFixedLevelResource(level) {
  const fixedLevel = parseInt(level, 10) || 0;
  return function consumeFixedLevelResource() {
    return { proceed: true, spellLevel: fixedLevel };
  };
}

// ─── The cast ────────────────────────────────────────────────────────────────
//
// opts:
//   casterRecord            record backing data lookups (default: ambient record)
//   ability                 ability used for the damage / healing ability mod
//                           (default: spell.data.ability || "strength")
//   casterLevel             level used for cantrip damage scaling (default: 1)
//   consumeResource         resource handler (see above; default: character)
//   dailyUsesPath           data path to the spell row's dailyUses counter
//   listLevel               level implied by the list the spell sits in, used
//                           when the spell record itself has no level
//   attackFlatModifiers     caster-specific attack modifiers seeded into the
//                           attack roll (ability + proficiency, an NPC's flat
//                           spellcasting modifier, an item's attack bonus)
//   collectAttackEffects    false to skip effect-derived attack modifiers
//                           (an item casting on its own numbers)
//   baseSaveDc              save DC before spellDCBonus modifiers; omit to
//                           compute 8 + abilityMod + proficiency + data.spellDCBonus
//   applyDcModifiers        false to skip spellDCBonus modifiers on the DC
//   allowSpellOverrides     false to ignore the spell row's saveDc / attackMod
//                           overrides (they belong to the caster's own list)
//   dualConcentration       false to skip the 2nd-concentration slot check
//   altDamageContext        NPC spellcasting action passed through to
//                           getAltSpellDamageButtons for its ability
//   subHeader               markdown inserted under the spell name
//   afterCast(info)         called once the message has been sent; info carries
//                           the resource handler's own result as `resource`
function castSpellShared(spell, opts = {}) {
  if (!spell) return;
  const o = opts || {};
  const casterRecord = o.casterRecord || record;
  const consumeResource = o.consumeResource || consumeCharacterSpellResource;
  const allowSpellOverrides = o.allowSpellOverrides !== false;

  const spellPredCtx = getSpellPredicateContext(spell);

  // Caster fields are read live where possible (api.getValue reflects edits the
  // ambient `record` may not have yet) and fall back to the record when the
  // caster isn't the record backing the current data path.
  const casterValue = (field) => {
    const live = api.getValue(`data.${field}`);
    return live === undefined || live === null
      ? casterRecord?.data?.[field]
      : live;
  };

  const spellName = spell?.name || "Unknown Spell";
  const spellDescription = api.richTextToMarkdown(
    spell?.data?.description || "",
  );
  const spellIcon = spell?.portrait
    ? `![${spellName}](${assetUrl}${encodeURI(
        spell?.portrait,
      )}?width=40&height=40) `
    : "";

  // Flat spellcasting bonus configured on the caster.
  const spellDCBonus = parseInt(casterValue("spellDCBonus") || "0", 10) || 0;

  let animation = spell?.data?.animation;

  // ── Damage and healing modifiers ──────────────────────────────────────────
  let damageModifiers = [];
  let primaryDamageType = "untyped";
  // All damage types in the base damage formula (supports multi-type formulas
  // like "2d8 bludgeoning + 4d6 cold"). primaryDamageType stays the first type
  // for ability-mod / default-modifier typing; allDamageTypes drives the button
  // label.
  const allDamageTypes = getDamageTypes(spell?.data?.damage || "");
  let healingModifiers = [];
  const ability = o.ability || spell?.data?.ability || "strength";
  if (
    spell?.data?.damage ||
    spell?.data?.damage2 ||
    (spell?.data?.healing && spell?.data?.addAbilityHealing)
  ) {
    const abilityMod = casterValue(`${ability}Mod`) || 0;
    primaryDamageType = allDamageTypes[0] || "untyped";
    if (spell?.data?.damage && spell?.data?.addAbility) {
      damageModifiers.push({
        name: capitalize(ability),
        type: spell?.data?.damage ? primaryDamageType : "untyped",
        value: abilityMod,
        active: true,
      });
    }
    if (spell?.data?.healing && spell?.data?.addAbilityHealing) {
      healingModifiers.push({
        name: capitalize(ability),
        type: spell?.data?.healing.includes("temp") ? "temp" : undefined,
        value: abilityMod,
        active: true,
      });
    }
  }

  if (spell?.data?.damage || spell?.data?.damage2) {
    let moreDamageModifiers =
      spell?.data?.level?.toLowerCase() === "cantrip"
        ? getEffectsAndModifiers(
            ["cantripDamageBonus", "cantripDamagePenalty"],
            spell?.data?.isAttack ? "attack" : "all",
            undefined,
            undefined,
            spellPredCtx,
          )
        : getEffectsAndModifiers(
            ["spellDamageBonus", "spellDamagePenalty"],
            spell?.data?.isAttack ? "attack" : "all",
            undefined,
            undefined,
            spellPredCtx,
          );
    // Filter attack modifiers if not attack spell
    if (!spell?.data?.isAttack) {
      moreDamageModifiers = moreDamageModifiers.filter(
        (mod) => (mod?.field || "") !== "attack",
      );
    }
    moreDamageModifiers.forEach((modifier) => {
      damageModifiers.push({
        ...modifier,
        // Only set type if the modifier does not carry its own
        type: modifier.value.toString().split(" ")?.[1]
          ? ""
          : primaryDamageType,
      });
    });
  } else if (spell?.data?.healing) {
    getEffectsAndModifiers(
      ["healingBonus", "healingPenalty"],
      "",
      undefined,
      undefined,
      spellPredCtx,
    ).forEach((modifier) => {
      healingModifiers.push({
        ...modifier,
        type: spell?.data?.healing.includes("temp") ? "temp" : undefined,
      });
    });
  }

  // ── Resistance / immunity handling ────────────────────────────────────────
  // Gate on `typeof mod.value === "string"` (not valueType) because
  // getEffectsAndModifiers may resolve a string-typed modifier to a number
  // (e.g. "Warlock Spellcasting Modifier" → 3) — those can't be keyword-matched.
  const damageIgnoresResistances = damageModifiers
    .filter(
      (mod) =>
        typeof mod.value === "string" &&
        mod.value.trim().toLowerCase().startsWith("ignore") &&
        mod.value.trim().toLowerCase().includes("resistance"),
    )
    ?.map((mod) => mod.value.split(" ")[1])
    .join(",");
  const damageIgnoresImmunities = damageModifiers
    .filter(
      (mod) =>
        typeof mod.value === "string" &&
        mod.value.trim().toLowerCase().startsWith("ignore") &&
        (mod.value.trim().toLowerCase().includes("immunities") ||
          mod.value.trim().toLowerCase().includes("immunity")),
    )
    ?.map((mod) => mod.value.split(" ")[1])
    .join(",");
  // Filter these out of the modifiers array, we don't need them to be toggleable
  damageModifiers = damageModifiers.filter(
    (m) => !m.value.toString().toLowerCase().includes("ignore"),
  );

  // ── Attack modifiers ──────────────────────────────────────────────────────
  let attackModifiers = buildSpellAttackModifiers(spell, {
    flatModifiers: o.attackFlatModifiers,
    collectEffects: o.collectAttackEffects,
  });

  // ── Resource consumption and effective cast level ─────────────────────────
  let spellDamage = spell?.data?.damage;
  let spellAltDamage = spell?.data?.damage2;
  let spellHealing = spell?.data?.healing;

  let actualSpellLevel = spell?.data?.level || "Cantrip";
  if (actualSpellLevel === "Cantrip") actualSpellLevel = "0";
  actualSpellLevel = parseInt(actualSpellLevel, 10) || 0;
  // If the spell has no level set, default to the level of the list it's in
  // (e.g. data.spells3 → 3).
  if (actualSpellLevel === 0) {
    const listLevel = parseInt(o.listLevel, 10);
    if (!isNaN(listLevel) && listLevel > 0) actualSpellLevel = listLevel;
  }

  const resource =
    consumeResource({
      spell,
      spellName,
      casterRecord,
      actualSpellLevel,
      requestedSlot:
        parseInt(spell?.data?.upcastLevel || `${actualSpellLevel}`, 10) || 1,
      dailyUsesPath: o.dailyUsesPath || "",
    }) || {};
  if (resource.proceed === false) return;

  let spellLevel = parseInt(resource.spellLevel, 10) || 0;

  if (spell?.data?.level === "Cantrip") {
    // Cantrip damage scales with the caster's level.
    const casterLevel = parseInt(o.casterLevel, 10) || 1;
    if (casterLevel >= 5) {
      spellDamage = spell?.data?.damageCharacterLevel5 || spell?.data?.damage;
      spellAltDamage =
        spell?.data?.damage2CharacterLevel5 || spell?.data?.damage2;
    }
    if (casterLevel >= 11) {
      spellDamage = spell?.data?.damageCharacterLevel11 || spell?.data?.damage;
      spellAltDamage =
        spell?.data?.damage2CharacterLevel11 || spell?.data?.damage2;
    }
    if (casterLevel >= 17) {
      spellDamage = spell?.data?.damageCharacterLevel17 || spell?.data?.damage;
      spellAltDamage =
        spell?.data?.damage2CharacterLevel17 || spell?.data?.damage2;
    }
  } else {
    // Leveled spell — fall back to the spell's own (or upcast) level when the
    // resource handler didn't determine one.
    if (spellLevel === 0) {
      spellLevel =
        parseInt(spell?.data?.upcastLevel || spell?.data?.level, 10) || 0;
    }
    if (spellLevel >= 2) {
      spellDamage =
        spell?.data?.[`damageLevel${spellLevel}`] || spell?.data?.damage;
      spellAltDamage =
        spell?.data?.[`damage2Level${spellLevel}`] || spell?.data?.damage2;
      spellHealing =
        spell?.data?.[`healingLevel${spellLevel}`] || spell?.data?.healing;
    }
  }

  // Now that the level is known, replace "Spell Level" in string modifiers.
  // Gate on the actual value type (not valueType) — getEffectsAndModifiers may
  // have already resolved a string-typed modifier to a number.
  let levelToReplace = spellLevel;
  if (spell?.data?.level?.toLowerCase() === "cantrip") {
    levelToReplace = 0;
  }
  const replaceSpellLevel = (modifier) => {
    if (typeof modifier?.value === "string") {
      modifier.value = modifier.value.replace(
        /[Ss]pell [Ll]evel/g,
        levelToReplace,
      );
    }
  };
  damageModifiers.forEach(replaceSpellLevel);
  healingModifiers.forEach(replaceSpellLevel);
  attackModifiers.forEach(replaceSpellLevel);

  // A spell row can override the attack modifier outright (daily/at-will rows).
  const attackModOverride = allowSpellOverrides
    ? spell?.data?.attackMod
    : undefined;
  if (attackModOverride !== undefined && attackModOverride > 0) {
    attackModifiers = [
      { name: "Spell Attack Modifier", value: attackModOverride, active: true },
    ];
  }

  const rangedSpell = isRangedSpell(spell);

  // ── Save DC ───────────────────────────────────────────────────────────────
  const savingThrow = spell?.data?.savingThrow || "dexterity";
  let saveDc;
  if (o.baseSaveDc !== undefined && o.baseSaveDc !== null) {
    saveDc = parseInt(o.baseSaveDc, 10) || 0;
  } else {
    // 8 + spellcasting ability modifier + proficiency bonus (assume proficient)
    const dcAbility = o.ability || spell?.data?.ability || "intelligence";
    const dcAbilityMod = casterValue(`${dcAbility}Mod`) || 0;
    const rawProficiency = casterValue("proficiencyBonus");
    const proficiencyBonus = rawProficiency !== undefined ? rawProficiency : 2;
    saveDc =
      8 +
      (parseInt(dcAbilityMod, 10) || 0) +
      (parseInt(proficiencyBonus, 10) || 0) +
      spellDCBonus;
  }
  const saveDcOverride = allowSpellOverrides ? spell?.data?.saveDc : undefined;
  if (saveDcOverride !== undefined && saveDcOverride > 0) {
    saveDc = saveDcOverride;
  }
  if (o.applyDcModifiers !== false) {
    const spellDcModifiers = getEffectsAndModifiers(
      ["spellDCBonus"],
      "",
      undefined,
      undefined,
      spellPredCtx,
    );
    saveDc += spellDcModifiers.reduce(
      (acc, mod) => acc + (parseInt(mod?.value || "0", 10) || 0),
      0,
    );
  }

  // ── Damage / healing buttons ──────────────────────────────────────────────
  const saveDamageMetadata = spell?.data?.isSave
    ? {
        save: savingThrow,
        saveDc: saveDc,
        isSpell: true,
        damageIgnoresResistances,
        damageIgnoresImmunities,
        attack: spellName,
        icon: "IconWand",
        portrait: spell?.portrait,
      }
    : {
        isSpell: true,
        damageIgnoresResistances,
        damageIgnoresImmunities,
        attack: spellName,
        icon: "IconWand",
        portrait: spell?.portrait,
      };

  // Button label: a single-type spell names its type ("Fire Damage"); a
  // multi-type formula ("2d8 bludgeoning + 4d6 cold") falls back to "Spell".
  const damageButtonLabel =
    allDamageTypes.length === 1 ? capitalize(allDamageTypes[0]) : "Spell";
  const damageButton =
    spell?.data?.damage && spell?.data?.isAttack !== true
      ? `\`\`\`Roll_${damageButtonLabel}_Damage
const damageModifiers = JSON.parse(JSON.stringify(${JSON.stringify(
          damageModifiers,
        )}));${buildSpellDamageRuntimeMerge({
          modifiersVar: "damageModifiers",
          isCantrip: spell?.data?.level?.toLowerCase() === "cantrip",
          isAttack: false,
          primaryDamageType,
          spellPredCtx,
          levelCastAt: levelToReplace,
        })}
api.promptRoll(\`${spellName} ${damageButtonLabel} Damage\`, '${spellDamage}', damageModifiers, ${JSON.stringify(
          saveDamageMetadata,
        )}, 'damage')
\`\`\``
      : "";

  let altDamageButtons = "";
  if (spellAltDamage) {
    altDamageButtons = getAltSpellDamageButtons(
      spell,
      spellAltDamage,
      saveDamageMetadata,
      spellLevel,
      o.altDamageContext || null,
    );
  }

  const healingButton = spell?.data?.healing
    ? `\`\`\`Roll_Healing
api.promptRoll(\`${spellName} Healing\`, '${spellHealing}', ${JSON.stringify(
        healingModifiers,
      )}, {}, 'healing')
\`\`\``
    : "";

  // Roll Attack Button, if the spell is an attack. In the handler we get the
  // targets and roll for each — the DC for attacks is the enemy's AC.
  const rollAttackButton = spell?.data?.isAttack
    ? `\`\`\`Roll_Attack
const targets = api.getTargets();
const ourToken = api.getToken();
let disDueToProximity = false;
if (${rangedSpell} && ourToken) {
  api.getOtherTokens().forEach(token => {
    if (disDueToProximity) {
      // Short circuit if we already have disadvantage due to proximity
      return;
    }
    if (token?.faction !== 'neutral' && token?.faction !== ourToken?.faction) {
      // Check if you have the Invisible condition
      const hasInvisible = (ourToken?.effects || []).some((eff) =>
        eff.name.toLowerCase().includes("invisible")
      );
      // Check if they have incapacitated condition or are blinded
      const hasIncapacitated = (token?.effects || []).some(
        (eff) =>
          eff.name.toLowerCase().includes("incapacitated") ||
          eff.name.toLowerCase().includes("stunned") ||
          eff.name.toLowerCase().includes("paralyzed") ||
          eff.name.toLowerCase().includes("unconscious") ||
          eff.name.toLowerCase().includes("petrified") ||
          eff.name.toLowerCase().includes("dead") ||
          eff.name.toLowerCase().includes("blinded")
      );
      if (!hasIncapacitated && !hasInvisible) {
        // Check distance
        const distance = api.getDistance(ourToken, token);
        if (distance !== undefined && distance !== null && distance <= 5) {
          disDueToProximity = true;
        }
      }
    }
  });
}

let attackModifiers = ${JSON.stringify(attackModifiers)};

let autoCritical = attackModifiers.some(m => m.value === 'critical');
// Check for crit on 19 or some other number
const critOnMatch = /critical(\d+)/;
const critOnMods = attackModifiers
  .map(m => {
    const match = m.value.toString().match(critOnMatch);
    return match ? parseInt(match[1], 10) : null;
  })
  .filter(value => value !== null);

let critOn = null;
if (critOnMods.length) {
  critOn = Math.min(...critOnMods);
}

// Filter these out of the modifiers array, we don't need them to be toggleable
attackModifiers = attackModifiers.filter(m => !m.value.toString().startsWith('critical'));

const minRoll = getMinRollModifier(attackModifiers);
// Filter these out of the modifiers array, we don't need them to be toggleable
attackModifiers = attackModifiers.filter(
  (m) => !m.value.toString().startsWith("minroll")
);

targets.forEach(target => {
  // Get calculated AC from modifiers - use if any
  const targetAc = getArmorClassForToken(target?.token, { ranged: ${rangedSpell} });
  const targetName = target?.token?.identified === false ? target?.token?.record?.unidentifiedName : target?.token?.record?.name;
  const targetDistance = api.getDistance(ourToken, target?.token);
  const diceRoll = '1d20';

  // If this is a ranged spell, and there are enemies within 5 feet, apply disadvantage
  if (disDueToProximity) {
    attackModifiers.push({
      name: 'Enemy is Within 5 Feet',
      value: 'disadvantage',
      active: true
    });
  }

  // Get effects and modifiers for the target
  let hasNoAdvantage = false;
  const targetEffects = getAttackModifiersForTarget(target?.token, targetDistance, ourToken, ${rangedSpell}, true);
  targetEffects.forEach(r => {
    if (r.value === "critical") {
      autoCritical = true;
    } else if (r.value === "noAdvantage") {
      hasNoAdvantage = true;
    } else {
      attackModifiers.push(r);
    }
  });
  if (hasNoAdvantage) {
    attackModifiers = attackModifiers.filter(m => m.value !== "advantage");
  }

  // Get damage effects for the target
  const damageModifiers = JSON.parse(JSON.stringify(${JSON.stringify(
    damageModifiers,
  )}));
  const targetDamageEffects = getDamageEffectsForTarget(
    ourToken,
    target?.token,
  );
  targetDamageEffects.forEach((r) => {
    damageModifiers.push(r);
  });

  // Re-collect spell/cantrip damage bonuses that need target context (e.g.
  // target:effect:<slug>). Build-time had no target; merge spell + target
  // context so spell:/target: predicates resolve, mirror the field/type
  // handling, and dedup.
  {
    const _spellDmgCtx = Object.assign(
      {
        attackerToken: target?.token,
        targetToken: target?.token,
        targetCreatureType: target?.token?.data?.creatureType || "",
      },
      ${JSON.stringify(spellPredCtx)},
    );
    const _spellDmgTypes = ${spell?.data?.level?.toLowerCase() === "cantrip"}
      ? ["cantripDamageBonus", "cantripDamagePenalty"]
      : ["spellDamageBonus", "spellDamagePenalty"];
    let _spellDmgMods = getEffectsAndModifiersForToken(
      ourToken,
      _spellDmgTypes,
      ${JSON.stringify(spell?.data?.isAttack ? "attack" : "all")},
      undefined,
      undefined,
      _spellDmgCtx,
    );
    if (${!spell?.data?.isAttack}) {
      _spellDmgMods = _spellDmgMods.filter(
        (m) => (m?.field || "") !== "attack",
      );
    }
    _spellDmgMods.forEach((modifier) => {
      const _m = {
        ...modifier,
        type: modifier.value.toString().split(" ")?.[1]
          ? ""
          : ${JSON.stringify(primaryDamageType)},
      };
      const _e = damageModifiers.find(
        (x) => x.name === _m.name && x.value === _m.value,
      );
      if (_e) _e.active = _m.active;
      else damageModifiers.push(_m);
    });
  }

  const metadata = {
    "rollName": 'Attack',
    "attack": \`${spellName}\`,
    "icon": "IconWand",
    "portrait": ${JSON.stringify(spell?.portrait || "")},
    "targetName": targetName,
    "tooltip": \`Attack Roll for ${spellName}\`,
    "dc": targetAc,
    "damage": "${spellDamage}",
    "damageModifiers": damageModifiers,
    "damageIgnoresResistances": '${damageIgnoresResistances}',
    "damageIgnoresImmunities": '${damageIgnoresImmunities}',
    "autoCritical": autoCritical,
    "critOn": critOn,
    "minRoll": minRoll,
    "isSpell": true,
    "animation": ${JSON.stringify(animation)},
    "isRanged": ${rangedSpell},
    "tokenId": ourToken?._id,
    "targetId": target?.token?._id
  }
  api.promptRoll(\`${spellName}\`, \`\$\{diceRoll\}\`, attackModifiers, metadata, 'attack');
});
if (!targets.length) {
  const diceRoll = '1d20';
  const metadata = {
    "rollName": 'Attack',
    "attack": \`${spellName}\`,
    "icon": "IconWand",
    "portrait": ${JSON.stringify(spell?.portrait || "")},
    "tooltip": \`Attack Roll for ${spellName}\`,
    "dc": 0,
    "damage": "${spellDamage}",
    "critOn": critOn,
    "minRoll": minRoll,
    "damageModifiers": ${JSON.stringify(damageModifiers)},
    "damageIgnoresResistances": '${damageIgnoresResistances}',
    "damageIgnoresImmunities": '${damageIgnoresImmunities}',
    "animation": ${JSON.stringify(animation)},
    "isRanged": ${rangedSpell},
    "tokenId": ourToken?._id,
    "isSpell": true
  }

  // If this is a ranged spell, and there are enemies within 5 feet, apply disadvantage
  if (disDueToProximity) {
    attackModifiers.push({
      name: 'Enemy is Within 5 Feet',
      value: 'disadvantage',
      active: true
    });
  }

  api.promptRoll(\`${spellName}\`, \`\$\{diceRoll\}\`, attackModifiers, metadata, 'attack');
}
\`\`\``
    : "";

  // Saving Throw Buttons - look up saves of selected tokens and prompt roll for each
  const possibleSavingThrows = [];
  if (spell?.data?.isSave) {
    if (spell?.data?.savingThrow) {
      possibleSavingThrows.push(spell?.data?.savingThrow);
    }
    if (spell?.data?.additionalSavingThrows) {
      spell?.data?.additionalSavingThrows.forEach((additional) => {
        possibleSavingThrows.push(additional);
      });
    }
  }
  const rollSaveButtons = possibleSavingThrows
    .map((throwName) => {
      return `\`\`\`Roll_${capitalize(throwName)}_Save
const selectedTokens = api.getSelectedOrDroppedToken();
selectedTokens.forEach(token => {
  let saveModifiers = [];
  const isNpc = token?.linked === false || token?.recordType === 'npcs';
  if (isNpc) {
    // NPCs store a flat save total — use it directly.
    const modifier = token?.data?.['${throwName}Save'] || 0;
    if (modifier.toString() !== '0') {
      saveModifiers.push({ name: '${capitalize(throwName)} Save', value: modifier, active: true });
    }
  } else {
    // PCs: build from the ability modifier + proficiency each roll so override
    // effects that change the ability score / modifier are picked up.
    const abilityMod = parseInt(token?.data?.['${throwName}Mod'] || '0', 10) || 0;
    saveModifiers.push({ name: '${capitalize(throwName)}', value: abilityMod, active: true });
    const pb = parseInt(token?.data?.proficiencyBonus || '0', 10) || 0;
    if (token?.data?.['${throwName}Prof'] === 'true') {
      saveModifiers.push({ name: 'Proficient', value: pb, active: true });
    }
  }

  const _saveSrcCtx = { sourceName: ${JSON.stringify(spellName)}, attackerToken: ${JSON.stringify(buildSourceAttackerContext(api.getToken()))} };
  const saveMods = getEffectsAndModifiersForToken(token, ['saveBonus', 'savePenalty'], '${throwName}', undefined, undefined, _saveSrcCtx);
  // Also get modifiers specific to spells
  const spellSaveMods = getEffectsAndModifiersForToken(token, ['saveBonus', 'savePenalty'], 'spell', undefined, undefined, _saveSrcCtx);

  // Filter out duplicates based on name, value, type, and active status
  const allMods = [...saveMods, ...spellSaveMods].filter((mod, index, array) => {
    return index === array.findIndex(m =>
      m.name === mod.name &&
      m.value === mod.value &&
      m.modifierType === mod.modifierType &&
      m.active === mod.active
    );
  });

  allMods.forEach(mod => {
    saveModifiers.push(mod);
  });

  const minRoll = getMinRollModifier(saveModifiers);
  // Filter these out of the modifiers array, we don't need them to be toggleable
  saveModifiers = saveModifiers.filter(m => !m.value.toString().startsWith('minroll'));

  const metadata = {
    "rollName": '${capitalize(throwName)} Save',
    "tooltip": '${capitalize(throwName)} Saving Throw',
    "dc": ${saveDc},
    "minRoll": minRoll
  }

  api.promptRollForToken(token, '${capitalize(
    throwName,
  )} Save', '1d20', saveModifiers, metadata, 'save');
});
\`\`\``;
    })
    .join("\n");

  // Create macros for all effects that this spell can apply
  const effects = spell?.data?.effects || [];
  const effectButtons = getEffectMacrosFor(effects);

  const subHeader = o.subHeader ? `\n${o.subHeader}\n` : "";
  const message = `
#### ${spellIcon}${spellName}
${subHeader}
---
${spellDescription}

---
${rollAttackButton}
${rollSaveButtons}
${damageButton}
${altDamageButtons}
${healingButton}
${effectButtons}
`;

  // ── Tags ──────────────────────────────────────────────────────────────────
  const castingTime = spell?.data?.castingTime;
  const range = spell?.data?.range;
  let duration = spell?.data?.duration || "";
  // If there is a higher level duration, use that instead
  if (spellLevel >= 2) {
    duration = spell?.data?.[`durationLevel${spellLevel}`] || duration;
  }
  const hasConcentration = duration?.toLowerCase().startsWith("concentration");
  // Strip the concentration prefix for the display tag — supports both the
  // 5e "Concentration, up to X" syntax and the Level Up "Concentration (X)" syntax.
  const durationTag = duration
    .replace(/^Concentration,\s*(up\s+to\s+)?/i, "")
    .replace(/^Concentration\s*\(([^)]+)\)/i, "$1")
    .trim();

  let components = spell?.data?.components;
  if (components) {
    // First clean up any extra spaces around commas
    components = components.trim().replace(/\s*,\s*/g, ",");
    // Split on V, S, M, or F, ignoring case
    components = components.split(/,(?=[VSMF])/i);
    components = components.map((component) => {
      const trimmedComponent = component.trim().toLowerCase();
      if (trimmedComponent === "v") {
        return "Verbal";
      } else if (trimmedComponent === "s") {
        return "Somatic";
      } else if (trimmedComponent === "m") {
        return "Material";
      } else if (trimmedComponent === "f") {
        return "Focus";
      } else if (trimmedComponent.match(/^m\s*\(/i)) {
        // Check if material component has a cost
        return trimmedComponent.toLowerCase().includes("worth")
          ? "Material $"
          : "Material";
      }
      return component.trim();
    });
  }

  const tags = [
    {
      tooltip: "Cast a Spell",
      name: "Spell",
    },
  ];

  // Cast level tag — cantrips show as "Cantrip"; spell-level casts show
  // "Level N" using the level the spell was cast at.
  if (spell?.data?.level === "Cantrip") {
    tags.push({ tooltip: "Cast as a cantrip", name: "Cantrip" });
  } else {
    const castLevel = spellLevel || actualSpellLevel || 0;
    if (castLevel > 0) {
      tags.push({
        tooltip: `Cast at level ${castLevel}`,
        name: `Level ${castLevel}`,
      });
    }
  }

  if (castingTime) {
    tags.push({
      tooltip: "Casting Time",
      name: castingTime.includes(",") ? castingTime.split(",")[0] : castingTime,
    });
  }

  if (range) {
    tags.push({
      tooltip: "Range",
      name: range,
    });
  }

  if (hasConcentration) {
    tags.push({
      tooltip: "This Spell Requires Concentration",
      name: "Concentration",
    });
  }

  if (durationTag) {
    tags.push({
      tooltip: "Duration",
      name: durationTag,
    });
  }

  if (components && Array.isArray(components) && components.length > 0) {
    components.forEach((component) => {
      tags.push({
        tooltip: component.includes("$")
          ? "Spell Components (with Cost Requirement)"
          : "Spell Components",
        name: component,
      });
    });
  }

  // ── Concentration ─────────────────────────────────────────────────────────
  let lostConcentrationOn = "";
  if (hasConcentration) {
    const tokenForRecord = api.getToken();
    const tokenEffects = tokenForRecord?.effects || [];
    const primary = tokenEffects.find(
      (effect) => effect?.name?.toLowerCase() === "concentration",
    );
    const secondary = tokenEffects.find(
      (effect) => effect?.name?.toLowerCase() === "2nd concentration",
    );
    // dualConcentration: lets you hold a second concentration spell. 5e won't
    // stack a second effect with the same name, so the extra spell goes into a
    // distinct "2nd Concentration" slot rather than a duplicate "Concentration".
    const allowDual =
      o.dualConcentration !== false &&
      getEffectsAndModifiers(["dualConcentration"]).length > 0;
    if (tokenForRecord) {
      const effectValue = spellName;
      // Round-based durations apply in combat rounds; everything else in seconds.
      const effectDuration = getEffectDuration(duration);
      const oldValues = tokenForRecord?.effectValues || {};

      if (primary && allowDual) {
        // Already concentrating + dual active → use the 2nd Concentration slot,
        // keeping the primary spell. Replace any existing 2nd-slot spell.
        if (secondary) {
          if (oldValues[secondary._id]) {
            lostConcentrationOn = oldValues[secondary._id];
          }
          api.removeEffectById(secondary._id, tokenForRecord, () => {
            api.getRecord(record.recordType, record._id, (updatedRecord) => {
              api.addEffect(
                "2nd Concentration",
                updatedRecord,
                effectDuration,
                effectValue,
              );
            });
          });
        } else {
          api.addEffect(
            "2nd Concentration",
            tokenForRecord,
            effectDuration,
            effectValue,
          );
        }
      } else if (primary) {
        // Replacing the primary concentration also ends any 2nd slot.
        const lostNames = [];
        if (oldValues[primary._id]) lostNames.push(oldValues[primary._id]);
        if (secondary && oldValues[secondary._id]) {
          lostNames.push(oldValues[secondary._id]);
        }
        lostConcentrationOn = lostNames.join(" and ");

        const addPrimary = () =>
          api.getRecord(record.recordType, record._id, (updatedRecord) => {
            api.addEffect(
              "Concentration",
              updatedRecord,
              effectDuration,
              effectValue,
            );
          });

        if (secondary) {
          api.removeEffectById(secondary._id, tokenForRecord, () => {
            api.removeEffectById(primary._id, tokenForRecord, addPrimary);
          });
        } else {
          api.removeEffectById(primary._id, tokenForRecord, addPrimary);
        }
      } else {
        // Not concentrating yet — add the primary slot.
        api.addEffect(
          "Concentration",
          tokenForRecord,
          effectDuration,
          effectValue,
        );
      }
    }
  }

  api.sendMessage(message, undefined, [], tags);

  if (lostConcentrationOn) {
    api.sendMessage(
      `Lost concentration on ${lostConcentrationOn}.`,
      undefined,
      [],
      [],
    );
  }

  // ── Animation ─────────────────────────────────────────────────────────────
  if (animation === undefined || animation === null) {
    // Try to guess an animation based on the spell name and damage
    animation = getAnimationFor({
      abilityName: spellName,
      damage: spellDamage,
      healing: spellHealing,
      isRanged: rangedSpell,
      shape: getSpellShape(spell),
    });
  }

  // If not an attack and there is an animation, play it
  if (!rollAttackButton && animation && animation.animationName) {
    const ourToken = api.getToken();
    const targets = api.getTargets();
    if (ourToken && targets.length > 0) {
      targets.forEach((target) => {
        if (target.token) {
          api.playAnimation(animation, ourToken._id, target.token._id);
        }
      });
    } else if (ourToken) {
      api.playAnimation(animation, ourToken._id);
    }
  }

  if (typeof o.afterCast === "function") {
    o.afterCast({ spell, spellName, spellLevel, saveDc, resource });
  }
}
