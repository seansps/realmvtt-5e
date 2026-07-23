// ─── Safe Add Value ─────────────────────────────────────────────────────────

// Generate a UUID for new array items (normally done server-side by api.addValue).
function generateId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Replacement for api.addValue that avoids the stale client-cache bug.
// Fetches the latest record, reads the current array, appends the new item,
// then writes the full array back via api.setValues.
function safeAddValue(path, item, callback, recOverride) {
  const rec = recOverride || record;
  if (!item._id) {
    item._id = generateId();
  }
  if (item.unidentifiedName === undefined && item.name !== undefined) {
    item.unidentifiedName = item.name;
  }
  api.getRecord(rec.recordType || "characters", rec._id, (freshRec) => {
    const parts = path.split(".");
    let current = freshRec;
    for (let i = 0; i < parts.length; i++) {
      if (current == null) break;
      current = current[parts[i]];
    }
    const currentArray = Array.isArray(current) ? [...current] : [];
    currentArray.push(item);
    const fieldsToSet = {};
    fieldsToSet[path] = currentArray;
    api.setValues(fieldsToSet, (updatedRecord) => {
      if (callback) callback(updatedRecord);
    });
  });
}

// Process deferred ability groups sequentially to avoid race conditions.
// Each group is created if it doesn't exist, then abilities are added one by one,
// then group fields (uses, value, restore) are set.
function processDeferredAbilityGroups(groups, rec, done) {
  if (!groups || groups.length === 0) {
    done(rec);
    return;
  }
  // Defensive: data.abilityGroups must be an ARRAY. Some character records have
  // it stored as {} (empty object), which makes .find / array-path patches throw
  // "abilityGroups.find is not a function" in the client. Normalize to [] first,
  // re-fetch, then continue (the array branch below won't re-trigger this).
  if (!Array.isArray(rec?.data?.abilityGroups)) {
    api.setValues({ "data.abilityGroups": [] }, () => {
      api.getRecord(rec?.recordType || "characters", rec?._id, (fresh) => {
        processDeferredAbilityGroups(groups, fresh || rec, done);
      });
    });
    return;
  }
  let idx = 0;
  const processNext = (currentRec) => {
    if (idx >= groups.length) {
      done(currentRec);
      return;
    }
    const ag = groups[idx++];
    const existingGroup = (Array.isArray(currentRec?.data?.abilityGroups) ? currentRec.data.abilityGroups : []).find(
      (g) => g?.name === ag.abilityGroupName,
    );

    const afterGroupExists = (recWithGroup) => {
      const groupIdx = (Array.isArray(recWithGroup?.data?.abilityGroups) ? recWithGroup.data.abilityGroups : []).findIndex(
        (g) => g?.name === ag.abilityGroupName,
      );
      if (groupIdx === -1) {
        processNext(recWithGroup);
        return;
      }
      // Add abilities to the group sequentially
      let abilityIdx = 0;
      const addNextAbility = (latestRec) => {
        if (abilityIdx >= ag.allAbilities.length) {
          // Set group fields (uses, value, restore)
          const groupFields = {};
          if (ag.abilityUsesPerDay > 0) {
            const curDailyUses =
              latestRec.data?.abilityGroups?.[groupIdx]?.data?.maxDailyUses ||
              0;
            if (curDailyUses < ag.abilityUsesPerDay) {
              groupFields[`data.abilityGroups.${groupIdx}.data.maxDailyUses`] =
                ag.abilityUsesPerDay;
            }
            if (ag.abilityValue) {
              groupFields[`data.abilityGroups.${groupIdx}.data.value`] =
                ag.abilityValue;
            }
            if (ag.abilityRestoresOn !== "") {
              groupFields[`data.abilityGroups.${groupIdx}.data.restore`] =
                ag.abilityRestoresOn;
            }
            groupFields[
              `data.abilityGroups.${groupIdx}.fields.dailyUses.hidden`
            ] = false;
          }
          if (Object.keys(groupFields).length > 0) {
            api.setValues(groupFields, (r) => processNext(r));
          } else {
            // Async trampoline to unwind callback stack and avoid platform nesting limit
            api.getRecord(
              latestRec.recordType || "characters",
              latestRec._id,
              (r) => processNext(r),
            );
          }
          return;
        }
        const ability = ag.allAbilities[abilityIdx++];
        const abilityIdToAdd = JSON.parse(ability || "{}")?._id || "";
        if (abilityIdToAdd !== "") {
          const existingAbilities =
            latestRec?.data?.abilityGroups?.[groupIdx]?.data?.abilities || [];
          const alreadyExists = existingAbilities.some(
            (a) => a?._id === abilityIdToAdd,
          );
          if (alreadyExists) {
            addNextAbility(latestRec);
            return;
          }
          api.getRecord("abilities", abilityIdToAdd, (abilityRecord) => {
            if (!abilityRecord) {
              addNextAbility(latestRec);
              return;
            }
            safeAddValue(
              `data.abilityGroups.${groupIdx}.data.abilities`,
              abilityRecord,
              (r) => addNextAbility(r),
              latestRec,
            );
          });
        } else {
          addNextAbility(latestRec);
        }
      };
      addNextAbility(recWithGroup);
    };

    if (!existingGroup) {
      safeAddValue(
        "data.abilityGroups",
        {
          name: ag.abilityGroupName,
          data: {
            abilities: [],
            maxDailyUses: ag.abilityUsesPerDay,
            value: ag.abilityValue,
            restore: ag.abilityRestoresOn,
            savingThrowAbility: ag.savingThrowAbility,
            altSavingThrowAbility: ag.altSavingThrowAbility,
            fieldsToAddToUses: ag.fieldsToAddToUses,
          },
        },
        afterGroupExists,
        currentRec,
      );
    } else {
      afterGroupExists(currentRec);
    }
  };
  processNext(rec);
}

// ─── Skill & Ability Helpers ────────────────────────────────────────────────

function getAbilityFromSkill(skill) {
  switch (skill) {
    case "acrobatics":
      return "dexterity";
    case "animalHandling":
      return "wisdom";
    case "arcana":
      return "intelligence";
    case "athletics":
      return "strength";
    case "deception":
      return "charisma";
    case "history":
      return "intelligence";
    case "insight":
      return "wisdom";
    case "intimidation":
      return "charisma";
    case "investigation":
      return "intelligence";
    case "medicine":
      return "wisdom";
    case "nature":
      return "intelligence";
    case "perception":
      return "wisdom";
    case "performance":
      return "charisma";
    case "persuasion":
      return "charisma";
    case "religion":
      return "intelligence";
    case "sleightOfHand":
      return "dexterity";
    case "stealth":
      return "dexterity";
    case "survival":
      return "wisdom";
    default:
      return "strength"; // Default to strength if no match
  }
}

// Resolves an effect-driven skill-ability override (modifier type "skillAbility").
// An active skillAbility modifier whose field is the skill (e.g. "athletics")
// names an alternate ability to use for that skill check — either a literal
// ability ("strength") or the "Spellcasting Ability" sentinel (resolved to the
// character's best class spellcasting ability, same as attackCalculation). The
// override only wins if its ability modifier is HIGHER than the skill's
// currently-configured ability, matching effects like "you can use your
// spellcasting ability for Athletics checks". Returns { ability, abilityMod }.
function resolveSkillCheckAbility(rec, skill, baseAbility, baseAbilityMod, context) {
  const overrides = getEffectsAndModifiersForToken(
    rec,
    ["skillAbility"],
    skill,
    undefined,
    undefined,
    context,
  );
  let ability = baseAbility;
  let abilityMod = baseAbilityMod;
  overrides.forEach((mod) => {
    if (mod?.active === false) return;
    const raw = (mod?.value ?? "").toString().trim();
    if (!raw) return;
    // resolveAttackCalculationAbility handles the "Spellcasting Ability" sentinel
    // and passes literal ability names through unchanged.
    const candidate = (resolveAttackCalculationAbility(raw, rec) || "")
      .toLowerCase();
    if (!candidate) return;
    const candidateMod = parseInt(rec?.data?.[`${candidate}Mod`] || "0", 10) || 0;
    if (candidateMod > abilityMod) {
      ability = candidate;
      abilityMod = candidateMod;
    }
  });
  return { ability, abilityMod };
}

function capitalize(string) {
  if (!string || typeof string !== "string") return "";
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Calculate the passive value for a skill given its computed modifier.
// 5e: passive = 10 + skillMod.
function calcPassiveSkillFromMod(rec, skillField, skillMod) {
  let passive = 10 + skillMod;
  const r = rec || record;
  // passiveProficiency: treat as proficient for the passive score only (+prof)
  if (
    getEffectsAndModifiersForToken(r, ["passiveProficiency"], skillField).length >
    0
  ) {
    passive += parseInt(r?.data?.proficiencyBonus || "0", 10);
  }
  // passiveBonus / passivePenalty: flat adjustments (penalties arrive negated)
  getEffectsAndModifiersForToken(
    r,
    ["passiveBonus", "passivePenalty"],
    skillField,
  ).forEach((m) => {
    const v = parseInt(m.value, 10);
    if (!isNaN(v)) passive += v;
  });
  return passive;
}

// Write both the skill mod and its passive into a valuesToSet map.
// The passive is calculated for every skill; only three are currently
// surfaced in the UI (perception, investigation, insight).
function setSkillModAndPassive(valuesToSet, rec, skillField, skillMod) {
  valuesToSet[`data.${skillField}Mod`] = skillMod;
  const passiveKey = `data.passive${capitalize(skillField)}`;
  valuesToSet[passiveKey] = calcPassiveSkillFromMod(rec, skillField, skillMod);
}

function normalToCamelCase(str) {
  return str
    .toLowerCase()
    .replace(/\s+(.)/g, (match, char) => char.toUpperCase());
}

function camelToNormal(skill) {
  return skill.replace(/([A-Z])/g, " $1").replace(/^./, function (str) {
    return str.toUpperCase();
  });
}

const getNearestParentDataPath = (dataPath) => {
  const parts = dataPath.split(".data");
  return parts.length > 1 ? parts.slice(0, -1).join(".data") : "";
};

function getProficiencyBonus(level) {
  if (level <= 4) {
    return 2;
  }
  if (level <= 8) {
    return 3;
  }
  if (level <= 12) {
    return 4;
  }
  if (level <= 16) {
    return 5;
  }
  if (level <= 20) {
    return 6;
  }
  if (level <= 24) {
    return 7;
  }
  if (level <= 28) {
    return 8;
  }
  return 9;
}

function getXPForCR(cr) {
  switch (cr) {
    case "0":
      return "10";
    case "1/8":
      return "25";
    case "1/4":
      return "50";
    case "1/2":
      return "100";
    case "1":
      return "200";
    case "2":
      return "450";
    case "3":
      return "700";
    case "4":
      return "1,100";
    case "5":
      return "1,800";
    case "6":
      return "2,300";
    case "7":
      return "2,900";
    case "8":
      return "3,900";
    case "9":
      return "5,000";
    case "10":
      return "5,900";
    case "11":
      return "7,200";
    case "12":
      return "8,400";
    case "13":
      return "10,000";
    case "14":
      return "11,500";
    case "15":
      return "13,000";
    case "16":
      return "15,000";
    case "17":
      return "18,000";
    case "18":
      return "20,000";
    case "19":
      return "22,000";
    case "20":
      return "25,000";
    case "21":
      return "33,000";
    case "22":
      return "41,000";
    case "23":
      return "50,000";
    case "24":
      return "62,000";
    case "25":
      return "75,000";
    case "26":
      return "90,000";
    case "27":
      return "105,000";
    case "28":
      return "120,000";
    case "29":
      return "135,000";
    case "30":
      return "155,000";
    default:
      if (parseInt(cr, 10) > 30) {
        return "155,000";
      }
      return "0";
  }
}

// Returns all skills by name with their ability fields and defaults
function getSkills() {
  return [
    {
      name: "Acrobatics",
      field: "acrobatics",
      ability: "dexterity",
    },
    {
      name: "Animal Handling",
      field: "animalHandling",
      ability: "wisdom",
    },
    {
      name: "Arcana",
      field: "arcana",
      ability: "intelligence",
    },
    {
      name: "Athletics",
      field: "athletics",
      ability: "strength",
    },
    {
      name: "Deception",
      field: "deception",
      ability: "charisma",
    },
    {
      name: "History",
      field: "history",
      ability: "intelligence",
    },
    {
      name: "Insight",
      field: "insight",
      ability: "wisdom",
    },
    {
      name: "Intimidation",
      field: "intimidation",
      ability: "charisma",
    },
    {
      name: "Investigation",
      field: "investigation",
      ability: "intelligence",
    },
    {
      name: "Medicine",
      field: "medicine",
      ability: "wisdom",
    },
    {
      name: "Nature",
      field: "nature",
      ability: "intelligence",
    },
    {
      name: "Perception",
      field: "perception",
      ability: "wisdom",
    },
    {
      name: "Performance",
      field: "performance",
      ability: "charisma",
    },
    {
      name: "Persuasion",
      field: "persuasion",
      ability: "charisma",
    },
    {
      name: "Religion",
      field: "religion",
      ability: "intelligence",
    },
    {
      name: "Sleight of Hand",
      field: "sleightOfHand",
      ability: "dexterity",
    },
    {
      name: "Stealth",
      field: "stealth",
      ability: "dexterity",
    },
    {
      name: "Survival",
      field: "survival",
      ability: "wisdom",
    },
  ];
}

// Get the carry and drag/lift/push weights for a creature
function getCarryWeight(strength, size) {
  let carry = 0;
  let dragLiftPush = 0;

  if (size.toLowerCase() === "tiny") {
    carry = strength * 7.5;
    dragLiftPush = strength * 15;
  } else if (size.toLowerCase() === "small") {
    carry = strength * 15;
    dragLiftPush = strength * 30;
  } else if (size.toLowerCase() === "medium") {
    carry = strength * 15;
    dragLiftPush = strength * 30;
  } else if (size.toLowerCase() === "large") {
    carry = strength * 30;
    dragLiftPush = strength * 60;
  } else if (size.toLowerCase() === "huge") {
    carry = strength * 60;
    dragLiftPush = strength * 120;
  } else if (size.toLowerCase() === "gargantuan") {
    carry = strength * 120;
    dragLiftPush = strength * 240;
  } else {
    // Default to Medium
    carry = strength * 15;
    dragLiftPush = strength * 30;
  }

  return {
    carry: carry,
    dragLiftPush: dragLiftPush,
  };
}

function getHpBonusFromModifiers(hpMaxMods) {
  let totalBonus = 0;
  hpMaxMods.forEach((mod) => {
    // For string type in HP max, we'll use it as a field
    if (mod.valueType === "string") {
      // After getting the replacements from getEffectsAndModifiers, we need to evaluate any math
      let bonus = evaluateMath(mod.value);
      if (!isNaN(bonus)) {
        totalBonus += bonus;
      }
    } else {
      const bonus = parseInt(mod.value || "0", 10);
      if (!isNaN(bonus)) {
        totalBonus += bonus;
      }
    }
  });
  return totalBonus;
}

function getDurationInSeconds(duration) {
  if (!duration) return 0;

  // Strip the concentration prefix — supports both the 5e "Concentration,
  // up to X" syntax and the Level Up "Concentration (X)" syntax so durations
  // authored in either style parse correctly.
  const cleanDuration = duration
    .toLowerCase()
    .replace(/^concentration,\s+up\s+to\s+/, "")
    .replace(/^concentration\s*\(([^)]+)\)/, "$1");

  // Parse the string to get the number and unit
  const match = cleanDuration.match(/(\d+)\s+(round|minute|hour|day|week)s?/i);
  if (match) {
    const timeAmount = parseInt(match[1], 10);
    if (isNaN(timeAmount)) {
      return 0;
    }

    const timeUnit = match[2].toLowerCase();
    switch (timeUnit) {
      case "round":
        return timeAmount * 6; // 1 round = 6 seconds
      case "minute":
        return timeAmount * 60; // 1 minute = 60 seconds
      case "hour":
        return timeAmount * 3600; // 1 hour = 3600 seconds
      case "day":
        return timeAmount * 86400; // 1 day = 86400 seconds
      case "week":
        return timeAmount * 604800; // 1 week = 604800 seconds
      default:
        return 0;
    }
  }
  return 0;
}

// Resolve a spell's duration string into the `effectDuration` argument for
// api.addEffect. Round-based durations (e.g. "Concentration, up to 6 rounds")
// return { value, unit: "rounds" } so the effect counts down per combat
// round rather than by elapsed real seconds. A flat "1 minute" duration is
// short enough to plausibly lapse mid-combat, so it is applied as 10 combat
// rounds. Everything else falls back to a plain seconds number.
function getEffectDuration(duration) {
  if (!duration) return 0;

  // Strip the concentration prefix the same way getDurationInSeconds does.
  const cleanDuration = duration
    .toLowerCase()
    .replace(/^concentration,\s+up\s+to\s+/, "")
    .replace(/^concentration\s*\(([^)]+)\)/, "$1");

  const roundsMatch = cleanDuration.match(/(\d+)\s+rounds?/i);
  if (roundsMatch) {
    const value = parseInt(roundsMatch[1], 10);
    if (!isNaN(value)) {
      return { value, unit: "rounds" };
    }
  }

  // Special case: a flat "1 minute" duration could lapse mid-combat, so apply
  // it as 10 combat rounds (1 minute = 10 rounds) rather than 60 elapsed
  // seconds. Longer minute durations are left alone.
  const minutesMatch = cleanDuration.match(/(\d+)\s+minutes?/i);
  if (minutesMatch && parseInt(minutesMatch[1], 10) === 1) {
    return { value: 10, unit: "rounds" };
  }

  return getDurationInSeconds(duration);
}

// Helper function to deduplicate hpByLevel array
// When users re-roll, they may get duplicate levels
// We keep the highest HP value and remove duplicates
function deduplicateHpByLevel(hpByLevelArr) {
  const levelMap = new Map();

  // Build a map of level -> entry with highest HP
  hpByLevelArr.forEach((entry) => {
    const key = entry.level;
    const existing = levelMap.get(key);

    if (!existing || entry.hp > existing.hp) {
      levelMap.set(key, entry);
    }
  });

  // Convert back to array, sorted by level
  const deduplicated = Array.from(levelMap.values()).sort(
    (a, b) => a.level - b.level,
  );

  // Check if deduplication actually changed anything
  const hasChanges = deduplicated.length !== hpByLevelArr.length;

  return { deduplicated, hasChanges };
}

function getHpForLevel(conMod, recordOverride = null) {
  let thisRecord = recordOverride || record;

  let totalHp = 0;

  // Calculate HP from individual level fields (hpLevel1, hpLevel2, etc.)
  // This ensures we account for all levels, including multiclass
  const characterLevel = parseInt(thisRecord?.data?.level || "0", 10);

  for (let level = 1; level <= characterLevel; level++) {
    const hpForLevel = parseInt(
      thisRecord?.data?.[`hpLevel${level}`] || "0",
      10,
    );
    if (hpForLevel > 0) {
      let thisLevelHp = hpForLevel + conMod;
      // Each time you level you roll or take average + CON MOD to a min of 1
      if (thisLevelHp < 1) {
        thisLevelHp = 1;
      }
      totalHp += thisLevelHp;
    }
  }

  // Get HP Max modifier
  const hpMaxMods = getEffectsAndModifiersForToken(thisRecord, "hitpoints");
  totalHp += getHpBonusFromModifiers(hpMaxMods);

  return totalHp;
}

// On Change of Attributes, Set the Relavant Mods
function setModifier(
  value,
  attribute,
  skillProfOverrides = {},
  moreValuesToSet = null,
) {
  const modField = `${attribute}Mod`;
  const saveField = `${attribute}Save`;
  const saveProf = `${attribute}Prof`;

  const valuesToSet = {};

  const val = parseInt(value, 10);
  if (isNaN(val)) {
    return;
  }
  const modVal = Math.floor((val - 10) / 2);
  let modValStr = `${modVal}`;
  if (modVal >= 0) {
    modValStr = `+${modVal}`;
  }
  valuesToSet[`data.${modField}`] = modValStr;

  let proficiencyBonus = parseInt(
    record?.data?.["proficiencyBonus"] || "2",
    10,
  );
  if (isNaN(proficiencyBonus)) {
    proficiencyBonus = 0;
  }

  const isProficient = record?.data?.[saveProf] === "true";
  const savVal = isProficient ? modVal + proficiencyBonus : modVal;
  valuesToSet[`data.${saveField}`] = savVal;

  // Update hit points if this is constitution
  if (attribute === "constitution") {
    // Deduplicate hpByLevel in case of re-rolls
    const hpByLevel = record?.data?.hpByLevel || "[]";
    let hpByLevelArr = JSON.parse(hpByLevel);
    const { deduplicated, hasChanges } = deduplicateHpByLevel(hpByLevelArr);

    if (hasChanges) {
      valuesToSet["data.hpByLevel"] = JSON.stringify(deduplicated);
    }

    const level = parseInt(record?.data?.level || "0", 10);
    let newHp = getHpForLevel(modVal);
    if (level > 0 && newHp < 1) {
      // To a minimum of 1
      newHp = 1;
    }
    // Set our HP to be totalHp per level + conMod * level
    valuesToSet["data.hitpoints"] = newHp;
  }

  // Update carry weight if strength
  if (attribute === "strength") {
    let size = record?.data?.size || "Medium";
    // encumbranceSizeIncrease: count as a larger size for carry capacity
    // (e.g. Powerful Build). Each modifier bumps the size up by its value (or 1).
    const sizeOrder = [
      "tiny",
      "small",
      "medium",
      "large",
      "huge",
      "gargantuan",
    ];
    let sizeSteps = 0;
    getEffectsAndModifiers(["encumbranceSizeIncrease"]).forEach((mod) => {
      const v = parseInt(mod.value, 10);
      sizeSteps += isNaN(v) ? 1 : v;
    });
    if (sizeSteps > 0) {
      const idx = sizeOrder.indexOf(size.toLowerCase());
      if (idx >= 0) {
        size = sizeOrder[Math.min(idx + sizeSteps, sizeOrder.length - 1)];
      }
    }
    const { carry, dragLiftPush } = getCarryWeight(val, size);
    valuesToSet["data.maxCarryWeight"] = carry;
    valuesToSet["data.dragLiftPush"] = dragLiftPush;
  }

  // Update AC as needed
  const acCalculationMods = getEffectsAndModifiers(["armorClassCalculation"]);
  let dexMod =
    attribute !== "dexterity"
      ? parseInt(record?.data?.dexterityMod || "0", 10)
      : modVal;
  if (
    moreValuesToSet &&
    moreValuesToSet[`data.dexterityMod`] &&
    parseInt(moreValuesToSet[`data.dexterityMod`] || "0", 10) > dexMod
  ) {
    dexMod = parseInt(moreValuesToSet[`data.dexterityMod`] || "0", 10);
  }
  const bestEquippedArmor = record?.data?.armor || undefined;
  let armorClass = 10 + dexMod;
  if (bestEquippedArmor && bestEquippedArmor.ac > 0) {
    // PC's base class is the best equipped armor if provided
    // Add the dex bonus to the ac, using max dex as the max.
    // If maxDex is not set or is 0, we set it to 99 to allow for max dex bonus
    armorClass =
      bestEquippedArmor.ac +
      (bestEquippedArmor.maxDex
        ? Math.min(dexMod, bestEquippedArmor.maxDex)
        : 0);
  }
  let calcBonus = 0;
  // Only add acCalculationMods if we are unarmored
  if (bestEquippedArmor?.ac === 0 || !bestEquippedArmor) {
    acCalculationMods.forEach((mod) => {
      // We only benefit from the highest AC calculation modifier
      if (mod.field && mod.field !== "dexterity") {
        let acBonus =
          attribute !== mod.field
            ? parseInt(record?.data?.[`${mod.field}Mod`] || "0", 10)
            : modVal;
        if (
          moreValuesToSet &&
          moreValuesToSet[`data.${mod.field}Mod`] &&
          parseInt(moreValuesToSet[`data.${mod.field}Mod`] || "0", 10) > acBonus
        ) {
          acBonus = parseInt(
            moreValuesToSet[`data.${mod.field}Mod`] || "0",
            10,
          );
        }
        if (acBonus > calcBonus) {
          calcBonus = acBonus;
        }
      }
    });
  }
  // Get general AC bonuses
  const acBonuses = getEffectsAndModifiers(["armorClassBonus"]);
  acBonuses.forEach((mod) => {
    if (mod.value) {
      const acBonus = parseInt(mod.value || "0", 10);
      if (!isNaN(acBonus)) {
        calcBonus += acBonus;
      }
    }
  });
  // Add shield if it is equipped
  if (bestEquippedArmor?.shieldAc) {
    armorClass += bestEquippedArmor.shieldAc;
  }
  armorClass += calcBonus;
  valuesToSet["data.ac"] = armorClass;

  getSkills().forEach((skill) => {
    // Get the ability being used for this skill, fallback to the skill's default
    const ability = record?.data?.[`${skill.field}Ability`] || skill.ability;

    if (ability === attribute) {
      // Skills can be also be half, proficient, or expertise
      const proficiency =
        skillProfOverrides[`data.${skill.field}Prof`] ||
        record?.data?.[`${skill.field}Prof`] ||
        "false";
      const isHalfProficient = proficiency === "half";
      const isExpertise = proficiency === "expertise";
      const isProficient = proficiency === "true";
      let totalVal = modVal;
      if (isHalfProficient) {
        totalVal = modVal + Math.floor(proficiencyBonus / 2);
      } else if (isExpertise) {
        totalVal = modVal + proficiencyBonus * 2;
      } else if (isProficient) {
        totalVal = modVal + proficiencyBonus;
      } else {
        totalVal = modVal;
      }

      setSkillModAndPassive(valuesToSet, record, skill.field, totalVal);
    }
  });

  // Also update otherSkills
  const otherSkills = record?.data?.otherSkills || [];
  otherSkills.forEach((skill, index) => {
    if (skill?.data?.ability === attribute) {
      // Skills can be also be half, proficient, or expertise
      const proficiency = skill?.data?.skillProf || "false";
      const isHalfProficient = proficiency === "half";
      const isExpertise = proficiency === "expertise";
      const isProficient = proficiency === "true";
      if (isHalfProficient) {
        valuesToSet[`data.otherSkills.${index}.data.skillMod`] =
          modVal + Math.floor(proficiencyBonus / 2);
      } else if (isExpertise) {
        valuesToSet[`data.otherSkills.${index}.data.skillMod`] =
          modVal + proficiencyBonus * 2;
      } else if (isProficient) {
        valuesToSet[`data.otherSkills.${index}.data.skillMod`] =
          modVal + proficiencyBonus;
      } else {
        valuesToSet[`data.otherSkills.${index}.data.skillMod`] = modVal;
      }
    }
  });

  // Go through abilityGroups and update maxDailyUses if needed
  // (guard: must be an array — some records store it as {} which would crash)
  const abilityGroups = Array.isArray(record?.data?.abilityGroups)
    ? record.data.abilityGroups
    : [];
  abilityGroups.forEach((abilityGroup, index) => {
    if (
      abilityGroup?.data?.fieldsToAddToUses &&
      abilityGroup?.data?.fieldsToAddToUses.length > 0
    ) {
      const totalUses = getTotalValueFromFields(
        record,
        abilityGroup?.data?.fieldsToAddToUses || [],
        valuesToSet,
      );
      if (totalUses > 0) {
        valuesToSet[`data.abilityGroups.${index}.data.maxDailyUses`] =
          totalUses;
      }
    }
  });

  if (Object.keys(valuesToSet).length > 0) {
    if (moreValuesToSet) {
      Object.keys(valuesToSet).forEach((key) => {
        moreValuesToSet[key] = valuesToSet[key];
      });
    } else {
      api.setValues(valuesToSet);
    }
  }
}

function evaluateTernary(expression) {
  const expr = expression.trim();
  // Find the first top-level ? (not nested)
  const qIdx = expr.indexOf("?");
  if (qIdx === -1) return expr;
  const condition = expr.substring(0, qIdx).trim();
  const rest = expr.substring(qIdx + 1).trim();
  // Find the matching : for this ? (handle nested ternaries by counting ? and :)
  let depth = 0;
  let colonIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "?") depth++;
    if (rest[i] === ":") {
      if (depth === 0) {
        colonIdx = i;
        break;
      }
      depth--;
    }
  }
  if (colonIdx === -1) return expr;
  const trueValue = rest.substring(0, colonIdx).trim();
  const falseValue = rest.substring(colonIdx + 1).trim();
  // Evaluate condition
  const condResult = evaluateCondition(condition);
  if (condResult) {
    // True branch may itself be a ternary
    return trueValue.includes("?") ? evaluateTernary(trueValue) : trueValue;
  } else {
    return falseValue.includes("?") ? evaluateTernary(falseValue) : falseValue;
  }
}

// Evaluate a simple comparison condition: "A op B"
// Supports: >=, <=, >, <, ==, !=
function evaluateCondition(condition) {
  const operators = [">=", "<=", "!=", "==", ">", "<"];
  for (const op of operators) {
    const idx = condition.indexOf(op);
    if (idx !== -1) {
      const left = parseFloat(condition.substring(0, idx).trim());
      const right = parseFloat(condition.substring(idx + op.length).trim());
      if (isNaN(left) || isNaN(right)) return false;
      switch (op) {
        case ">=":
          return left >= right;
        case "<=":
          return left <= right;
        case "!=":
          return left !== right;
        case "==":
          return left === right;
        case ">":
          return left > right;
        case "<":
          return left < right;
      }
    }
  }
  // No operator found — treat as truthy if non-zero number
  const val = parseFloat(condition);
  return !isNaN(val) && val !== 0;
}

function evaluateMath(stringValue) {
  // Return 0 if no value provided
  if (!stringValue) return 0;

  try {
    // Remove all whitespace and validate string only contains valid math characters
    const sanitizedString = stringValue.replace(/\s+/g, "");
    if (!/^[0-9+\-*/().]+$/.test(sanitizedString)) {
      return 0;
    }

    // Use Function constructor to safely evaluate the math expression
    // Math.floor to match D&D's rounding down convention
    return Math.floor(Function(`'use strict'; return (${sanitizedString})`)());
  } catch (e) {
    // Return 0 if evaluation fails
    return 0;
  }
}

// Like evaluateMath but honors the named helpers ceil/floor/round/abs/min/max
// and does NOT implicitly floor the result (so `ceil(1/2)` is 1, not 0). Used
// for `{...}` blocks that contain one of those functions.
function evaluateMathExpression(stringValue) {
  if (!stringValue) return 0;
  try {
    // Map the bare helper names to Math.* so they're callable.
    const mapped = stringValue.replace(
      /\b(ceil|floor|round|abs|min|max)\b/gi,
      (m) => "Math." + m.toLowerCase(),
    );
    // Validate: after removing the allowed Math.* helpers, only digits,
    // operators, parens, commas, dots and whitespace may remain. This blocks
    // arbitrary identifiers / code from being evaluated.
    const stripped = mapped.replace(
      /Math\.(?:ceil|floor|round|abs|min|max)/g,
      "",
    );
    if (!/^[\s0-9+\-*/().,]*$/.test(stripped)) {
      return 0;
    }
    const result = Function(`'use strict'; return (${mapped})`)();
    return typeof result === "number" && isFinite(result) ? result : 0;
  } catch (e) {
    return 0;
  }
}

function applyMath(value, math) {
  // Trim spaces and split the string into operator and number
  const trimmedMath = math.trim();
  const operator = trimmedMath.charAt(0);
  const number = parseInt(trimmedMath.slice(1).trim(), 10);

  if (isNaN(number)) {
    return value;
  }

  switch (operator) {
    case "+":
      return value + number;
    case "-":
      return value - number;
    case "*":
      return value * number;
    case "/":
      return Math.floor(value / number); // Always round down
    default:
      return value;
  }
}

function getDamageType(rollString) {
  const regex = /(?:\d*d\d+|\+\d+)?(?:\s*\+?-?\s*\d+)?(?:\s+([\w-_]+))?/;
  const match = rollString.match(regex);
  return match && match[1] ? match[1] : "untyped";
}

// Extracts ALL damage types from a (possibly multi-segment) damage formula.
// e.g. "2d8 bludgeoning + 4d6 cold" -> ["bludgeoning","cold"]; "1d6 fire" ->
// ["fire"]; "2d6" -> []. Splits on "+" and "," and reuses getDamageType per
// segment (which only treats a SPACE-separated trailing word as a type, so a
// bare "2d8" yields no false "d8" type). Order-preserving, de-duplicated.
function getDamageTypes(formula) {
  if (!formula || typeof formula !== "string") return [];
  const types = [];
  formula.split(/[+,]/).forEach((segment) => {
    const t = getDamageType(segment.trim());
    if (t && t.toLowerCase() !== "untyped" && !types.includes(t)) {
      types.push(t);
    }
  });
  return types;
}

// Doubles the dice in the damage string
function doubleDamageDice(damage) {
  if (damage && typeof damage === "string" && damage.includes("d")) {
    return damage.replace(/(\d+)?d(\d+)/g, (match, n, d) => {
      n = n ? parseInt(n) * 2 : 2; // If n is undefined, it means 1d, so we use 2
      return `${n}d${d}`;
    });
  }
  return damage;
}

// Checks for replacements in a string modifier
function checkForReplacements(
  value,
  replacements = {},
  recordOverride = null,
  casterToken = null,
) {
  let thisRecord = recordOverride || record;
  // Case for 'Half Character Level' or 'Half <class> Level'
  const matchLevel = value.match(/[Hh]alf (\w+) [Ll]evel/);
  const matchClassLevel = value.match(/(\w+) [Ll]evel/);
  if (matchLevel) {
    const className = matchLevel[1];
    if (className.toLowerCase() === "character") {
      // Character half level
      const characterLevel = parseInt(thisRecord?.data?.level || "1", 10);
      value = value.replaceAll(matchLevel[0], Math.floor(characterLevel / 2));
    } else {
      // Class specific half level (resolve Level Up class aliases, e.g. Adept → Monk)
      const characterClassLevel =
        (thisRecord?.data?.classLevels || "")
          .toLowerCase()
          .match(`${resolveClassAlias(className)} (\\d+)`)?.[1] || 0;
      if (characterClassLevel) {
        value = value.replaceAll(
          matchLevel[0],
          Math.floor(parseInt(characterClassLevel || "1", 10) / 2),
        );
      }
    }
  }
  // Case for '<class> Level'
  else if (matchClassLevel) {
    const className = matchClassLevel[1];
    if (className.toLowerCase() === "character") {
      // Character level
      const characterLevel = parseInt(thisRecord?.data?.level || "1", 10);
      value = value.replaceAll(matchClassLevel[0], characterLevel);
    } else {
      // Class specific level (resolve Level Up class aliases, e.g. Adept → Monk)
      const characterClassLevel =
        (thisRecord?.data?.classLevels || "")
          .toLowerCase()
          .match(`${resolveClassAlias(className)} (\\d+)`)?.[1] || 0;
      if (characterClassLevel) {
        value = value.replaceAll(
          matchClassLevel[0],
          parseInt(characterClassLevel || "1", 10),
        );
      }
    }
  }
  // Case for 'Proficiency Bonus'
  const matchProficiencyBonus = value.match(/[Pp]roficiency [Bb]onus/);
  if (matchProficiencyBonus) {
    value = value.replaceAll(
      matchProficiencyBonus[0],
      thisRecord?.data?.proficiencyBonus || 0,
    );
  }
  // Case for Strength|Dexterity|Constitution|Wisdom|Intelligence|Charisma Modifier
  const matchModifier = value.match(
    /[Ss]trength [Mm]odifier|[Dd]exterity [Mm]odifier|[Cc]onstitution [Mm]odifier|[Ww]isdom [Mm]odifier|[Ii]ntelligence [Mm]odifier|[Cc]harisma [Mm]odifier/,
  );
  if (matchModifier) {
    const attributeMod = parseInt(
      thisRecord?.data?.[
        `${matchModifier[0]
          .toLowerCase()
          .replace(" ", "")
          .replace("modifier", "")}Mod`
      ] || "0",
      10,
    );
    value = value.replaceAll(matchModifier[0], attributeMod);
  }
  // Whether the value is a function-style expression (ternary/gte/...) — string
  // path values are then quoted so they're valid arguments to those functions.
  const isFunctionExpr =
    /^(ternary|lt|lte|gt|gte|eq|ne|and|or|not|nand|xor)\(/.test(value.trim());

  // Replace @record.data.X with the value at that path on the character
  const recordDataMatches = [...value.matchAll(/@record\.data\.([\w.]+)/g)];
  for (const match of recordDataMatches) {
    const path = match[1];
    let resolved = thisRecord?.data;
    for (const segment of path.split(".")) {
      resolved = resolved?.[segment];
    }
    if (resolved !== undefined && resolved !== null) {
      const replacement =
        isFunctionExpr && typeof resolved === "string"
          ? `'${String(resolved).replace(/'/g, "\\'")}'`
          : String(resolved);
      value = value.replaceAll(match[0], replacement);
    }
  }

  // Replace @caster.data.X with the value at that path on the caster/attacker
  // token. Used for effects whose value resolves against whoever applied them.
  if (casterToken) {
    const casterDataMatches = [...value.matchAll(/@caster\.data\.([\w.]+)/g)];
    for (const match of casterDataMatches) {
      const path = match[1];
      let resolved = casterToken?.data;
      for (const segment of path.split(".")) {
        resolved = resolved?.[segment];
      }
      if (resolved !== undefined && resolved !== null) {
        const replacement =
          isFunctionExpr && typeof resolved === "string"
            ? `'${String(resolved).replace(/'/g, "\\'")}'`
            : String(resolved);
        value = value.replaceAll(match[0], replacement);
      }
    }
  }

  // Check for replacements in the replacements object
  if (replacements && Object.keys(replacements).length > 0) {
    Object.keys(replacements).forEach((key) => {
      value = value.replaceAll(key, replacements[key]);
    });
  }

  // Evaluate expressions in curly braces — supports math and ternaries.
  // Math example: {floor(Character Level / 2)} or {max(1, Charisma Modifier)}
  // Ternary example: {Character Level >= 16 ? 1d10 : Character Level >= 11 ? 1d8 : 1d4}
  value = value.replace(/\{([^}]+)\}/g, (_match, expression) => {
    // Check for ternary syntax (contains ? and :)
    if (expression.includes("?")) {
      return evaluateTernary(expression);
    }
    // If the expression uses a named helper (ceil/floor/round/abs/min/max),
    // evaluate it honoring that function (e.g. ceil(1/2) → 1). Plain arithmetic
    // still rounds down via evaluateMath (D&D convention).
    if (/\b(?:ceil|floor|round|abs|min|max)\s*\(/i.test(expression)) {
      return String(evaluateMathExpression(expression));
    }
    const result = evaluateMath(expression);
    return String(result);
  });

  // Evaluate function-style expressions matching the effects engine syntax,
  // e.g. ternary(gte(@record.data.effects.stoneskin.spellLevel, 7), a, b).
  if (
    /^(ternary|lt|lte|gt|gte|eq|ne|and|or|not|nand|xor)\(/.test(value.trim())
  ) {
    return String(evaluateFunctions(value.trim()));
  }

  return value;
}

// Extracts the base die type from a damage string (e.g. "2d6 slashing" → "d6").
function getBaseDieType(damage) {
  const match = (damage || "").match(/d\d+/);
  return match ? match[0] : "0";
}

// Resolves @damageDie references in a value string, replacing with the base die
// type. "2@damageDie" → "2d6"; standalone "@damageDie" → "1d6".
function resolveDamageDie(modValue, baseDie) {
  if (modValue && modValue.includes("@damageDie")) {
    return modValue.replace(/(\d?)@damageDie/g, (match, prefix) => {
      return (prefix || "1") + baseDie;
    });
  }
  return modValue;
}

// Level Up → 5e class-name translations. Lets content imported from the Level Up
// ruleset resolve correctly: an Adept's "adeptLevel" reads the character's Monk
// level, Herald → Paladin, Berserker → Barbarian. Keyed/valued in lowercase.
const CLASS_ALIASES = {
  adept: "monk",
  herald: "paladin",
  berserker: "barbarian",
};

// Normalize a class name (or "{class}" portion of a "{class}Level" field) through
// the alias map. Accepts any casing; returns lowercase.
function resolveClassAlias(name) {
  const lower = (name || "").toString().trim().toLowerCase();
  return CLASS_ALIASES[lower] || lower;
}

function isClassLevel(field) {
  if (typeof field !== "string" || !field.endsWith("Level")) return false;
  return [
    "artificerLevel",
    "barbarianLevel",
    "bardLevel",
    "clericLevel",
    "druidLevel",
    "fighterLevel",
    "monkLevel",
    "paladinLevel",
    "rangerLevel",
    "rogueLevel",
    "sorcererLevel",
    "warlockLevel",
    "wizardLevel",
    // Level Up class aliases (resolve to a 5e class via CLASS_ALIASES)
    "adeptLevel",
    "heraldLevel",
    "berserkerLevel",
  ].includes(field);
}

function getClassLevel(recordContext, field, fieldValueOverrides) {
  const className = resolveClassAlias(field.replace("Level", ""));
  let classLevels = recordContext?.data?.classLevels || "";
  if (fieldValueOverrides && fieldValueOverrides[`data.classLevels`]) {
    classLevels = fieldValueOverrides[`data.classLevels`];
  }
  const classLevel =
    classLevels.toLowerCase().match(`${className} (\\d+)`)?.[1] || 0;
  return parseInt(classLevel || "0", 10);
}

function getTotalValueFromFields(
  recordContext,
  fieldsToAddToUses,
  fieldValueOverrides,
  abilityGroupName,
) {
  let total = 0;
  let times2 = false;
  let times5 = false;
  let plusN = 0;
  fieldsToAddToUses.forEach((field) => {
    let value = 0;
    if (field === "times2") {
      times2 = true;
      return;
    } else if (field === "times5") {
      times5 = true;
      return;
    } else if (/^plus(\d+)$/.test(field)) {
      plusN += parseInt(field.replace("plus", ""), 10) || 0;
      return;
    } else if (field === "halfProficiencyBonus") {
      value = Math.floor(
        parseInt(recordContext?.data?.proficiencyBonus || "0", 10) / 2,
      );
    } else if (field === "warlockSpellcastingMod") {
      // 5e warlocks cast with Charisma
      value = parseInt(recordContext?.data?.charismaMod || "0", 10);
    } else if (isClassLevel(field)) {
      value = getClassLevel(recordContext, field, fieldValueOverrides);
    } else {
      value = parseInt(recordContext?.data?.[field] || "0", 10);
    }
    if (isNaN(value)) {
      value = 0;
    }
    if (fieldValueOverrides && fieldValueOverrides[`data.${field}`]) {
      value = parseInt(fieldValueOverrides[`data.${field}`], 10);
      if (isNaN(value)) {
        value = 0;
      }
    }
    total += value;
  });
  // Minimum of 1
  if (total < 1) {
    total = 1;
  }
  if (times2) {
    total *= 2;
  }
  if (times5) {
    total *= 5;
  }
  total += plusN;
  // Ability-group-specific bonus from abilityGroupUsesBonus modifiers (e.g. a
  // feat that grants +N uses to a named ability group).
  if (abilityGroupName) {
    const bonusMods = getEffectsAndModifiersForToken(
      recordContext,
      ["abilityGroupUsesBonus"],
      abilityGroupName,
    );
    bonusMods.forEach((m) => {
      const v = parseInt(m.value, 10);
      if (!isNaN(v)) total += v;
    });
  }
  return total;
}

// Collects active `saveNote` modifiers for the given save (ability name like
// "dexterity") and returns them as an array of {name, tooltip} for use in
// metadata.tags. Matches modifier.field against the save ability ("dexterity"),
// the suffixed form ("dexteritySave"), "saves" (any save), or "all".
// Value format: "TagName|Description" (description optional, pipe-separated).
function collectSaveNotes(target, save) {
  const all = getEffectsAndModifiersForToken(target, ["saveNote"], "");
  const saveLower = (save || "").toLowerCase();
  const saveSuffix = saveLower ? `${saveLower}save` : "";
  const result = [];
  all.forEach((n) => {
    if (n.active === false) return;
    const f = (n.field || "").toLowerCase().trim();
    const matches =
      !f || f === "all" || f === "saves" || f === saveLower || f === saveSuffix;
    if (!matches) return;
    const raw = String(n.value || "");
    const sepIdx = raw.indexOf("|");
    const tag = (sepIdx >= 0 ? raw.slice(0, sepIdx) : raw).trim();
    const tooltip = sepIdx >= 0 ? raw.slice(sepIdx + 1).trim() : "";
    if (!tag) return;
    result.push({ name: tag, tooltip });
  });
  return result;
}

function getEffectAppliedBy(record, effect) {
  const effectValue = record?.effectValues?.[effect?._id];
  if (effectValue && effectValue?.tokenId !== "null") {
    return effectValue?.tokenId;
  }
  return null;
}

// Collects all effects and modifiers for the record (assuming this is
// called in the context of a record.)
// If types is provided, it will only return effects of those types
// If field is provided, it will only return effects that match that field
// If a target is provided, we look for effects for relevant to the caller and the target
// such as attackTargeting, attackTargetingFive, attackTargetingGreaterFive
// If appliedById is provided, it will only return effects that were applied by that tokenId
function getEffectsAndModifiers(
  types = [],
  field = "",
  itemId = undefined,
  appliedById = undefined,
  context = undefined,
) {
  // Delegate to the token-based resolver (operating on the current record) so
  // predicate gating, wildShapeBonus injection, and modifier handling live in
  // one place and apply consistently to character-sheet rolls. `context` carries
  // target/attacker info so target-aware predicates resolve.
  return getEffectsAndModifiersForToken(
    record,
    types,
    field,
    itemId,
    appliedById,
    context,
  );
}

// In this call we look for effects that are relevant to the caller and the target for damage rolls
function getDamageEffectsForTarget(ourToken, target) {
  if (!target) {
    return [];
  }

  let results = [];

  // Get effects that are relevant to the target
  // damageTargetBonus is for damage bonuses to attacks specific to the target
  // and the token that applied the effect
  const effectsToCheck = ["damageTargetBonus"];

  const damageEffects = getEffectsAndModifiersForToken(
    target, // Look for effects on this target
    effectsToCheck, // that match damageTargetBonus
    "", // field is irrelevant
    undefined, // itemId is irrelevant
    ourToken?._id, // appliedById is the caller
  );

  damageEffects.forEach((r) => {
    results.push({
      ...r,
      name: r.isEffect ? `Target Has the ${r.name} Effect` : r.name,
    });
  });

  return results;
}

// In this call, we look for effects that are relevant to the caller and the target for attack rolls
function getAttackModifiersForTarget(target, distance) {
  if (!target) {
    return [];
  }

  let results = [];

  // Get effects that are relevant to the target
  const effectsToCheck = ["attackTargeting"];
  // If we're within 5 feet, add the attackTargetingFive effect
  if (distance !== undefined && distance !== null && distance <= 5) {
    effectsToCheck.push("attackTargetingFive");
  }
  // If we're greater than 5 feet, add the attackTargetingGreaterFive effect
  if (distance !== undefined && distance > 5) {
    effectsToCheck.push("attackTargetingGreaterFive");
  }
  const attackTargetingEffects = getEffectsAndModifiersForToken(
    target,
    effectsToCheck,
  );
  attackTargetingEffects.forEach((r) => {
    results.push({
      ...r,
      name: r.isEffect ? `Target Has the ${r.name} Effect` : r.name,
    });
  });

  return results;
}

// Effect rule types handled by the Realm client effect engine (prompts and
// structural rules), NOT by the ruleset's modifier system. Their `value` is an
// object, so the modifier collector must skip them.
const REALM_EFFECT_RULE_TYPES = new Set([
  "input",
  "choiceSet",
  "override",
  "data",
  "aura",
  "light",
]);

// Same as getEffectsAndModifiers but for a token that is passed
function getEffectsAndModifiersForToken(
  target,
  types = [],
  field = "",
  itemId = undefined,
  appliedById = undefined,
  context = undefined,
) {
  if (!target) {
    return [];
  }
  let results = [];

  // Set of stack modifiers that we have seen so we don't duplicate them
  const stackModifiers = {};

  // Derive weapon-aware predicate context when an itemId is provided. Lets
  // weapon:<property> / weapon:ranged / weapon:melee predicates fire based on
  // the actual attacking weapon and its rangeToggleBtn for thrown weapons.
  let effectiveContext = context;
  if (itemId) {
    const _inv = (
      Array.isArray(target?.data?.inventory) ? target.data.inventory : []
    ).filter(Boolean);
    const _weapon = _inv.find((i) => i._id === itemId);
    if (_weapon) {
      const isRangedWeaponType = (_weapon?.data?.type || "").includes("ranged");
      const isThrown = (_weapon?.data?.weaponProperties || []).includes(
        "Thrown",
      );
      let isRangedAttack;
      if (isRangedWeaponType) isRangedAttack = true;
      else if (isThrown)
        isRangedAttack = _weapon?.data?.rangeToggleBtn === "ranged";
      else isRangedAttack = false;
      effectiveContext = {
        ...(context || {}),
        weapon: _weapon,
        isRangedAttack,
      };
    }
  }
  // Always thread the rollField into context so self:proficient (and similar
  // field-aware predicates) can resolve against the current roll's skill/ability.
  if (field) {
    effectiveContext = { ...(effectiveContext || {}), rollField: field };
  }

  // First collect modifiers from effects
  const effects = target?.effects || [];
  effects.forEach((effect) => {
    const rules = effect.rules || [];
    rules.forEach((rule) => {
      // Skip Realm-handled effect rule types (prompts / structural rules). These
      // are processed by the client effect engine, not by the modifier system,
      // and their `value` is an object (e.g. an input's {prompt, placeholder})
      // — trying to treat it as a modifier value crashes ("d.trim is not a
      // function").
      if (REALM_EFFECT_RULE_TYPES.has(rule?.type)) return;
      // Check for extra data on the rule (e.g. active: false)
      let ruleActive = rule.data && rule.data.active === false ? false : true;

      // Evaluate predicates — if any fail, deactivate this rule.
      const predicates = rule.data?.predicate;
      // A predicate is "present" if it's a non-empty string/array OR an object
      // with keys (e.g. {"not": "target:applied_by"}). Objects have no `.length`,
      // so the old `predicates.length > 0` check silently skipped them — leaving
      // the rule ALWAYS active instead of gated. Accept all three shapes.
      const hasPredicate =
        !!predicates &&
        (Array.isArray(predicates) || typeof predicates === "string"
          ? predicates.length > 0
          : typeof predicates === "object"
            ? Object.keys(predicates).length > 0
            : false);
      if (hasPredicate) {
        if (!effectiveContext && _predicatesRequireContext(predicates)) {
          ruleActive = false;
        } else {
          const predicateResult = evaluatePredicates(
            predicates,
            effectiveContext,
            effect,
            target,
          );
          if (!predicateResult) {
            ruleActive = false;
          }
        }
      }

      const ruleType = rule?.type || "";
      const isPenalty = ruleType.toLowerCase().includes("penalty");
      let value = rule.value || "";
      if (rule.valueType === "number") {
        value = parseInt(rule.value, 10);
        if (isNaN(value)) {
          value = 0;
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
      } else if (
        rule.valueType === "string" &&
        !value.trim().startsWith("-") &&
        isPenalty &&
        !value.includes("disadvantage")
      ) {
        value = "-" + value;
      }
      // Check for strings that require replacements
      if (rule.valueType === "string") {
        value = checkForReplacements(value, {}, target);
      }
      if (
        value !== 0 &&
        (rule.valueType === "number" || rule.valueType === "string")
      ) {
        let name = effect.name || "Effect";
        // If this is a stackable effect, add the effect per stack amount with a different name each time
        let times = 1;
        if (effect.stackable) {
          times = target?.effectIds?.filter((id) => id === effect?._id).length;
        }
        for (let i = 0; i < times; i++) {
          results.push({
            name: i > 0 ? `${name} (x${i + 1})` : name,
            value: value,
            active: ruleActive,
            modifierType: ruleType,
            field: rule?.field || "",
            valueType: rule.valueType,
            isPenalty: isPenalty,
            isEffect: true,
            appliedBy: getEffectAppliedBy(target, effect),
          });
        }
      } else if (rule.valueType === "api") {
        let value = parseInt(target?.effectValues?.[effect?._id] || "0", 10);
        if (isPenalty && value > 0) {
          value = -value;
        }
        if (value !== 0) {
          results.push({
            name: effect.name || "Effect",
            value: value,
            active: ruleActive,
            modifierType: ruleType,
            field: rule?.field || "",
            valueType: rule.valueType,
            isPenalty: isPenalty,
            isEffect: true,
            appliedBy: null,
          });
        }
      } else if (
        rule.valueType === "stack" &&
        !stackModifiers[`${effect?._id}-${JSON.stringify(rule)}`]
      ) {
        stackModifiers[`${effect?._id}-${JSON.stringify(rule)}`] = true;
        // The value is the number of times they have this effect
        let value = target?.effectIds?.filter(
          (id) => id === effect?._id,
        ).length;
        if (isPenalty && value > 0) {
          value = -value;
        }
        // Check if there is addtional math to apply to it
        const math = rule?.value || "";
        if (math) {
          value = applyMath(value, math);
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
        if (value !== 0) {
          results.push({
            name: effect.name || "Effect",
            value: value,
            active: ruleActive,
            modifierType: ruleType,
            field: rule?.field || "",
            valueType: rule.valueType,
            isPenalty: isPenalty,
            isEffect: true,
            appliedBy: getEffectAppliedBy(target, effect),
          });
        }
      }
    });
  });

  // Now collect all modifiers from Features and Items
  const features = target?.data?.features || [];
  // Ensure items is an array before filtering
  const items = Array.isArray(target?.data?.inventory)
    ? target?.data?.inventory
    : [];

  // Filter items that are not equipped or that require attunement and not attuned
  const equippedItems = items.filter(
    (item) =>
      item.data?.carried === "equipped" &&
      (!item.data?.attunement || item.data?.attuned === "true"),
  );

  // If checking modifiers for a specific weapon, also include its selected
  // ammo's modifiers (the weapon's ammoSelect points at an Ammunition item).
  // The ammo item is given the weapon's itemId so its modifiers apply here.
  let ammoEffects = [];
  if (itemId) {
    const weapon = equippedItems.find((item) => item._id === itemId);
    if (weapon) {
      const ammoSelectId = weapon.data?.ammoSelect;
      if (ammoSelectId) {
        const ammoItem = items.find((item) => item._id === ammoSelectId);
        if (ammoItem) {
          ammoEffects.push({ ...ammoItem, _id: itemId });
        }
      }
    }
  }

  // Collect active toggles for predicate checking. We store BOTH the raw
  // field and the slugified form so a predicate authored as
  // "social-against-creature" still matches a toggle whose field is
  // "Social Against Creature" (or vice versa). Same forgiving behavior used
  // for effect:/feature: predicates.
  const activeToggles = new Set();
  (target?.data?.toggles || []).forEach((t) => {
    if (!t?.data?.active) return;
    const f = t?.data?.field;
    if (!f) return;
    activeToggles.add(f);
    const slug = _slugifyName(f);
    if (slug) activeToggles.add(slug);
  });
  // Collect slugified names of effects on the record for effect:<slug> predicates
  const effectSlugs = new Set(
    (target?.effects || []).map((e) => _slugifyName(e?.name)).filter(Boolean),
  );
  // Collect slugified names of features/feats on the record for feature:<slug> predicates
  const featureSlugs = new Set(
    features.map((f) => _slugifyName(f?.name)).filter(Boolean),
  );

  [...features, ...equippedItems, ...ammoEffects].forEach((feature) => {
    const modifiers = feature.data?.modifiers || [];
    modifiers.forEach((modifier) => {
      // Skip modifiers with a predicate if it doesn't pass
      const predicate = (modifier.data?.predicate || "").trim();
      if (
        predicate &&
        !_evaluateTogglePredicate(
          predicate,
          activeToggles,
          effectSlugs,
          featureSlugs,
          effectiveContext,
          target,
        )
      )
        return;

      const ruleType = modifier.data?.type || "";
      const isPenalty = ruleType.toLowerCase().includes("penalty");
      let value = modifier.data?.value || "";
      if (modifier.data?.valueType === "number") {
        value = parseInt(modifier.data?.value, 10);
        if (isNaN(value)) {
          value = 0;
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
      } else if (modifier.data?.valueType === "field") {
        const fieldToUse = modifier.data?.value || "";
        if (fieldToUse) {
          value = target?.data?.[fieldToUse] || "";
        }
      } else if (
        modifier.data?.valueType === "string" &&
        !value.trim().startsWith("-") &&
        isPenalty
      ) {
        value = "-" + value;
      }

      // Check for strings that require replacements
      if (modifier.data?.valueType === "string") {
        value = checkForReplacements(value, {}, target);
      }

      // Only relevant if it has a value
      if (value !== 0) {
        // Check if this only applies to equipped item and mark it with ID if so
        const itemOnly = modifier.data?.itemOnly || false;
        results.push({
          name: feature?.name || "Feature",
          value: value,
          active: modifier.data?.active === true,
          modifierType: ruleType,
          field: modifier.data?.field || "",
          valueType: modifier.data?.valueType,
          itemId: itemOnly ? feature?._id : undefined,
          isPenalty: isPenalty,
          isEffect: false,
        });
      }
    });
  });

  // Special case for armor, if this is a stealth check
  if (field === "stealth") {
    const bestEquippedArmor = target?.data?.armor || undefined;
    if (bestEquippedArmor?.stealthPenalty) {
      results.push({
        name: "Disadvantage due to Armor",
        value: "disadvantage",
        active: true,
        modifierType: "skillPenalty",
        isPenalty: true,
        field: "stealth",
        isEffect: false,
      });
    }
  }

  // Wild Shape attack bonuses: when in Wild Shape, collect wildShapeBonus
  // modifiers with field "attack" and inject them as attackBonus modifiers
  // (they aren't collected above since the types filter is attackBonus/Penalty).
  if (
    target?.data?.shapeshiftingType === "wildshape" &&
    (types.includes("attackBonus") || types.includes("attackPenalty"))
  ) {
    [...features, ...equippedItems].forEach((feature) => {
      const modifiers = feature.data?.modifiers || [];
      modifiers.forEach((modifier) => {
        if (
          modifier.data?.type === "wildShapeBonus" &&
          modifier.data?.field === "attack"
        ) {
          let value = modifier.data?.value || 0;
          if (modifier.data?.valueType === "number") {
            value = parseInt(value, 10) || 0;
          } else if (typeof value === "string") {
            // Resolve {expression}/ternary and class-level tokens.
            value = checkForReplacements(value, {}, target);
          }
          if (value !== 0 && value !== "") {
            results.push({
              name: feature?.name || "Wild Shape Bonus",
              value: value,
              active: modifier.data?.active === true,
              modifierType: "attackBonus",
              field: field,
              valueType: modifier.data?.valueType,
              isPenalty: false,
              isEffect: false,
            });
          }
        }
      });
    });
  }

  // Wild Shape damage bonuses: when in Wild Shape, collect wildShapeBonus
  // modifiers with field "damage" and inject them as damageBonus modifiers.
  if (
    target?.data?.shapeshiftingType === "wildshape" &&
    (types.includes("damageBonus") || types.includes("damagePenalty"))
  ) {
    [...features, ...equippedItems].forEach((feature) => {
      const modifiers = feature.data?.modifiers || [];
      modifiers.forEach((modifier) => {
        if (
          modifier.data?.type === "wildShapeBonus" &&
          modifier.data?.field === "damage"
        ) {
          let value = modifier.data?.value || "";
          if (value) {
            // Resolve {expression}/ternary and class-level tokens (e.g. Primal
            // Strike's "{Druid Level >= 15 ? 2d8 thunder : 1d8 thunder}"), the
            // same way the normal string-modifier path does.
            if (typeof value === "string") {
              value = checkForReplacements(value, {}, target);
            }
            results.push({
              name: feature?.name || "Wild Shape Bonus",
              value: value,
              active: modifier.data?.active === true,
              modifierType: "damageBonus",
              field: field,
              valueType: modifier.data?.valueType,
              isPenalty: false,
              isEffect: false,
            });
          }
        }
      });
    });
  }

  if (types && types.length > 0) {
    results = results.filter((r) => types.includes(r.modifierType));
  }

  if (field && field !== "") {
    results = results.filter(
      (r) => r.field === field || r.field === "all" || !r.field,
    );
  }

  // Filter by itemId if provided
  results = results.filter(
    (r) => r.itemId === itemId || r.itemId === undefined,
  );

  // Filter by appliedById if provided
  if (appliedById) {
    results = results.filter((r) => r.appliedBy === appliedById);
  }

  return results;
}

function getConcentrationMacro(damage) {
  // DC is half the damage done rounded down or 10, whichever is higher, to a max of 30
  const saveDc = Math.min(Math.max(Math.floor(damage / 2), 10), 30);
  return `
\`\`\`Concentration_Check
const selectedTokens = api.getSelectedOrDroppedToken();
selectedTokens.forEach(token => {
	let saveModifiers = [];
	const modifier = token?.data?.['constitutionSave'] || 0;
	saveModifiers.push({
		name: 'Constitution Save',
		value: modifier,
		active: true,
	});

	const saveMods = getEffectsAndModifiersForToken(token, ['saveBonus', 'savePenalty'], 'constitution');
	saveMods.forEach(mod => {
		saveModifiers.push(mod);
	});

  const concentrationMods = getEffectsAndModifiersForToken(token, ['saveBonus', 'savePenalty'], 'concentration');
	concentrationMods.forEach(mod => {
    // Only if not already in the array
    if (!saveModifiers.some(m => m.name === mod.name && m.value === mod.value && m.active === mod.active)) {
      saveModifiers.push(mod);
    }
	});

	const minRoll = getMinRollModifier(saveModifiers);
  // Filter these out of the modifiers array, we don't need them to be toggleable
  saveModifiers = saveModifiers.filter(m => !m.value.toString().startsWith('minroll'));

	const metadata = {
		"rollName": 'Constitution Save',
		"tooltip": 'Constitution Saving Throw',
		"dc": ${saveDc},
		"minRoll": minRoll
	}

  api.promptRollForToken(token, 'Constitution Save', '1d20', saveModifiers, metadata, 'concentration'); 
});
\`\`\`
`;
}

function getMinRollModifier(modifiers) {
  // Look for highest `minroll(number)` modifier and use that as the minRoll
  const minRollMatch = /minroll(\d+)/;
  const minRollMods = modifiers
    .map((m) => {
      // Skip deactivated (e.g. predicate-failed) minroll modifiers so a gated
      // "minroll3" only applies when its predicate passed.
      if (m?.active === false) return null;
      const match = m.value.toString().match(minRollMatch);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((value) => value !== null);

  let minRoll = null;
  if (minRollMods.length) {
    minRoll = Math.max(...minRollMods);
  }
  return minRoll;
}

// An effect "writes" the AC field when it carries a client-baked override/data
// rule targeting ac (the client applies these to token.data.ac). Shapes:
//   { type: "data",     value: { field: "ac", operation: "add", value: 2 } }
//   { type: "override", value: { ac: 18, ... } }
function _effectWritesAcField(effect) {
  const isAcKey = (k) =>
    (k || "").toString().toLowerCase().replace(/^data\./, "").trim() === "ac";
  return (effect?.rules || []).some((rule) => {
    // An override whose predicate failed was never applied to data.ac.
    if (rule?.data && rule.data.active === false) return false;
    if (rule?.type === "data") return isAcKey(rule?.value?.field);
    if (rule?.type === "override") {
      const v = rule?.value;
      return !!v && typeof v === "object" && Object.keys(v).some(isAcKey);
    }
    return false;
  });
}

// Names of the effects that write the AC field directly. For an NPC — whose base
// AC IS the already-baked token.data.ac — a bonus/penalty modifier from one of
// these is already reflected in that base, so it must be skipped to avoid
// applying the same adjustment twice (e.g. an effect carrying BOTH
// armorClassBonus +2 AND a data rule adding 2 to ac). A PC computes its base
// fresh from armor/dex, so its modifiers are not redundant and are never skipped.
function _acOverrideEffectNames(token) {
  const names = new Set();
  (token?.effects || []).forEach((effect) => {
    if (_effectWritesAcField(effect)) names.add(effect?.name || "Effect");
  });
  return names;
}

// Used for getting the target's best AC (by calculation or what is set if that is higher)
function getArmorClassForToken(token) {
  const record = token?.record;
  const acCalculationMods = getEffectsAndModifiersForToken(token, [
    "armorClassCalculation",
  ]);

  // If token is shapeshifted, we use whatever our AC is currently set to
  if (token?.data?.wildShapeNpc || token?.data?.polymorphNpc) {
    return parseInt(token?.data?.ac || "0", 10);
  }

  // If this is a character, we use their dexterity modifier
  const dexMod = parseInt(token?.data?.dexterityMod || "0", 10);
  const bestEquippedArmor = token?.data?.armor || undefined;
  let armorClass = 10 + dexMod;
  // armorClassAbilitySwap: when armored, an ability other than DEX may supply the
  // AC ability bonus (e.g. a feature granting "use Constitution while armored").
  // An optional value restricts it to a specific armor category. Capped by the
  // armor's max-dex like the normal DEX bonus.
  let acAbilityMod = dexMod;
  getEffectsAndModifiersForToken(token, ["armorClassAbilitySwap"]).forEach((mod) => {
    const targetAbility = (mod.field || "").toLowerCase();
    if (!targetAbility) return;
    const categoryRestriction = (mod.value || "").toString().toLowerCase();
    const armorCategory = (
      bestEquippedArmor?.category ||
      bestEquippedArmor?.armorCategory ||
      ""
    ).toLowerCase();
    if (categoryRestriction && categoryRestriction !== armorCategory) return;
    const m = parseInt(token?.data?.[`${targetAbility}Mod`] || "0", 10);
    if (!isNaN(m)) acAbilityMod = m;
  });
  // Else, we use the armor class value (for tokens)
  if (record?.recordType === "npcs") {
    armorClass = parseInt(token?.data?.ac || "0", 10);
  } else if (bestEquippedArmor && bestEquippedArmor.ac > 0) {
    // PC's base class is the best equipped armor if provided
    // Add the dex bonus to the ac, using max dex as the max.
    // If maxDex is not set, we assume it is 0
    armorClass =
      bestEquippedArmor.ac +
      (bestEquippedArmor.maxDex
        ? Math.min(acAbilityMod, bestEquippedArmor.maxDex)
        : 0);
  }

  let calcBonus = 0;
  // Only add acCalculationMods if we are unarmored
  if (bestEquippedArmor?.ac === 0 || !bestEquippedArmor) {
    acCalculationMods.forEach((mod) => {
      // We only benefit from the highest AC calculation modifier
      if (mod.field && mod.field !== "dexterity") {
        const acBonus = parseInt(token?.data?.[`${mod.field}Mod`] || "0", 10);
        if (acBonus > calcBonus) {
          calcBonus = acBonus;
        }
      }
    });
  }
  // Get general AC bonuses
  const acBonuses = getEffectsAndModifiersForToken(token, [
    "armorClassBonus",
    "armorClassPenalty",
  ]);
  // For NPCs only: skip a bonus/penalty from an effect that also writes the AC
  // field, since the NPC's base is the already-baked data.ac and would otherwise
  // count that adjustment twice. PCs compute their base fresh, so their
  // modifiers are additive (not redundant) and must all apply.
  const isNpc = record?.recordType === "npcs";
  const acOverrideNames = isNpc ? _acOverrideEffectNames(token) : null;
  acBonuses.forEach((mod) => {
    if (isNpc && mod.name && acOverrideNames.has(mod.name)) return;
    if (mod.value) {
      const acBonus = parseInt(mod.value || "0", 10);
      if (!isNaN(acBonus)) {
        calcBonus += acBonus;
      }
    }
  });
  // Add shield if it is equipped
  if (bestEquippedArmor?.shieldAc) {
    armorClass += bestEquippedArmor.shieldAc;
  }
  armorClass += calcBonus;

  // Finally, return the max of this value against what they set in their AC field (in case they are apply bonuses there)
  const acField = parseInt(token?.data?.ac || "0", 10);

  return Math.max(armorClass, acField);
}

// Used when calculating new AC for equipment changes
function getArmorClass(bestEquippedArmor) {
  // If we are shapeshifted, we use whatever our AC is currently set to
  if (record?.data?.wildShapeNpc || record?.data?.polymorphNpc) {
    return parseInt(record?.data?.ac || "0", 10);
  }

  const acCalculationMods = getEffectsAndModifiers(["armorClassCalculation"]);

  // If this is a character, we use their dexterity modifier
  const dexMod = parseInt(record?.data?.dexterityMod || "0", 10);
  let armorClass = 10 + dexMod;
  // Else, we use the armor class value
  if (record?.recordType === "npcs") {
    armorClass = parseInt(record?.data?.ac || "0", 10);
  } else if (bestEquippedArmor && bestEquippedArmor.ac > 0) {
    // PC's base class is the best equipped armor if provided
    // Add the dex bonus to the ac, using max dex as the max.
    // If maxDex is not set, we assume it is 0
    armorClass =
      bestEquippedArmor.ac +
      (bestEquippedArmor.maxDex
        ? Math.min(dexMod, bestEquippedArmor.maxDex)
        : 0);
  }

  let calcBonus = 0;
  // Only add acCalculationMods if we are unarmored
  if (bestEquippedArmor?.ac === 0 || !bestEquippedArmor) {
    acCalculationMods.forEach((mod) => {
      // We only benefit from the highest AC calculation modifier
      if (mod.field && mod.field !== "dexterity") {
        const acBonus = parseInt(record?.data?.[`${mod.field}Mod`] || "0", 10);
        if (acBonus > calcBonus) {
          calcBonus = acBonus;
        }
      }
    });
  }
  // Get general AC bonuses
  const acBonuses = getEffectsAndModifiers([
    "armorClassBonus",
    "armorClassPenalty",
  ]);
  acBonuses.forEach((mod) => {
    if (mod.value) {
      const acBonus = parseInt(mod.value || "0", 10);
      if (!isNaN(acBonus)) {
        calcBonus += acBonus;
      }
    }
  });
  // Add shield if it is equipped
  if (bestEquippedArmor?.shieldAc) {
    armorClass += bestEquippedArmor.shieldAc;
  }
  // Add the bonuses
  armorClass += calcBonus;

  return armorClass;
}

// Gets the best equipped armor for the context of the current PC
function getBestEquippedArmor() {
  // Get the current ac due to armor
  let bestEquippedArmor = {
    ac: 0,
    maxDex: 0,
    shieldAc: 0,
    stealthPenalty: false,
  };

  const items = record.data?.inventory || [];
  items.forEach((item) => {
    if (item.data?.carried === "equipped" && item.data?.type === "armor") {
      const ac = item?.data?.armorClass || 0;
      const maxDex = item?.data?.addDex ? item?.data?.maxDex || 99 : 0;
      if (ac > bestEquippedArmor.ac) {
        bestEquippedArmor.ac = ac;
        bestEquippedArmor.maxDex = maxDex;
        bestEquippedArmor.stealthPenalty =
          item?.data?.stealth === "disadvantage";
      }
    } else if (
      item.data?.carried === "equipped" &&
      item.data?.type === "shield"
    ) {
      const ac = item?.data?.armorClass || 0;
      if (ac > bestEquippedArmor.shieldAc) {
        bestEquippedArmor.shieldAc = ac;
      }
    }
  });

  return bestEquippedArmor;
}

// Gets the Resistance, Immunity, and Vulnerability from a token
function getRIV(target) {
  const resistString = (target.data?.resistances || "").toLowerCase();
  const immuneString = (target.data?.immunities || "").toLowerCase();
  const vulnString = (target.data?.vulnerabilities || "").toLowerCase();

  // Use regular expressions to match specific patterns
  const resistances = [];
  const immunities = [];
  const vulnerabilities = [];
  // Damage types the target absorbs — it regains HP equal to the damage that
  // would have been dealt instead of taking it (e.g. Shambling Mound + lightning).
  const absorptions = [];

  const patterns = [
    {
      type: "resistance",
      regex:
        /bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered/i,
      values: ["bludgeoning", "piercing", "slashing"],
    },
    {
      type: "resistance",
      regex: /bludgeoning, piercing, and slashing from nonmagical attacks/i,
      values: [
        "bludgeoning",
        "piercing",
        "slashing",
        "silveredbludgeoning",
        "silveredpiercing",
        "silveredslashing",
      ],
    },
    {
      type: "resistance",
      regex: /bludgeoning, piercing, and slashing/i,
      values: [
        "bludgeoning",
        "piercing",
        "slashing",
        "silveredbludgeoning",
        "silveredpiercing",
        "silveredslashing",
      ],
    },
    {
      type: "immunity",
      regex:
        /bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered/i,
      values: ["bludgeoning", "piercing", "slashing"],
    },
    {
      type: "immunity",
      regex: /bludgeoning, piercing, and slashing from nonmagical attacks/i,
      values: [
        "bludgeoning",
        "piercing",
        "slashing",
        "silveredbludgeoning",
        "silveredpiercing",
        "silveredslashing",
      ],
    },
    {
      type: "immunity",
      regex: /bludgeoning, piercing, and slashing/i,
      values: [
        "bludgeoning",
        "piercing",
        "slashing",
        "silveredbludgeoning",
        "silveredpiercing",
        "silveredslashing",
      ],
    },
    {
      type: "vulnerability",
      regex:
        /bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered/i,
      values: ["bludgeoning", "piercing", "slashing"],
    },
    {
      type: "vulnerability",
      regex: /bludgeoning, piercing, and slashing from nonmagical attacks/i,
      values: [
        "bludgeoning",
        "piercing",
        "slashing",
        "silveredbludgeoning",
        "silveredpiercing",
        "silveredslashing",
      ],
    },
    {
      type: "vulnerability",
      regex: /bludgeoning, piercing, and slashing/i,
      values: [
        "bludgeoning",
        "piercing",
        "slashing",
        "silveredbludgeoning",
        "silveredpiercing",
        "silveredslashing",
      ],
    },
  ];

  // Function to extract and remove matched patterns
  function extractPatterns(string, type) {
    patterns.forEach((pattern) => {
      if (pattern.type === type && pattern.regex.test(string)) {
        if (type === "resistance") resistances.push(...pattern.values);
        if (type === "immunity") immunities.push(...pattern.values);
        if (type === "vulnerability") vulnerabilities.push(...pattern.values);
        string = string.replace(pattern.regex, ""); // Remove matched pattern
      }
    });
    return string;
  }

  // Extract complex patterns and remove them from the string
  let remainingResistString = extractPatterns(resistString, "resistance");
  let remainingImmuneString = extractPatterns(immuneString, "immunity");
  let remainingVulnString = extractPatterns(vulnString, "vulnerability");

  // Split remaining strings by commas to capture additional values
  resistances.push(
    ...remainingResistString
      .split(/[,;]/) // Split by both comma and semicolon
      .map((r) => r.toLowerCase().trim())
      .filter((r) => r),
  );
  immunities.push(
    ...remainingImmuneString
      .split(/[,;]/) // Split by both comma and semicolon
      .map((i) => i.toLowerCase().trim())
      .filter((i) => i),
  );
  vulnerabilities.push(
    ...remainingVulnString
      .split(/[,;]/) // Split by both comma and semicolon
      .map((v) => v.toLowerCase().trim())
      .filter((v) => v),
  );

  // Then add RIV from modifiers
  const modifiers = getEffectsAndModifiersForToken(target, [
    "resistance",
    "vulnerability",
    "immunity",
    "absorption",
  ]);
  modifiers.forEach((mod) => {
    if (
      mod.modifierType === "resistance" &&
      mod.valueType === "string" &&
      mod.value
    ) {
      resistances.push(mod.value.toLowerCase());
    } else if (
      mod.modifierType === "vulnerability" &&
      mod.valueType === "string" &&
      mod.value
    ) {
      vulnerabilities.push(mod.value.toLowerCase());
    } else if (
      mod.modifierType === "immunity" &&
      mod.valueType === "string" &&
      mod.value
    ) {
      immunities.push(mod.value.toLowerCase());
    } else if (
      mod.modifierType === "absorption" &&
      mod.valueType === "string" &&
      mod.value
    ) {
      absorptions.push(mod.value.toLowerCase());
    }
  });
  // Get additional one-off resistances per damage type
  const resistanceByDamage = {};
  modifiers.forEach((mod) => {
    if (
      mod.modifierType === "resistance" &&
      mod.active &&
      mod.field !== undefined &&
      mod.field !== null &&
      mod.field.trim() !== ""
    ) {
      const value =
        mod.valueType === "number"
          ? parseInt(mod.value || "0", 10)
          : evaluateMath(mod.value);
      resistanceByDamage[mod.field.toLowerCase()] = value;
    }
  });

  return {
    resistances,
    immunities,
    vulnerabilities,
    absorptions,
    resistanceByDamage,
  };
}

// If the target is currently dying (0 hp) we add a death save failure
// We add two if it it was from a critical hit
// If they are then at 3, we add the 'Dead' effect
function applyDeathFailures(target, isCritical) {
  if (target.data?.curhp <= 0) {
    let failures = parseInt(target.data.deathSaveFailures || "0", 10);
    if (isCritical) {
      failures += 2;
    } else {
      failures += 1;
    }

    // Update death save failures
    api.setValueOnToken(target, "data.deathSaveFailures", failures);

    // If they have three, we add the 'Dead' effect
    if (failures >= 3) {
      api.addEffect("Dead", target);
    }
  }
}

function applyInstantDeath(target) {
  // Update death save failures
  api.setValueOnToken(target, "data.deathSaveFailures", 3);
  api.addEffect("Dead", target);
}

// Builds a JS snippet (string) embedded into a spell's damage-button macro that
// RE-COLLECTS spell/cantrip damage bonuses when the button is clicked — so an
// effect applied AFTER the spell was cast is still picked up at damage time.
// Assumes a damage-modifiers array variable named by `opts.modifiersVar` is in
// scope (seeded with the build-time modifiers); new bonuses are merged by
// name+value (updating active), mirroring the build-time field/type handling.
function buildSpellDamageRuntimeMerge(opts) {
  const modifiersVar = opts.modifiersVar || "damageModifiers";
  const isCantrip = !!opts.isCantrip;
  const isAttack = !!opts.isAttack;
  const damageTypeJson = JSON.stringify(opts.primaryDamageType || "untyped");
  const ctxJson = JSON.stringify(opts.spellPredCtx || {});
  const levelJson = JSON.stringify(String(opts.levelCastAt ?? ""));
  const fieldJson = JSON.stringify(isAttack ? "attack" : "all");
  return `
  // Re-collect spell/cantrip damage bonuses at runtime (post-cast effects apply).
  {
    const _types = ${isCantrip} ? ["cantripDamageBonus","cantripDamagePenalty"] : ["spellDamageBonus","spellDamagePenalty"];
    const _ctx = ${ctxJson};
    let _mods = getEffectsAndModifiersForToken(api.getToken(), _types, ${fieldJson}, undefined, undefined, _ctx);
    if (${!isAttack}) _mods = _mods.filter((m) => (m?.field || "") !== "attack");
    _mods.forEach((modifier) => {
      let _v = modifier.value;
      if (typeof _v === "string") _v = _v.replace(/[Ss]pell [Ll]evel/g, ${levelJson});
      if (typeof _v === "string" && _v.toLowerCase().includes("ignore")) return;
      const _m = { ...modifier, value: _v, type: _v.toString().split(" ")?.[1] ? "" : ${damageTypeJson} };
      const _e = ${modifiersVar}.find((x) => x.name === _m.name && x.value === _m.value);
      if (_e) _e.active = _m.active;
      else ${modifiersVar}.push(_m);
    });
  }`;
}

// Get the alt damage buttons in the context of a Character of NPC for a given alt damage amount
function getAltSpellDamageButtons(
  spell,
  altDamageAmount,
  saveDamageMetadata,
  levelCastAt,
  npcSpellAction = null,
) {
  if (!altDamageAmount) return [];

  // Split the damage string by commas
  const damageStrings = altDamageAmount.split(",").map((d) => d.trim());
  const buttons = damageStrings.map((damageString) => {
    const altDamageType = getDamageType(damageString);

    // Get modifiers for the alt damages
    let altDamageModifiers = [];

    // Get the ability score modifier for the spell
    let ability = spell?.data?.ability || "strength";

    if (npcSpellAction) {
      ability = npcSpellAction?.data?.spellcastingAbility || "intelligence";
    }

    const abilityMod = api.getValue(`data.${ability}Mod`) || 0;

    if (spell?.data?.damage2 && spell?.data?.addAbility2) {
      altDamageModifiers.push({
        name: capitalize(ability),
        type: spell?.data?.damage2 ? altDamageType : "untyped",
        value: abilityMod,
        active: true,
      });
    }

    // Get additional damage modifiers
    let moreDamageModifiers =
      spell?.data?.level?.toLowerCase() === "cantrip"
        ? getEffectsAndModifiers(
            ["cantripDamageBonus", "cantripDamagePenalty"],
            spell?.data?.isAttack ? "attack" : "all",
          )
        : getEffectsAndModifiers(
            ["spellDamageBonus", "spellDamagePenalty"],
            spell?.data?.isAttack ? "attack" : "all",
          );
    // Filter attack modifiers if not attack spell
    if (!spell?.data?.isAttack) {
      moreDamageModifiers = moreDamageModifiers.filter(
        (mod) => (mod?.field || "") !== "attack",
      );
    }
    moreDamageModifiers.forEach((modifier) => {
      altDamageModifiers.push({
        ...modifier,
        // Only set type if modifer does not have it
        type: modifier.value.toString().split(" ")?.[1] ? "" : altDamageType,
      });
    });

    // Replace the spell level with the actual spell level if in a  modifier.
    // Gate on the actual value type (not valueType) — getEffectsAndModifiers may
    // have already resolved a string-typed modifier to a number (e.g. "Warlock
    // Spellcasting Modifier" → 3), in which case .replace would not exist.
    altDamageModifiers.forEach((modifier) => {
      if (typeof modifier?.value === "string") {
        modifier.value = modifier.value.replace(
          /[Ss]pell [Ll]evel/g,
          levelCastAt,
        );
      }
    });

    // Filter these out of the modifiers array, we don't need them to be toggleable
    altDamageModifiers = altDamageModifiers.filter(
      (m) => !m.value.toString().toLowerCase().includes("ignore"),
    );

    // Predicate context so the runtime re-collection can resolve spell:<name>,
    // spell:<school/list/tag> predicates on the re-collected damage bonuses.
    const spellPredCtx = {
      spellName: spell?.name || "",
      spellSchool: spell?.data?.school || "",
      spellLists: spell?.data?.spellLists || [],
      spellTags: spell?.data?.spellTags || [],
      spellOtherSchools: spell?.data?.otherSchools || [],
    };

    return `\`\`\`Roll_${
      altDamageType !== "untyped" ? capitalize(altDamageType) : "Spell"
    }_Damage
const altDamageModifiers = JSON.parse(JSON.stringify(${JSON.stringify(
      altDamageModifiers,
    )}));${buildSpellDamageRuntimeMerge({
      modifiersVar: "altDamageModifiers",
      isCantrip: spell?.data?.level?.toLowerCase() === "cantrip",
      isAttack: spell?.data?.isAttack === true,
      primaryDamageType: altDamageType,
      spellPredCtx,
      levelCastAt,
    })}
api.promptRoll(\`${
      altDamageType !== "untyped" ? capitalize(altDamageType) : "Spell"
    } Damage\`, '${damageString}', altDamageModifiers, ${JSON.stringify(
      saveDamageMetadata,
    )}, 'damage')
\`\`\``;
  });

  return buttons.join("\n");
}

function setHpPerLevel(recordOverride = null, moreValuesToSet = undefined) {
  record = recordOverride || record;
  // We check the JSON value in the hpByLevel field and
  // set individual number values for each level
  const hpByLevel =
    moreValuesToSet?.["data.hpByLevel"] || record?.data?.hpByLevel || "[]";
  const valuesToSet = {
    "fields.hpLevel1.hidden": false,
    "fields.hpLevel2.hidden": false,
    "fields.hpLevel3.hidden": false,
    "fields.hpLevel4.hidden": false,
    "fields.hpLevel5.hidden": false,
    "fields.hpLevel6.hidden": false,
    "fields.hpLevel7.hidden": false,
    "fields.hpLevel8.hidden": false,
    "fields.hpLevel9.hidden": false,
    "fields.hpLevel10.hidden": false,
    "fields.hpLevel11.hidden": false,
    "fields.hpLevel12.hidden": false,
    "fields.hpLevel13.hidden": false,
    "fields.hpLevel14.hidden": false,
    "fields.hpLevel15.hidden": false,
    "fields.hpLevel16.hidden": false,
    "fields.hpLevel17.hidden": false,
    "fields.hpLevel18.hidden": false,
    "fields.hpLevel19.hidden": false,
    "fields.hpLevel20.hidden": false,
  };
  let changesMade = false;
  try {
    const hpByLevelArr = JSON.parse(hpByLevel);

    // Create a map of level -> hp for easier lookup
    const hpByLevelMap = new Map();
    hpByLevelArr.forEach((hpLevel) => {
      hpByLevelMap.set(hpLevel.level, hpLevel.hp);
    });

    // Get the character's total level
    const characterLevel = parseInt(record?.data?.level || "0", 10);

    // Set HP for each level based on the map
    for (let level = 1; level <= characterLevel && level <= 20; level++) {
      const hpForLevel = hpByLevelMap.get(level);
      if (hpForLevel !== undefined) {
        if (
          (moreValuesToSet?.["data.hpLevel" + level] &&
            moreValuesToSet?.["data.hpLevel" + level] !== hpForLevel) ||
          record?.data?.[`hpLevel${level}`] !== hpForLevel
        ) {
          valuesToSet[`data.hpLevel${level}`] = hpForLevel;
          changesMade = true;
        }
      }
    }

    if (changesMade) {
      if (moreValuesToSet) {
        Object.keys(valuesToSet).forEach((key) => {
          moreValuesToSet[key] = valuesToSet[key];
        });
      } else {
        api.setValues(valuesToSet);
      }
    }
  } catch (error) {
    // No-op
  }
}

function showHideLevelUpButton(record) {
  const curLevel = record?.data?.level || 0;
  const curXp = record?.data?.xp || 0;
  const nextLevelXp = record?.data?.xpNext || 0;
  const shouldShow = curLevel <= 19 && curXp >= nextLevelXp;
  const hidden = !shouldShow;
  const currentHidden = record?.fields?.levelUpButton?.hidden;

  if (currentHidden !== hidden) {
    api.setValues({ "fields.levelUpButton.hidden": hidden });
  }
}

// Automatically determine an animation based on the attack or spell damage and ranged/melee
function getAnimationFor({
  abilityName,
  damage = "",
  healing = "",
  isRanged = false,
}) {
  if (!abilityName) return null;

  const animation = {
    animationName: isRanged ? "bolt_1" : "slash_1",
    sound: isRanged ? "bolt_1" : "slash_1",
    moveToDestination: isRanged,
    stretchToDestination:
      isRanged &&
      (abilityName.toLowerCase().match(/\bray\b/i) ||
        abilityName.toLowerCase().match(/\bspray\b/i) ||
        abilityName.toLowerCase().match(/\bbeam\b/i) ||
        abilityName.toLowerCase().match(/\bdisintegrate\b/i)),
    destinationOnly: false,
    startAtCenter: false,
  };

  if (!damage) {
    animation.animationName = "";
    animation.sound = "";
  }

  if (
    isRanged &&
    damage &&
    (abilityName.toLowerCase().match(/\borb\b/i) ||
      abilityName.toLowerCase().match(/\bmissile\b/i))
  ) {
    animation.animationName = "orb_1";
  }

  // If this is actually healing, we use a different animation
  if (healing) {
    animation.animationName = "healing_1";
    animation.scale = 0.75;
    animation.opacity = 1;
    animation.sound = "healing_1";
    animation.moveToDestination = false;
    animation.startAtCenter = true;
    animation.destinationOnly = true;
    return animation;
  }

  // Based on the damage, set the animation name and props
  if (damage.includes("fire")) {
    animation.animationName = "fire_1";
    animation.sound = "bolt_2";
    animation.hue = undefined;
    animation.contrast = undefined;
    animation.brightness = undefined;
    if (abilityName.toLowerCase().includes("fireball")) {
      animation.animationName = "fire_2";
    }
  } else if (damage.includes("cold")) {
    animation.animationName = "ice_1";
    animation.hue = 180;
    animation.contrast = 1.0;
    animation.brightness = 0.5;
  } else if (damage.includes("acid")) {
    animation.animationName = "splash_1";
    animation.sound = "water_1";
    animation.hue = 100;
    animation.contrast = 1.0;
    animation.brightness = 0.8;
  } else if (damage.includes("lightning")) {
    animation.animationName = "lightning_1";
    animation.sound = "lightning_1";
    animation.hue = 244;
    animation.opacity = 0.5;
    animation.contrast = 1.0;
    animation.brightness = 0.5;
  } else if (damage.includes("poison")) {
    animation.hue = 128;
    animation.contrast = 1.0;
    animation.brightness = 0.1;
  } else if (damage.includes("necrotic")) {
    animation.animationName = "necrotic_1";
    animation.hue = 240;
    animation.contrast = 0.1;
    animation.brightness = 0.1;
    animation.scale = 0.5;
    animation.opacity = 0.75;
  } else if (damage.includes("radiant")) {
    animation.animationName = "radiant_1";
    animation.hue = 50;
    animation.contrast = 1.0;
    animation.brightness = 0.8;
    animation.scale = 0.5;
    animation.opacity = 0.75;
  } else if (damage.includes("thunder")) {
    animation.animationName = "lightning_1";
    animation.sound = "lightning_1";
    animation.hue = 244;
    animation.contrast = 1.0;
    animation.brightness = 0.8;
  } else if (damage.includes("force")) {
    animation.hue = 284;
    animation.contrast = 1.0;
    animation.brightness = 0.2;
    if (abilityName.toLowerCase().includes("disintegrate")) {
      animation.hue = 128;
    }
  } else if (damage.includes("psychic")) {
    animation.hue = 330;
    animation.contrast = 1.0;
    animation.brightness = 0.2;
  } else if (damage.includes("piercing")) {
    animation.sound = isRanged ? "arrow_1" : "slash_1";
    // If this is a ranged bow use arrow_1 animationName
    if (
      (isRanged &&
        (abilityName.toLowerCase().match(/\bbow\b/i) ||
          abilityName.toLowerCase().match(/\bcrossbow\b/i))) ||
      abilityName.toLowerCase().match(/\longbow\b/i) ||
      abilityName.toLowerCase().match(/\bshortbow\b/i)
    ) {
      animation.animationName = "arrow_1";
    } else if (isRanged) {
      animation.animationName = "arrow_2";
    } else if (!isRanged) {
      animation.animationName = "pierce_1";
    }
  } else if (damage.includes("bludgeoning")) {
    animation.sound = isRanged ? "bolt_1" : "bludgeon_1";
    if (isRanged) {
      animation.animationName = "bullet_1";
    } else {
      animation.animationName = "bludgeon_1";
    }
  } else if (damage.includes("slashing")) {
    animation.sound = isRanged ? "bolt_1" : "slash_1";
  }

  // Alternatively, if the ability name includes something that indicates a metallic weapon, we use slash_2
  // or a whip, use whip_1, or guns use gun_1
  if (
    (abilityName.toLowerCase().includes("sword") ||
      abilityName.toLowerCase().includes("axe")) &&
    damage.includes("slashing")
  ) {
    animation.animationName = "slash_1";
    animation.sound = "slash_2";
  } else if (/^(claws?|rend)$/i.test(abilityName.trim())) {
    animation.animationName = "claws_1";
    animation.scale = 0.5;
    animation.opacity = 0.66;
    animation.sound = "slash_1";
  } else if (abilityName.toLowerCase().includes("whip")) {
    animation.animationName = "slash_1";
    animation.sound = "whip_1";
  } else if (abilityName.toLowerCase().includes("pistol")) {
    animation.animationName = "bullet_2";
    animation.sound = "gun_1";
  } else if (abilityName.toLowerCase().includes("rifle")) {
    animation.animationName = "bullet_2";
    animation.sound = "gun_1";
  } else if (abilityName.toLowerCase().includes("arquebus")) {
    animation.animationName = "bullet_2";
    animation.sound = "gun_1";
  } else if (abilityName.toLowerCase().includes("musket")) {
    animation.animationName = "bullet_2";
    animation.sound = "gun_1";
  } else if (abilityName.toLowerCase().includes("shotgun")) {
    animation.animationName = "bullet_2";
    animation.sound = "gun_1";
  } else if (abilityName.toLowerCase().includes("revolver")) {
    animation.animationName = "bullet_2";
    animation.sound = "gun_1";
  } else if (abilityName.toLowerCase().includes("grenade")) {
    animation.animationName = "explosion_1";
    animation.sound = "explosive_1";
    animation.moveToDestination = false;
    animation.stretchToDestination = false;
    animation.destinationOnly = true;
  } else if (abilityName.toLowerCase().includes("gunpowder")) {
    animation.animationName = "explosion_1";
    animation.sound = "explosive_1";
    animation.moveToDestination = false;
    animation.stretchToDestination = false;
    animation.destinationOnly = true;
  } else if (abilityName.toLowerCase().includes("dynamite")) {
    animation.animationName = "explosion_1";
    animation.sound = "explosive_1";
    animation.moveToDestination = false;
    animation.stretchToDestination = false;
    animation.destinationOnly = true;
  } else if (abilityName.toLowerCase().includes("bomb")) {
    animation.animationName = "explosion_1";
    animation.sound = "explosive_1";
    animation.moveToDestination = false;
    animation.stretchToDestination = false;
    animation.destinationOnly = true;
  }

  if (!damage && !healing) {
    if (abilityName.match(/\bshield\b/i)) {
      animation.animationName = "shield_1";
      animation.sound = "healing_1";
    }
  }

  // Ray spells (Ray of Frost, Ray of Enfeeblement, Scorching Ray, etc.) and
  // Disintegrate always fire a stretched bolt_2 beam. Runs after the damage
  // block so it wins on the animation itself while keeping any damage-type
  // tint (hue/contrast/brightness).
  if (
    isRanged &&
    (abilityName.toLowerCase().match(/\bray\b/i) ||
      abilityName.toLowerCase().match(/\bdisintegrate\b/i))
  ) {
    animation.animationName = "bolt_2";
    animation.sound = "bolt_2";
    animation.moveToDestination = true;
    animation.stretchToDestination = true;
    if (damage.includes("fire")) {
      // Fire ray (e.g. Scorching Ray): the fire block above cleared the tint,
      // so give bolt_2 an orange-red fire hue.
      animation.hue = 16;
      animation.contrast = 1.0;
      animation.brightness = 0.6;
    } else if (abilityName.toLowerCase().includes("enfeeblement")) {
      // Ray of Enfeeblement deals no damage, so nothing above tints it — give
      // it a deep green cast.
      animation.hue = 128;
      animation.contrast = 1.0;
      animation.brightness = 0.3;
    }
  }

  if (!animation.animationName) {
    // If not a spell or ability, we can't determine an animation
    return null;
  }

  return animation;
}

function getEffectMacrosFor(effects = []) {
  let effectButtons = "";
  const ourToken = api.getToken();
  const ourTokenId = ourToken?._id || "";
  let ourTokenName = ourToken?.name || ourToken?.record?.name || "";
  if (ourToken?.identified === false) {
    ourTokenName =
      ourToken?.unidentifiedName || ourToken?.record?.unidentifiedName;
  }
  ourTokenName = ourTokenName.replace(/'/g, "\\'"); // First escape single quotes
  effects.forEach((effectJson) => {
    const effect = JSON.parse(effectJson);
    const effectName = effect?.name || "";
    const effectID = effect?._id || "";
    const effectTitle = `Apply_${effectName.replace(/ /g, "_")}`;
    if (effectButtons !== "") {
      effectButtons += "\n";
    }
    effectButtons += `\`\`\`${effectTitle}
let targets = api.getSelectedOrDroppedToken();
targets.forEach(target => {
const ourToken = '${ourTokenId}' ? {_id: '${ourTokenId}', name: '${ourTokenName}'} : undefined;
api.addEffectById('${effectID}', target, undefined, ourToken);
});
\`\`\``;
  });
  return effectButtons;
}

function sendFeatureToChat() {
  const featureDataPath = getNearestParentDataPath(dataPath);
  const feature = api.getValue(featureDataPath);
  const featureName = feature?.name || "Unknown Feature";
  const featureDescription = api.richTextToMarkdown(
    feature?.data?.description || "",
  );
  const portrait = feature?.portrait
    ? `![${featureName}](${assetUrl}${encodeURI(
        feature?.portrait,
      )}?width=40&height=40) `
    : "";

  const effects = feature?.data?.effects || [];
  const effectButtons = getEffectMacrosFor(effects);

  const message = `
#### ${portrait}${featureName}

---
${featureDescription}
${effectButtons}
`;

  api.sendMessage(message, undefined, [], []);
}

function rollSavingThrow(save, dc, options) {
  // options.sourceName — the spell/ability that forced the save, so effects
  // gated by the "source:<slug>" predicate resolve.
  const sourceName = options?.sourceName;
  const saveContext = sourceName ? { sourceName } : undefined;
  const selectedTokens = api.getSelectedOrDroppedToken();
  selectedTokens.forEach((token) => {
    save = save.toLowerCase();
    let modifiers = [];

    const isNpc =
      token?.linked === false || token?.recordType === "npcs";

    if (isNpc) {
      // NPCs store a flat save total in data.{save}Save — use it directly.
      const saveMod = token?.data?.[`${save}Save`] || "0";
      if (saveMod.toString() !== "0") {
        modifiers.push({
          name: `${capitalize(save)} Save Modifier`,
          value: saveMod,
          active: true,
        });
      }
    } else {
      // PCs: build the save from its parts each roll (instead of the
      // precomputed data.{save}Save total) so an override effect that changes
      // the ability score / modifier is picked up automatically. Like skills:
      // one modifier for the ability, one for proficiency, plus all the other
      // modifiers collected below.
      const abilityMod = parseInt(token?.data?.[`${save}Mod`] || "0", 10) || 0;
      modifiers.push({
        name: capitalize(save),
        value: abilityMod,
        active: true,
      });

      const proficiencyBonus = parseInt(
        token?.data?.proficiencyBonus || "0",
        10,
      );
      if (token?.data?.[`${save}Prof`] === "true") {
        modifiers.push({
          name: "Proficient",
          value: isNaN(proficiencyBonus) ? 0 : proficiencyBonus,
          active: true,
        });
      }
    }

    // Check effects for all save bonuses and penalties for saves
    const saveModifiers = getEffectsAndModifiersForToken(
      token,
      ["saveBonus", "savePenalty"],
      save,
      undefined,
      undefined,
      saveContext,
    );
    saveModifiers.forEach((modifier) => {
      modifiers.push(modifier);
    });

    const minRoll = getMinRollModifier(modifiers);
    // Filter these out of the modifiers array, we don't need them to be toggleable
    modifiers = modifiers.filter(
      (m) => !m.value.toString().startsWith("minroll"),
    );

    const metadata = {
      rollName: `${capitalize(save)} Save`,
      tooltip: `${capitalize(save)} Saving Throw`,
      dc: dc,
      minRoll: minRoll,
    };
    // saveNote modifiers → reminder tags above the save result.
    const saveNotes = collectSaveNotes(token, save);
    if (saveNotes.length) metadata.tags = saveNotes;

    api.promptRollForToken(
      token,
      `${capitalize(save)} Save`,
      "1d20",
      modifiers,
      metadata,
      "save",
    );
  });
}

// Normalizes skill input to camelCase field name
// Handles: "sleight of hand", "Sleight of Hand", "sleightOfHand", etc.
function normalizeSkillName(skill) {
  if (!skill) return skill;

  // First, normalize the input by converting to lowercase and removing extra spaces
  const normalized = skill.trim().toLowerCase().replace(/\s+/g, " ");

  // Try to find a matching skill by comparing against both name and field
  const skills = getSkills();
  const matchedSkill = skills.find((s) => {
    // Match against the display name (lowercase)
    if (s.name.toLowerCase() === normalized) {
      return true;
    }
    // Match against the field name (already camelCase)
    if (s.field.toLowerCase() === normalized.replace(/\s+/g, "")) {
      return true;
    }
    // Match camelCase input against field
    if (skill.replace(/\s+/g, "").toLowerCase() === s.field.toLowerCase()) {
      return true;
    }
    return false;
  });

  // Return the field name if found, otherwise return the original input
  return matchedSkill ? matchedSkill.field : skill;
}

function rollAbilityCheck(ability, dc) {
  ability = ability.toLowerCase();
  const abilityNames = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
  ];
  if (!abilityNames.includes(ability)) {
    api.showNotification(
      `Unknown ability: ${ability}`,
      "yellow",
      "Ability Check",
    );
    return;
  }

  const selectedTokens = api.getSelectedOrDroppedToken();
  selectedTokens.forEach((token) => {
    const mod = parseInt(token?.data?.[`${ability}Mod`] || "0", 10) || 0;
    const modifiers = [{ name: capitalize(ability), value: mod, active: true }];

    // Ability bonuses/penalties
    const abilityMods = getEffectsAndModifiersForToken(
      token,
      ["abilityBonus", "abilityPenalty"],
      ability,
    );
    abilityMods.forEach((m) => modifiers.push(m));

    // All bonuses/penalties
    const allMods = getEffectsAndModifiersForToken(
      token,
      ["allBonus", "allPenalty"],
      ability,
    );
    allMods.forEach((m) => modifiers.push(m));

    const metadata = {
      rollName: `${capitalize(ability)}`,
      tooltip: `${capitalize(ability)} Check`,
      dc: dc,
    };

    api.promptRollForToken(
      token,
      `${capitalize(ability)} Check`,
      "1d20",
      modifiers,
      metadata,
      "ability",
    );
  });
}

function rollOtherSkillCheckForToken(token, otherSkill, dc) {
  const skillName = (otherSkill?.name || "New Skill").toString();
  const ability = otherSkill?.data?.ability || "strength";
  const proficiency = otherSkill?.data?.skillProf || "false";
  const isHalfProficient = proficiency === "half";
  const isExpertise = proficiency === "expertise";
  const isProficient = proficiency === "true";

  let abilityMod = parseInt(token?.data?.[`${ability}Mod`] || "0", 10);
  if (isNaN(abilityMod)) abilityMod = 0;
  const proficiencyBonus = parseInt(
    token?.data?.proficiencyBonus || "0",
    10,
  );

  let modifiers = [{ name: ability, value: abilityMod, active: true }];

  if (isHalfProficient) {
    modifiers.push({
      name: "Half Proficiency",
      value: Math.floor(proficiencyBonus / 2),
      active: true,
    });
  } else if (isExpertise) {
    modifiers.push({
      name: "Expertise",
      value: proficiencyBonus * 2,
      active: true,
    });
  } else if (isProficient) {
    modifiers.push({
      name: "Proficient",
      value: proficiencyBonus,
      active: true,
    });
  }

  const checkModifiers = getEffectsAndModifiersForToken(
    token,
    ["abilityBonus", "abilityPenalty"],
    ability,
  );
  checkModifiers.forEach((m) => modifiers.push(m));

  const skillModifiers = getEffectsAndModifiersForToken(
    token,
    ["skillBonus", "skillPenalty"],
    skillName.toLowerCase(),
  );
  skillModifiers.forEach((m) => modifiers.push(m));

  if (isProficient) {
    const proficientModifiers = getEffectsAndModifiersForToken(
      token,
      ["skillBonus"],
      "proficient",
    );
    proficientModifiers.forEach((modifier) => {
      if (
        !modifiers.some(
          (m) =>
            m.name === modifier.name &&
            m.value === modifier.value &&
            m.active === modifier.active,
        )
      ) {
        modifiers.push(modifier);
      }
    });
  }

  const minRoll = getMinRollModifier(modifiers);
  modifiers = modifiers.filter(
    (m) => !m.value.toString().startsWith("minroll"),
  );

  const metadata = {
    rollName: `${capitalize(skillName)}`,
    tooltip: `${capitalize(ability)} (${capitalize(skillName)}) Check`,
    dc: dc,
    minRoll: minRoll,
  };
  api.promptRollForToken(
    token,
    `${capitalize(ability)} (${capitalize(skillName)}) Check`,
    "1d20",
    modifiers,
    metadata,
    "ability",
  );
}

function rollSkillCheck(skill, dc) {
  // Normalize the skill name to camelCase field format
  skill = normalizeSkillName(skill);

  // Get the display name for this skill (e.g., "Sleight of Hand" from "sleightOfHand")
  const skillInfo = getSkills().find((s) => s.field === skill);
  const skillDisplayName = skillInfo?.name || camelToNormal(skill);

  const selectedTokens = api.getSelectedOrDroppedToken();
  selectedTokens.forEach((token) => {
    if (token.linked === false) {
      // This is an NPC
      // Parse the skill name to get the skill name and modifier
      let modValue = "0";
      // Look for a skill in the list with this name (compare using display name)
      const npcSkills = token.data?.skills || [];
      const npcSkill = npcSkills.find((s) =>
        s.name.trim().toLowerCase().startsWith(skillDisplayName.toLowerCase()),
      );
      let skillNameWithoutMod = npcSkill?.name || skillDisplayName;
      let skillName = npcSkill?.name || "";
      if (skillName) {
        skillNameWithoutMod = skillName;
        modValue = "0";
        if (skillNameWithoutMod.includes("+")) {
          skillNameWithoutMod = skillNameWithoutMod.split("+")[0].trim();
          modValue = skillName.split("+")[1].trim();
        } else if (skillNameWithoutMod.includes("-")) {
          skillNameWithoutMod = skillNameWithoutMod.split("-")[0].trim();
          modValue = `-${skillName.split("-")[1].trim()}`;
        }
        modValue = parseInt(modValue, 10);
        if (isNaN(modValue)) {
          modValue = 0;
        }
      } else {
        skillName = skillDisplayName;
        // Look up the stat associated with the skill
        const stat = skillInfo?.ability;
        if (stat) {
          modValue = token?.data?.[`${stat}Mod`] || 0;
        }
      }

      modValue = parseInt(modValue, 10);
      if (isNaN(modValue)) {
        modValue = 0;
      }
      // Roll the check
      const modifiers = [
        {
          name: `${skillNameWithoutMod} Modifier`,
          value: modValue,
          active: true,
        },
      ];

      // Get any bonus or penalties for abilities and skills
      // Try to guess the ability from the skill name
      const ability = getAbilityFromSkill(
        skillNameWithoutMod.split(" ")[0].toLowerCase(),
      );
      const checkModifiers = getEffectsAndModifiersForToken(
        token,
        ["abilityBonus", "abilityPenalty"],
        ability,
      );
      checkModifiers.forEach((modifier) => {
        modifiers.push(modifier);
      });

      const skillModifiers = getEffectsAndModifiersForToken(
        token,
        ["skillBonus", "skillPenalty"],
        skillNameWithoutMod.toLowerCase(),
      );
      skillModifiers.forEach((modifier) => {
        modifiers.push(modifier);
      });

      const metadata = {
        rollName: `${capitalize(skillNameWithoutMod)}`,
        tooltip: `${capitalize(skillNameWithoutMod)} Check`,
        dc: dc,
      };
      api.promptRollForToken(
        token,
        `${capitalize(skillNameWithoutMod)} Check`,
        "1d20",
        modifiers,
        metadata,
        "ability",
      );
    } else {
      // PC: if not a standard skill, check the character's otherSkills list
      if (!skillInfo) {
        const otherSkills = token?.data?.otherSkills || [];
        const lookupName = (skill || "").trim().toLowerCase();
        const otherSkill = otherSkills.find(
          (s) => (s?.name || "").trim().toLowerCase() === lookupName,
        );
        if (otherSkill) {
          rollOtherSkillCheckForToken(token, otherSkill, dc);
          return;
        }
      }
      // skill is already normalized to camelCase field format (e.g., "sleightOfHand")
      let ability =
        token?.data?.[`${skill}Ability`] ||
        skillInfo?.ability ||
        getAbilityFromSkill(skill);
      const mod = `${ability}Mod`;

      let modifiers = [];
      let abilityMod = parseInt(token?.data?.[mod] || "0", 10);
      if (abilityMod === undefined || isNaN(abilityMod)) {
        abilityMod = 0;
      }

      // Effect-driven skill-ability override (e.g. "use spellcasting ability for
      // Athletics, if higher").
      ({ ability, abilityMod } = resolveSkillCheckAbility(
        token,
        skill,
        ability,
        abilityMod,
      ));

      const proficiencyBonus = parseInt(
        token?.data?.proficiencyBonus || "0",
        10,
      );
      const proficiency = token?.data?.[`${skill}Prof`] || "false";
      const isHalfProficient = proficiency === "half";
      const isExpertise = proficiency === "expertise";
      const isProficient = proficiency === "true";

      modifiers.push({
        name: ability,
        value: abilityMod,
        active: true,
      });

      if (isHalfProficient) {
        modifiers.push({
          name: "Half Proficiency",
          value: Math.floor(proficiencyBonus / 2),
          active: true,
        });
      } else if (isExpertise) {
        modifiers.push({
          name: "Expertise",
          value: proficiencyBonus * 2,
          active: true,
        });
      } else if (isProficient) {
        modifiers.push({
          name: "Proficient",
          value: proficiencyBonus,
          active: true,
        });
      }

      // Get any bonus or penalties for abilities and skills
      const checkModifiers = getEffectsAndModifiersForToken(
        token,
        ["abilityBonus", "abilityPenalty"],
        ability,
      );
      checkModifiers.forEach((modifier) => {
        modifiers.push(modifier);
      });

      const skillModifiers = getEffectsAndModifiersForToken(
        token,
        ["skillBonus", "skillPenalty"],
        skill,
      );
      skillModifiers.forEach((modifier) => {
        modifiers.push(modifier);
      });

      // If we're proficient, get bonues that apply only to proficient checks
      if (isProficient) {
        const proficientModifiers = getEffectsAndModifiersForToken(
          token,
          ["skillBonus"],
          "proficient",
        );
        proficientModifiers.forEach((modifier) => {
          // Only add if not already in the array
          if (
            !modifiers.some(
              (m) =>
                m.name === modifier.name &&
                m.value === modifier.value &&
                m.active === modifier.active,
            )
          ) {
            modifiers.push(modifier);
          }
        });
      }

      const minRoll = getMinRollModifier(modifiers);
      // Filter these out of the modifiers array, we don't need them to be toggleable
      modifiers = modifiers.filter(
        (m) => !m.value.toString().startsWith("minroll"),
      );

      const metadata = {
        rollName: `${camelToNormal(skill).trim()}`,
        tooltip: `${camelToNormal(ability)} (${camelToNormal(
          skill,
        ).trim()}) Check`,
        dc: dc,
        minRoll: minRoll,
      };
      api.promptRollForToken(
        token,
        `${camelToNormal(ability)} (${camelToNormal(skill).trim()}) Check`,
        "1d20",
        modifiers,
        metadata,
        "ability",
      );
    }
  });
}


// ===== Ported from Level Up common.js (generic helpers needed by feature-utils) =====

function _isWeaponPropertyCondition(field) {
  const parts = field
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => _WEAPON_PROPERTY_SET.has(p));
}

// Check if a record/token has an equipped weapon with any of the given properties

function _hasEquippedWeaponWithProperty(rec, field) {
  const requiredProps = field
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const inventory = rec?.data?.inventory || [];
  return inventory.some((item) => {
    if (item?.data?.carried !== "equipped") return false;
    const props = item?.data?.weaponProperties || [];
    return requiredProps.some((rp) =>
      props.some((p) => p.toLowerCase() === rp.toLowerCase()),
    );
  });
}

// Get the carry and drag/lift/push weights for a creature

function evaluateFunctions(expr) {
  expr = expr.trim();

  const findClosingParen = (str, startIndex) => {
    let depth = 0;
    for (let i = startIndex; i < str.length; i++) {
      if (str[i] === "(") depth++;
      if (str[i] === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  };

  const splitArguments = (argsStr) => {
    const args = [];
    let current = "";
    let depth = 0;
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      if (char === "(") depth++;
      if (char === ")") depth--;
      if (char === "," && depth === 0) {
        args.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current.trim()) args.push(current.trim());
    return args;
  };

  const functionPattern =
    /^(ternary|lt|lte|gt|gte|eq|ne|and|or|not|nand|xor)\(/;
  const match = expr.match(functionPattern);

  if (match) {
    const funcName = match[1];
    const openParen = expr.indexOf("(");
    const closeParen = findClosingParen(expr, openParen);
    if (closeParen === -1) return expr;

    const argsStr = expr.substring(openParen + 1, closeParen);
    const args = splitArguments(argsStr);
    const evaluatedArgs = args.map((arg) => evaluateFunctions(arg));

    let result;
    switch (funcName) {
      case "ternary":
        result = evaluatedArgs[0] ? evaluatedArgs[1] : evaluatedArgs[2];
        break;
      case "lt":
        result = Number(evaluatedArgs[0]) < Number(evaluatedArgs[1]);
        break;
      case "lte":
        result = Number(evaluatedArgs[0]) <= Number(evaluatedArgs[1]);
        break;
      case "gt":
        result = Number(evaluatedArgs[0]) > Number(evaluatedArgs[1]);
        break;
      case "gte":
        result = Number(evaluatedArgs[0]) >= Number(evaluatedArgs[1]);
        break;
      case "eq":
        result = evaluatedArgs[0] == evaluatedArgs[1];
        break; // eslint-disable-line eqeqeq
      case "ne":
        result = evaluatedArgs[0] != evaluatedArgs[1];
        break; // eslint-disable-line eqeqeq
      case "and":
        result = evaluatedArgs[0] && evaluatedArgs[1];
        break;
      case "or":
        result = evaluatedArgs[0] || evaluatedArgs[1];
        break;
      case "not":
        result = !evaluatedArgs[0];
        break;
      case "nand":
        result = !(evaluatedArgs[0] && evaluatedArgs[1]);
        break;
      case "xor":
        result = !!(evaluatedArgs[0] ? !evaluatedArgs[1] : evaluatedArgs[1]);
        break;
      default:
        return expr;
    }

    const remainder = expr.substring(closeParen + 1).trim();
    if (remainder) return String(result) + remainder;
    return result;
  }

  // Single-quoted string literal — unwrap
  if (expr.startsWith("'") && expr.endsWith("'") && expr.length >= 2) {
    return expr.slice(1, -1).replace(/\\'/g, "'");
  }

  // Number
  const num = Number(expr);
  if (!isNaN(num) && expr !== "") return num;

  // Bare string — return as-is
  return expr;
}

// Evaluate a ternary expression string, supporting chained ternaries.
// Format: "condition ? trueValue : falseValue"
// Conditions support: >=, <=, >, <, ==, !=
// Values can be anything (dice strings, numbers, text).
// Example: "5 >= 16 ? 1d10 : 5 >= 11 ? 1d8 : 5 >= 5 ? 1d6 : 1d4"

function _slugifyName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// HP-derived pseudo-conditions for effect predicates. "bloodied" and "wounded"
// are computed from a token's current/max HP rather than requiring an applied
// effect token, so predicates like "target:effect:bloodied" stay correct even
// if the Bloodied effect was never added or got dropped.
//   bloodied — alive and at or below half max HP (rounded down), matching the
//              5e 2024 Bloodied condition threshold.
//   wounded  — missing any hit points (below max).
function _tokenIsBloodied(tok) {
  const maxhp = tok?.data?.hitpoints || 0;
  const curhp = tok?.data?.curhp || 0;
  return maxhp > 0 && curhp > 0 && curhp <= Math.floor(maxhp / 2);
}
function _tokenIsWounded(tok) {
  const maxhp = tok?.data?.hitpoints || 0;
  const curhp = tok?.data?.curhp || 0;
  return maxhp > 0 && curhp < maxhp;
}
// True if <slug> is an HP-derived pseudo-condition satisfied by tok's HP state.
function _hpPseudoCondition(slug, tok) {
  if (slug === "bloodied") return _tokenIsBloodied(tok);
  if (slug === "wounded") return _tokenIsWounded(tok);
  return false;
}

// NPCs derive their spellcasting level from CR (stored as data.level by
// updateCR). But a Spellcasting action or trait may explicitly state a caster
// level in its description — e.g. "The archmage is an 18th-level spellcaster."
// or "casts spells as a 9th-level spellcaster." When present, that stated level
// overrides the CR-based level for cantrip damage scaling. Scans every NPC
// action/trait bucket for the first "<N>(st|nd|rd|th)-level spellcaster" phrase
// and returns that number; falls back to the CR-derived data.level.
function getNpcSpellcasterLevel(target) {
  const crLevel = parseInt(target?.data?.level || "1", 10) || 1;
  const re = /(\d+)\s*(?:st|nd|rd|th)?[-\s]*level[-\s]+spellcaster/i;
  const buckets = [
    "features",
    "actions",
    "bonusActions",
    "reactions",
    "legendaryActions",
    "lairActions",
  ];
  for (const bucket of buckets) {
    const list = target?.data?.[bucket];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const desc = entry?.data?.description || "";
      const m = desc.match(re);
      if (m) {
        const lvl = parseInt(m[1], 10);
        if (lvl > 0) return lvl;
      }
    }
  }
  return crLevel;
}

// Parse a creature-type string into a flat, lowercased list of types, treating
// parenthetical sub-types as their own entries. So "Fey (Hag)" -> ["fey","hag"]
// and "Humanoid (Elf, Human)" -> ["humanoid","elf","human"]. Comma-separated at
// the top level too ("Celestial, Fiend" -> ["celestial","fiend"]).
function _parseCreatureTypes(raw) {
  const lower = (raw || "").toLowerCase();
  const types = [];
  (lower.match(/\(([^)]*)\)/g) || []).forEach((group) => {
    group
      .replace(/[()]/g, "")
      .split(",")
      .forEach((t) => {
        const x = t.trim();
        if (x) types.push(x);
      });
  });
  lower
    .replace(/\([^)]*\)/g, " ")
    .split(",")
    .forEach((t) => {
      const x = t.trim();
      if (x) types.push(x);
    });
  return types;
}

// Evaluates predicates on a rule. Supports strings, arrays (AND), and objects (not/or/and/nand/nor).
// Evaluate a toggle predicate against a set of active toggle field names.
// Supports:
//   - Simple string: "focused-shot" — true if toggle is active
//   - "effect:<slug>" — true if the record has an effect whose slugified name matches
//     (e.g. "effect:hunters-target" matches an effect named "Hunter's Target")
//   - "feature:<slug>" — true if the record has a feature/feat in data.features whose
//     slugified name matches (e.g. "feature:trained-accuracy" matches "Trained Accuracy")
//   - JSON array (AND): ["focused-shot", "power-attack"] — all must be active
//   - JSON object with operators:
//     { "or": ["focused-shot", "effect:hunters-target"] } — any must be active
//     { "not": "feature:trained-accuracy" } — feature must NOT be present
//     { "and": ["focused-shot", "power-attack"] } — all must be active
//     { "nand": [...] }, { "nor": [...] }
// Predicate field value is a string — parsed as JSON if it starts with [ or {.

function _evaluateTogglePredicate(
  predicateStr,
  activeToggles,
  effectSlugs,
  featureSlugs,
  context,
  target,
) {
  if (!predicateStr) return true;
  let parsed;
  const trimmed = predicateStr.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      // Treat as simple string
      return _evalToggleNode(
        trimmed,
        activeToggles,
        effectSlugs,
        featureSlugs,
        context,
        target,
      );
    }
  } else {
    return _evalToggleNode(
      trimmed,
      activeToggles,
      effectSlugs,
      featureSlugs,
      context,
      target,
    );
  }
  return _evalToggleNode(
    parsed,
    activeToggles,
    effectSlugs,
    featureSlugs,
    context,
    target,
  );
}

// Walk a parsed predicate node and collect every bare toggle-field reference
// (i.e. strings that aren't the "effect:" or "feature:" prefixed forms). Used
// to label a modifier's chat-row by its toggle display name instead of the
// owning feature's name, so a roll prompt shows e.g. "Trained Accuracy 1"
// rather than "Archery" when the toggle gated the modifier.

function _collectPredicateToggleFields(node, out) {
  if (!node) return;
  if (typeof node === "string") {
    if (node.startsWith("effect:") || node.startsWith("feature:")) return;
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => _collectPredicateToggleFields(item, out));
    return;
  }
  if (typeof node === "object") {
    for (const key of ["not", "or", "and", "nand", "nor"]) {
      if (key in node) _collectPredicateToggleFields(node[key], out);
    }
  }
}

// Resolve the best toggle-display-name for a predicate string. Prefers active
// toggles so OR-predicates report the one that actually fired. Returns "" if
// the predicate doesn't reference any known toggle field.

function _getPredicateToggleName(predicateStr, toggles, activeToggles) {
  if (!predicateStr) return "";
  const fields = [];
  const trimmed = predicateStr.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      _collectPredicateToggleFields(JSON.parse(trimmed), fields);
    } catch (e) {
      fields.push(trimmed);
    }
  } else if (
    !trimmed.startsWith("effect:") &&
    !trimmed.startsWith("feature:")
  ) {
    fields.push(trimmed);
  }
  if (fields.length === 0) return "";
  const byField = new Map();
  (toggles || []).forEach((t) => {
    const f = t?.data?.field;
    if (f && !byField.has(f)) byField.set(f, t?.name || f);
  });
  // Prefer an active toggle so OR-predicates label with the one that fired
  const active = fields.find((f) => activeToggles.has(f) && byField.has(f));
  if (active) return byField.get(active);
  const any = fields.find((f) => byField.has(f));
  return any ? byField.get(any) : "";
}

function _evalToggleNode(
  node,
  activeToggles,
  effectSlugs,
  featureSlugs,
  context,
  target,
) {
  if (typeof node === "string") {
    if (node.startsWith("effect:")) {
      const slug = node.slice("effect:".length).trim().toLowerCase();
      return !!effectSlugs && effectSlugs.has(slug);
    }
    if (node.startsWith("feature:")) {
      const slug = node.slice("feature:".length).trim().toLowerCase();
      return !!featureSlugs && featureSlugs.has(slug);
    }
    // Context-based predicates — delegate to the full evaluator so feature/item
    // modifiers can use spell:/target:/attacker:/self:/sense:/weapon:/source:
    // predicates too. source:<slug> gates a modifier to a save forced by a
    // specific named ability/spell (context.sourceName), e.g. an undead's
    // "advantage on saves to resist Turn Undead" trait.
    if (
      node.startsWith("spell:") ||
      node.startsWith("target:") ||
      node.startsWith("attacker:") ||
      node.startsWith("self:") ||
      node.startsWith("sense:") ||
      node.startsWith("weapon:") ||
      node.startsWith("source:")
    ) {
      // If the predicate needs context but none was provided, treat as inactive
      if (!context && _predicatesRequireContext(node)) return false;
      return evaluateSinglePredicate(node, context, null, target);
    }
    // Toggle match: try raw first, then slug-tolerant. activeToggles already
    // contains both the raw field and its slug for every active toggle.
    if (activeToggles.has(node)) return true;
    const nodeSlug = _slugifyName(node);
    return !!nodeSlug && activeToggles.has(nodeSlug);
  }
  if (Array.isArray(node)) {
    // Array = implicit AND
    return node.every((item) =>
      _evalToggleNode(
        item,
        activeToggles,
        effectSlugs,
        featureSlugs,
        context,
        target,
      ),
    );
  }
  if (typeof node === "object" && node !== null) {
    if ("not" in node)
      return !_evalToggleNode(
        node.not,
        activeToggles,
        effectSlugs,
        featureSlugs,
        context,
        target,
      );
    if ("or" in node) {
      const arr = Array.isArray(node.or) ? node.or : [node.or];
      return arr.some((item) =>
        _evalToggleNode(
          item,
          activeToggles,
          effectSlugs,
          featureSlugs,
          context,
          target,
        ),
      );
    }
    if ("and" in node) {
      const arr = Array.isArray(node.and) ? node.and : [node.and];
      return arr.every((item) =>
        _evalToggleNode(
          item,
          activeToggles,
          effectSlugs,
          featureSlugs,
          context,
          target,
        ),
      );
    }
    if ("nand" in node) {
      const arr = Array.isArray(node.nand) ? node.nand : [node.nand];
      return !arr.every((item) =>
        _evalToggleNode(
          item,
          activeToggles,
          effectSlugs,
          featureSlugs,
          context,
          target,
        ),
      );
    }
    if ("nor" in node) {
      const arr = Array.isArray(node.nor) ? node.nor : [node.nor];
      return !arr.some((item) =>
        _evalToggleNode(
          item,
          activeToggles,
          effectSlugs,
          featureSlugs,
          context,
          target,
        ),
      );
    }
  }
  return false;
}

// Returns true if any predicate in the tree references target:/attacker: context.
// Used to mark rules as inactive when no context is available rather than
// letting "not" invert an indeterminate false into true.

function _predicatesRequireContext(predicates) {
  if (!predicates) return false;
  if (typeof predicates === "string") {
    return (
      predicates.startsWith("target:") ||
      predicates.startsWith("attacker:") ||
      predicates.startsWith("spell:") ||
      predicates.startsWith("weapon:") ||
      predicates.startsWith("source:") ||
      // Bare "self:proficient" needs rollField; explicit "self:proficient:<skill>" doesn't.
      predicates === "self:proficient"
    );
  }
  if (Array.isArray(predicates)) {
    return predicates.some((p) => _predicatesRequireContext(p));
  }
  if (typeof predicates === "object") {
    for (const key of ["not", "or", "and", "nand", "nor"]) {
      if (key in predicates) return _predicatesRequireContext(predicates[key]);
    }
  }
  return false;
}

// Returns true if no predicates, or all pass. Returns false if any fail.
// context = { attackerToken, targetCreatureType } — roll context
// effect = the effect being evaluated (for appliedBy lookup)
// target = the token that has the effect (for effectValues lookup)

function evaluatePredicates(predicates, context, effect, target) {
  if (!predicates || (Array.isArray(predicates) && predicates.length === 0))
    return true;
  return evaluateSinglePredicate(predicates, context, effect, target);
}

// Resolve @record.data.X / @caster.data.X references embedded in a predicate
// string to their current values, so a predicate can reference a choiceSet /
// input / stored value — e.g. "weapon:@record.data.effectChoices.magicWeapon.weapon"
// becomes "weapon:longsword". @record resolves against the token being evaluated
// (`target`); @caster against the applying/attacking token from context. Always
// substitutes a String (never an object/undefined), so downstream .trim() /
// .toLowerCase() calls can't throw on a non-string.
function _resolvePredicateRefs(predicate, target, context) {
  const resolvePath = (root, path) => {
    let v = root;
    for (const seg of path.split(".")) {
      v = v == null ? undefined : v[seg];
      if (v === undefined || v === null) return undefined;
    }
    return v;
  };
  const sub = (root) => (m, path) => {
    const v = resolvePath(root, path);
    // Leave the raw reference untouched if it resolves to nothing or an object
    // (e.g. the choice container without its leaf field) so we never inject
    // "[object Object]" or undefined into the predicate.
    return v === undefined || typeof v === "object" ? m : String(v);
  };
  let out = predicate.replace(/@record\.data\.([\w.]+)/g, sub(target?.data));
  const caster = context?.casterToken || context?.attackerToken;
  out = out.replace(/@caster\.data\.([\w.]+)/g, sub(caster?.data));
  return out;
}

function evaluateSinglePredicate(predicate, context, effect, target) {
  // String predicate — evaluate the condition directly
  if (typeof predicate === "string") {
    // Resolve embedded @record.data / @caster.data references first so
    // predicates can be driven by choiceSet/input values (e.g.
    // "weapon:@record.data.effectChoices.magicWeapon.weapon" → "weapon:longsword").
    if (
      predicate.indexOf("@record.data.") !== -1 ||
      predicate.indexOf("@caster.data.") !== -1
    ) {
      predicate = _resolvePredicateRefs(predicate, target, context);
    }
    if (predicate === "target:applied_by") {
      if (!context) return false;
      const appliedBy = getEffectAppliedBy(target, effect);
      return (
        !!appliedBy &&
        !!context.attackerToken?._id &&
        appliedBy === context.attackerToken._id
      );
    }
    if (predicate.startsWith("target:creature_type:")) {
      if (!context) return false;
      const requiredType = predicate
        .slice("target:creature_type:".length)
        .toLowerCase()
        .trim();
      return _parseCreatureTypes(context.targetCreatureType).includes(
        requiredType,
      );
    }
    if (predicate.startsWith("self:creature_type:")) {
      const requiredType = predicate
        .slice("self:creature_type:".length)
        .toLowerCase()
        .trim();
      return _parseCreatureTypes(target?.data?.creatureType).includes(
        requiredType,
      );
    }
    // "attacker:creature_type:<type>" — true if the attacking creature
    // (context.attackerToken) is of the given creature type. Lets a defender's
    // attackTargeting effect scope to attacker species (e.g. "fiends have
    // disadvantage on attacks against you").
    if (predicate.startsWith("attacker:creature_type:")) {
      if (!context?.attackerToken) return false;
      const requiredType = predicate
        .slice("attacker:creature_type:".length)
        .toLowerCase()
        .trim();
      return _parseCreatureTypes(
        context.attackerToken?.data?.creatureType,
      ).includes(requiredType);
    }
    if (predicate.startsWith("attacker:senses:")) {
      if (!context) return false;
      const requiredSense = predicate
        .slice("attacker:senses:".length)
        .toLowerCase()
        .trim();
      const senses = (context.attackerToken?.data?.senses || "").toLowerCase();
      return senses.includes(requiredSense);
    }
    // "attacker:effect:<slug>" — true if the attacking creature (context.attackerToken)
    // has an effect whose slugified name matches. Lets a defender scope a bonus to a
    // chosen attacker by marking that attacker with a known effect. Requires attacker
    // context (threaded by the attack flows).
    if (predicate.startsWith("attacker:effect:")) {
      if (!context?.attackerToken) return false;
      const slug = predicate.slice("attacker:effect:".length).trim().toLowerCase();
      if (!slug) return false;
      // HP-derived pseudo-conditions ("bloodied"/"wounded") are true from the
      // attacker's HP state even without an applied effect; fall through to
      // effect-presence otherwise (so a manually applied effect still matches).
      if (_hpPseudoCondition(slug, context.attackerToken)) return true;
      return (context.attackerToken.effects || []).some(
        (e) => _slugifyName(e?.name) === slug,
      );
    }
    // "target:effect:<slug>" — true if the creature being attacked (context.targetToken)
    // has an effect whose slugified name matches. Lets an attacker scope a bonus to a
    // marked target (e.g. a taunt that grants advantage attacking the chosen creature).
    if (predicate.startsWith("target:effect:")) {
      if (!context?.targetToken) return false;
      const slug = predicate.slice("target:effect:".length).trim().toLowerCase();
      if (!slug) return false;
      // HP-derived pseudo-conditions ("bloodied"/"wounded") are true from the
      // target's HP state even without an applied effect; fall through to
      // effect-presence otherwise (so a manually applied effect still matches).
      // e.g. sahuagin "advantage on melee attacks vs creatures that don't have
      // all their hit points" → target:effect:wounded.
      if (_hpPseudoCondition(slug, context.targetToken)) return true;
      return (context.targetToken.effects || []).some(
        (e) => _slugifyName(e?.name) === slug,
      );
    }
    // "source:<slug>" — true if the spell/ability that triggered this roll has a
    // slugified name matching. context.sourceName is threaded by rollSavingThrow
    // (ability saves) and the spell save macros (spell name). Lets an effect
    // grant a bonus/penalty on saves vs a specific named feature.
    if (predicate.startsWith("source:")) {
      if (!context?.sourceName) return false;
      const slug = predicate.slice("source:".length).trim().toLowerCase();
      if (!slug) return false;
      return _slugifyName(context.sourceName) === slug;
    }
    if (predicate.startsWith("self:senses:")) {
      const requiredSense = predicate
        .slice("self:senses:".length)
        .toLowerCase()
        .trim();
      const senses = (target?.data?.senses || "").toLowerCase();
      return senses.includes(requiredSense);
    }
    // Proficiency predicate: "self:proficient" or "self:proficient:<skill>"
    //   self:proficient            → proficient in the skill currently being
    //                                 rolled (uses context.rollField)
    //   self:proficient:<skill>    → proficient in the named skill
    // "Proficient" here means full prof or expertise (not half).
    if (
      predicate === "self:proficient" ||
      predicate.startsWith("self:proficient:")
    ) {
      let skillField = "";
      if (predicate === "self:proficient") {
        if (!context?.rollField) return false;
        skillField = context.rollField;
      } else {
        skillField = predicate.slice("self:proficient:".length).trim();
      }
      if (!skillField) return false;
      // Try direct match first, then camelCase if the user passed a display name
      const profValue =
        target?.data?.[`${skillField}Prof`] ??
        target?.data?.[`${normalToCamelCase(skillField)}Prof`];
      return profValue === "true" || profValue === "expertise";
    }
    // Spell predicate: "spell:<value>" — true if the spell currently being cast
    // matches <value> as either its School of Magic (data.school, e.g.
    // "spell:evocation") OR one of its spell lists (data.spellLists, the classes
    // that can cast it, e.g. "spell:druid" / "spell:cleric"). Both surfaced on
    // context by the cast path.
    if (predicate.startsWith("spell:")) {
      if (!context) return false;
      const required = predicate.slice("spell:".length).toLowerCase().trim();
      // spell:<slug> matches the cast spell's NAME (e.g. spell:call-lightning
      // for a spell named "Call Lightning") in addition to school/lists/tags.
      if (context.spellName && _slugifyName(context.spellName) === required) {
        return true;
      }
      const tags = (context.spellTags || []).map((t) =>
        String(t).toLowerCase(),
      );
      if (tags.includes(required)) return true;
      if (
        context.spellSchool &&
        String(context.spellSchool).toLowerCase() === required
      ) {
        return true;
      }
      return (context.spellLists || [])
        .map((l) => String(l).toLowerCase())
        .includes(required);
    }
    // Weapon predicate: "weapon:<property>" — checks the attacking weapon's
    // properties or the attack's melee/ranged mode. Context is populated by
    // getEffectsAndModifiersForToken when itemId is provided.
    //   weapon:ranged  → true if the attack is currently a ranged attack
    //                    (ranged weapons, or thrown weapons with rangeToggleBtn=ranged)
    //   weapon:melee   → true if the attack is currently a melee attack
    //   weapon:pact    → true if data.isPactWeapon is set, or if the weapon
    //                    name contains "pact" (case-insensitive). The name
    //                    fallback catches user-renamed magic weapons.
    //   weapon:<prop>  → true if data.weaponProperties contains <prop>
    //                    (case-insensitive; e.g. weapon:finesse, weapon:two-handed)
    if (predicate.startsWith("weapon:")) {
      if (!context?.weapon) return false;
      const rest = predicate.slice("weapon:".length).toLowerCase().trim();
      if (rest === "ranged") return context.isRangedAttack === true;
      if (rest === "melee") return context.isRangedAttack === false;
      // weapon:pact — true if data.isPactWeapon is set, or if the weapon
      // name contains "pact" (e.g. a manually-named magic pact weapon).
      if (rest === "pact") {
        if (context.weapon?.data?.isPactWeapon === true) return true;
        return (context.weapon?.name || "").toLowerCase().includes("pact");
      }
      // weapon:name:<substring> — case-insensitive substring match on name
      if (rest.startsWith("name:")) {
        const needle = rest.slice("name:".length).trim();
        if (!needle) return false;
        return (context.weapon?.name || "").toLowerCase().includes(needle);
      }
      // weapon:type:<exact> — exact (ci) match against data.weaponType
      if (rest.startsWith("type:")) {
        const wantedType = rest.slice("type:".length).trim();
        if (!wantedType) return false;
        return (
          (context.weapon?.data?.weaponType || "").toLowerCase().trim() ===
          wantedType
        );
      }
      // weapon:<property> — case-insensitive match on data.weaponProperties
      const weaponProps = (context.weapon?.data?.weaponProperties || []).map(
        (p) => String(p).toLowerCase(),
      );
      return weaponProps.includes(rest);
    }
    // Comparison: "self:data.path:op:value"
    // Operators: gte, gt, lte, lt, eq. If the rhs is non-numeric, "eq" falls
    // back to case-insensitive string equality (other ops require numbers).
    const compMatch = predicate.match(/^self:([^:]+):(gte|gt|lte|lt|eq):(.+)$/);
    if (compMatch) {
      const [, path, op, rawVal] = compMatch;
      let actual = target;
      for (const part of path.split(".")) {
        actual = actual?.[part];
        if (actual === undefined || actual === null) break;
      }
      const threshold = parseFloat(rawVal);
      if (isNaN(threshold)) {
        if (op === "eq") {
          return (
            String(actual ?? "")
              .trim()
              .toLowerCase() === rawVal.trim().toLowerCase()
          );
        }
        return false;
      }
      const num = parseFloat(actual);
      if (isNaN(num)) return false;
      if (op === "gte") return num >= threshold;
      if (op === "gt") return num > threshold;
      if (op === "lte") return num <= threshold;
      if (op === "lt") return num < threshold;
      if (op === "eq") return num === threshold;
    }
    return false;
  }

  // Array: implicit AND — all items must be true
  if (Array.isArray(predicate)) {
    return predicate.every((item) =>
      evaluateSinglePredicate(item, context, effect, target),
    );
  }

  // Object: logical operators
  if (typeof predicate === "object" && predicate !== null) {
    if ("not" in predicate) {
      return !evaluateSinglePredicate(predicate.not, context, effect, target);
    }
    if ("or" in predicate) {
      const arr = Array.isArray(predicate.or) ? predicate.or : [predicate.or];
      return arr.some((item) =>
        evaluateSinglePredicate(item, context, effect, target),
      );
    }
    if ("and" in predicate) {
      const arr = Array.isArray(predicate.and)
        ? predicate.and
        : [predicate.and];
      return arr.every((item) =>
        evaluateSinglePredicate(item, context, effect, target),
      );
    }
    if ("nand" in predicate) {
      const arr = Array.isArray(predicate.nand)
        ? predicate.nand
        : [predicate.nand];
      return !arr.every((item) =>
        evaluateSinglePredicate(item, context, effect, target),
      );
    }
    if ("nor" in predicate) {
      const arr = Array.isArray(predicate.nor)
        ? predicate.nor
        : [predicate.nor];
      return !arr.some((item) =>
        evaluateSinglePredicate(item, context, effect, target),
      );
    }
  }

  return false;
}

// Same as getEffectsAndModifiers but for a token that is passed

function getAbilityScoreIncrease(feature) {
  const asi = feature?.data?.abilityScores || "";
  let max = 20;
  let scores = [];
  if (!asi) {
    return { max, scores, promptChoice: false, count: 0 };
  }

  const lower = asi.toLowerCase();

  // Parse the maximum value from the phrase
  const maxMatch = lower.match(/to a maximum of (\d+)/);
  if (maxMatch) {
    max = parseInt(maxMatch[1], 10);
  }

  // "Increase one ability score by 2, or increase two ability scores by 1"
  if (
    lower.match(/one ability score of your choice/) &&
    lower.match(/or increase two ability scores/)
  ) {
    return {
      max,
      scores: [
        "strength",
        "dexterity",
        "constitution",
        "intelligence",
        "wisdom",
        "charisma",
      ],
      promptChoice: true,
      count: 2,
    };
  }

  // "An ability score of your choice increases by 1" or
  // "increase one ability score" / "choose one ability in which"
  if (
    lower.match(/an ability score of your choice/) ||
    lower.match(/increase one ability score/) ||
    lower.match(/choose one ability in which/)
  ) {
    // Only if no specific abilities are named
    const namedAbilities = lower.match(
      /strength|dexterity|constitution|intelligence|wisdom|charisma/g,
    );
    if (!namedAbilities) {
      return {
        max,
        scores: [
          "strength",
          "dexterity",
          "constitution",
          "intelligence",
          "wisdom",
          "charisma",
        ],
        promptChoice: true,
        count: 1,
      };
    }
  }

  // Extract named ability scores (e.g. "Your Strength or Dexterity score increases by 1")
  const abilityMatch = lower.match(
    /strength|dexterity|constitution|intelligence|wisdom|charisma/g,
  );
  if (abilityMatch) {
    scores = abilityMatch;
  }

  return { max, scores, promptChoice: scores.length > 1, count: 1 };
}

function recalcPassiveSkills(rec, fieldsToSet) {
  getSkills().forEach((skill) => {
    const modKey = `data.${skill.field}Mod`;
    const skillMod =
      fieldsToSet[modKey] !== undefined
        ? parseInt(fieldsToSet[modKey], 10) || 0
        : parseInt(rec?.data?.[`${skill.field}Mod`] || "0", 10);
    const cap = skill.field.charAt(0).toUpperCase() + skill.field.slice(1);
    const passiveKey = `data.passive${cap}`;
    const detailKey = `data.passive${cap}Detail`;
    const result = calcPassiveSkillFromMod(rec, skill.field, skillMod);
    fieldsToSet[passiveKey] = result.value;
    fieldsToSet[detailKey] = result.breakdown;
  });
}

// Known weapon properties for conditional AC bonus checks

function calculateSpeed(rec) {
  // Base speed comes from the heritage (biological trait), default 30 ft
  const heritage = (rec?.data?.heritages || [])[0];
  const heritageSpeed = String(heritage?.data?.speed || "30 ft");

  // Parse heritage speed (extract number from string like "30 ft" or "30")
  const match = heritageSpeed.match(/(\d+)/);
  if (!match) return heritageSpeed; // Return as-is if unparseable

  let speedValue = parseInt(match[1], 10);
  const unit = heritageSpeed.replace(match[1], "").trim() || "ft";

  // Collect additional speed modes (e.g., "Fly (30 ft)"). Dedupe by source name
  // so a feature that was re-added at a higher level (levelScaling upgrade) replaces
  // its prior string instead of stacking a duplicate.
  const additionalModes = [];
  const modeIndexBySource = new Map();
  const addMode = (sourceName, bonusValue) => {
    const key = (sourceName || "").trim();
    if (key && modeIndexBySource.has(key)) {
      additionalModes[modeIndexBySource.get(key)] = bonusValue;
    } else {
      const idx = additionalModes.length;
      additionalModes.push(bonusValue);
      if (key) modeIndexBySource.set(key, idx);
    }
  };

  // Apply all feature speed modifiers: baseSpeed first (upgrades only), then bonus/penalty
  const features = rec?.data?.features || [];
  features.forEach((feature) => {
    const modifiers = feature?.data?.modifiers || [];
    modifiers.forEach((mod) => {
      if (mod?.data?.active !== false && mod?.data?.type === "baseSpeed") {
        const newBase = parseInt(mod?.data?.value, 10) || 0;
        if (newBase > speedValue) {
          speedValue = newBase;
        }
      }
    });
  });
  features.forEach((feature) => {
    const modifiers = feature?.data?.modifiers || [];
    modifiers.forEach((mod) => {
      if (mod?.data?.active !== false) {
        if (mod?.data?.type === "speedPenalty") {
          const penaltyValue = Math.abs(parseInt(mod?.data?.value, 10) || 0);
          speedValue -= penaltyValue;
        } else if (mod?.data?.type === "speedBonus") {
          const bonusValue = mod?.data?.value;
          const numericBonus = parseInt(bonusValue, 10);
          if (
            !isNaN(numericBonus) &&
            String(numericBonus) === String(bonusValue).trim()
          ) {
            speedValue += numericBonus;
          } else if (bonusValue) {
            addMode(feature?.name, bonusValue);
          }
        }
      }
    });
  });

  // Get speedBonus and speedPenalty modifiers from equipped items
  const inventory = rec?.data?.inventory || [];
  inventory.forEach((item) => {
    if (item?.data?.carried === "equipped") {
      const modifiers = item?.data?.modifiers || [];
      modifiers.forEach((mod) => {
        if (mod?.data?.active !== false) {
          if (mod?.data?.type === "speedPenalty") {
            const penaltyValue = Math.abs(parseInt(mod?.data?.value, 10) || 0);
            speedValue -= penaltyValue;
          } else if (mod?.data?.type === "speedBonus") {
            const bonusValue = mod?.data?.value;
            const numericBonus = parseInt(bonusValue, 10);
            if (
              !isNaN(numericBonus) &&
              String(numericBonus) === String(bonusValue).trim()
            ) {
              speedValue += numericBonus;
            } else if (bonusValue) {
              addMode(item?.name, bonusValue);
            }
          }
        }
      });
    }
  });

  // Don't allow speed to go below 0
  speedValue = Math.max(0, speedValue);

  // Construct final speed string
  let finalSpeed = `${speedValue} ${unit}`;
  if (additionalModes.length > 0) {
    finalSpeed += ", " + additionalModes.join(", ");
  }

  return finalSpeed;
}

// Returns grid squares occupied by a creature of the given size

function getEffectiveMaxDex(rec, bestEquippedArmor) {
  const baseCap = bestEquippedArmor?.maxDex || 0;
  // 0 = no Dex allowed (heavy); 99 = uncapped (light). Neither should be
  // touched by a "raise the cap" feature.
  if (baseCap === 0 || baseCap >= 99) return baseCap;
  const category = (bestEquippedArmor?.category || "").toLowerCase();
  const mods = getEffectsAndModifiersForToken(rec, ["armorMaxDexBonus"]);
  let floor = 0;
  mods.forEach((mod) => {
    if (mod.active === false) return;
    const f = (mod.field || "").toLowerCase().trim();
    if (f && f !== "all" && f !== category) return;
    const v = parseInt(mod.value, 10);
    if (!isNaN(v) && v > floor) floor = v;
  });
  return Math.max(baseCap, floor);
}

// Gets the best equipped armor for the context of the current PC



// Builds an Apply-Damage macro (triple-backtick block) from a PRE-BUILT
// damageByType map (e.g. {"fire": 12}). Mirrors damage.js's inline Apply_Damage
// macro (RIV by type, threshold, temp HP, death, concentration, undo) for
// synthetic damage sources (ongoing/ability damage). 5e 2024 has no
// magical/silvered/cold-iron distinction, so RIV is purely by damage type.
// Parse resistance/immunity-bypass markers out of a damage-modifier list.
// A damageBonus/damagePenalty modifier whose (string) value reads like
// "ignore acid resistance" or "ignore acid immunity" is not real damage — it
// flags that this attack bypasses the target's acid defenses (the second word
// is the damage type). This lets an EFFECT on the attacker drive the bypass:
// while the effect is on, its rules surface here as these markers.
// Returns the two comma-joined type strings the damage handler
// (damage.js / getDamageMacro) expects, plus a `cleaned` list with the markers
// removed so they don't leak into the roll as bogus damage terms. Mirrors the
// inline parse in attack-list.html so all damage paths behave identically.
function extractDamageBypass(damageModifiers) {
  const mods = damageModifiers || [];
  const typeOf = (v) => v.trim().split(/\s+/)[1] || "";
  const collect = (predicate) =>
    mods
      .filter(
        (m) =>
          typeof m.value === "string" &&
          predicate(m.value.trim().toLowerCase()),
      )
      .map((m) => typeOf(m.value))
      .filter(Boolean)
      .join(",");

  const damageIgnoresResistances = collect(
    (v) => v.startsWith("ignore") && v.includes("resistance"),
  );
  const damageIgnoresImmunities = collect(
    (v) =>
      v.startsWith("ignore") &&
      (v.includes("immunity") || v.includes("immunities")),
  );

  const cleaned = mods.filter(
    (m) => !String(m.value ?? "").toLowerCase().includes("ignore"),
  );

  return {
    damageIgnoresResistances,
    damageIgnoresImmunities,
    cleaned,
  };
}

function getDamageMacro(macroName, damageByType, options = {}) {
  const {
    isCritical = false,
    isSpell = false,
    isHalf = false,
    damageIgnoresResistances = [],
    damageIgnoresImmunities = [],
  } = options;
  return `\`\`\`${macroName}
let targets = api.getSelectedOrDroppedToken();

// If record is not null, check if we're the GM or owner and use it
if (record) {
  if (isGM || record?.record?.ownerId === userId) {
    targets = [record];
  }
}

// If we're a player and we did not drop on a record, get our owned tokens
if (!isGM && targets.length === 0) {
    targets = api.getSelectedOwnedTokens().map(target => target.token);
}

targets.forEach(target => {
  // Apply damage
  if (target && target.data) {
    let damage = 0;

    const RIV = getRIV(target);

    // First, just get the total of all damage for each type
    const damageByType = ${JSON.stringify(damageByType)};

    // Damage the target absorbs is converted into healing instead of applied.
    let absorbedHealing = 0;

    // We need to go through each damage type and check if the target has resistance, immunity, or vulnerability to it.
    Object.keys(damageByType).forEach(type => {
      let thisDamage = damageByType[type];
      ${isHalf ? 'thisDamage = Math.floor(thisDamage / 2);' : ''}
      // Absorption: the target regains HP equal to this type's damage instead
      // of taking it (e.g. Shambling Mound + lightning).
      if (RIV.absorptions.includes(type.toLowerCase())
        || RIV.absorptions.includes('all')
        || (${isSpell} && RIV.absorptions.includes('spell'))) {
        absorbedHealing += thisDamage;
        return;
      }
      // If the damage type is in the ignore resistances list, we don't apply resistances
      if (!${JSON.stringify(
        damageIgnoresResistances
      )}.includes(type.toLowerCase())) {
        if (RIV.resistances.includes(type.toLowerCase() || '')
          || (${isSpell} && RIV.resistances.includes('spell'))) {
          thisDamage = Math.floor(thisDamage * 0.5);
        }
      }
      // If the damage type is in the ignore immunities list, we don't apply immunities
      if (!${JSON.stringify(
        damageIgnoresImmunities
      )}.includes(type.toLowerCase())) {
        if (RIV.immunities.includes(type.toLowerCase() || '')
          || (${isSpell} && RIV.immunities.includes('spell'))) {
          thisDamage = 0;
        }
      }
      if (RIV.vulnerabilities.includes(type.toLowerCase() || '')
        || (${isSpell} && RIV.vulnerabilities.includes('spell'))) {
        thisDamage = Math.floor(thisDamage * 2);
      }

      // Apply additional one-off resistances per damage type
      if (RIV.resistanceByDamage[type.toLowerCase()]) {
        thisDamage -= RIV.resistanceByDamage[type.toLowerCase()];
        if (thisDamage < 0) {
          thisDamage = 0;
        }
      }

      damage += thisDamage;
    });

    // We cannot deal negative damage
    if (damage < 0) {
      damage = 0;
    }

    // Finally, if the target has a damage threshold, we need to check if the damage done meets or exceeds the threshold
    let dueToThreshold = false;
    if (target.data?.damageThreshold && damage < target.data?.damageThreshold) {
      // If the damage is less than the threshold, it takes no damage
      damage = 0;
      dueToThreshold = true;
    }

    var curhp = target.data?.curhp || 0;
    const oldTempHp = parseInt(target.data?.tempHp || '0', 10);

    // If damage > 0, float text
    if (damage > 0) {
      if ((curhp + oldTempHp) - damage <= 0) {
        if (target.recordType === 'npcs') {
          api.addEffect("Dead", target);
        }
        else {
          api.addEffects(["Unconscious", "Prone"], target);
        }
      }
      api.floatText(target, \`-\$\{damage\}\`, '#FF0000');
    }
    
    // First deduct from Temp HP
    const newTempHp = Math.max(oldTempHp - damage, 0);
    const originalDamage = damage;
    damage = Math.max(damage - oldTempHp, 0);
    let usedTempHp = false;
    if (newTempHp !== oldTempHp) {
      api.setValueOnToken(target, "data.tempHp", newTempHp);
      usedTempHp = true;
    }

    // Then deduct from Current HP and check for Instant Death
    let instantDeath = false;
    curhp -= damage;
    if (curhp < 0) { 
      // If the remainder of damage >= max HP, we apply Instant Death (if it's a character)
      if (Math.abs(curhp) >= target.data?.hitpoints && target.recordType === 'characters') {
        instantDeath = true;
      }
      curhp = 0;
    }
    // Absorbed damage is regained as HP (capped at max HP), applied after damage.
    if (absorbedHealing > 0) {
      curhp += absorbedHealing;
      api.floatText(target, \`+\$\{absorbedHealing\}\`, '#1bc91b');
    }
    if (curhp > target.data?.hitpoints) { curhp = target.data?.hitpoints; }
    const oldHp = (target.data?.curhp || 0);
    api.setValueOnToken(target, "data.curhp", curhp);

    const unIdentified = target.identified === false;
    let targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;
    targetName = targetName.replace(/'/g, ''); // Just remove the single quotes

    let message = \`\$\{targetName\} took \$\{damage\} damage.\`;
    if (usedTempHp) {
      message = \`\$\{targetName\} took \$\{originalDamage\} damage and lost \$\{damage\} HP after deducting Temp HP.\`;
    }
    if (dueToThreshold) {
      message = \`\$\{targetName\} took no damage due to the damage threshold.\`;
    }
    if (absorbedHealing > 0) {
      message += \`\nAbsorbed \$\{absorbedHealing\} damage and regained \$\{absorbedHealing\} HP.\`;
    }

    if (instantDeath && target.recordType === 'characters') {
      message += \`\n**[center][color=red]INSTANT DEATH[/color][/center]**\`;
      applyInstantDeath(target);
    }
    else if (damage > 0 && target.recordType === 'characters') {
      // If damage was done, we apply death failures if necessary and not instant death
      applyDeathFailures(target, ${isCritical});
    }

    // Check for Concentration effect, and add a button to Roll Concentration Check
    let concentrationMacro = '';
    const effects = target.effects || [];
    const concentration = effects.find(effect => effect.name === 'Concentration');
    let oldSpellName = '';
    if (concentration && originalDamage > 0 && curhp > 0) {
      // DC is half the damage done rounded down or 10, whichever is higher, to a max of 30 
      concentrationMacro = getConcentrationMacro(originalDamage);
    }
    else if (concentration && curhp <= 0) {
      // Remove the Concentration effect
      const oldValues = target?.effectValues || {};
      if (oldValues[concentration?._id]) {
        oldSpellName = oldValues[concentration?._id];
      }
      const conId = concentration?._id;
      api.removeEffectById(conId, target);
    }

    const macro = damage > 0 && !instantDeath ? \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.tempHp', '\$\{oldTempHp\}'); api.editMessage(null, '~\$\{message\}~'); } else { api.showNotification('Only the GM can undo damage.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\` : '';

    if (oldSpellName) {
      message += \`\nLost concentration on \$\{oldSpellName\}.\`;
    }

    api.sendMessage(\`\$\{message\}\\n\$\{macro\}\\n\$\{concentrationMacro\}\`, undefined, undefined, undefined, target);
  }
});
\`\`\``;
}

// Apply a "minimum damage die roll" (e.g. minDamageRoll=2 → every damage die that
// rolled below 2 is treated as 2). Mutates roll.types/roll.dice in place and bumps
// roll.total by the adjustment. Returns { totalAdjustment, adjustedCount }.
// Sourced from a damage modifier whose value is "minrollN" (via getMinRollModifier).
function applyMinDamageRoll(roll, minDamageRoll) {
  let totalAdjustment = 0;
  let adjustedCount = 0;
  if (!roll || !minDamageRoll) {
    return { totalAdjustment, adjustedCount };
  }
  if (Array.isArray(roll.types)) {
    roll.types = roll.types.map((t) => {
      const value = parseInt(t.value, 10);
      if (t.die && !isNaN(value) && value < minDamageRoll) {
        totalAdjustment += minDamageRoll - value;
        adjustedCount++;
        return { ...t, value: minDamageRoll };
      }
      return t;
    });
  }
  if (Array.isArray(roll.dice)) {
    roll.dice = roll.dice.map((d) => {
      const value = parseInt(d.value, 10);
      if (d.reason !== "dropped" && !isNaN(value) && value < minDamageRoll) {
        return { ...d, value: minDamageRoll };
      }
      return d;
    });
  }
  if (totalAdjustment > 0) {
    roll.total = (parseInt(roll.total, 10) || 0) + totalAdjustment;
  }
  return { totalAdjustment, adjustedCount };
}

// Recompute the character's total carried weight from data.inventory. Shared by
// the inventory row and the grid Use handler (commonScript). Skips dropped items
// and (when the ignoreWornArmorWeight effect is active) equipped armor/shields;
// optionally folds in coin weight. Pass setValues=false to get the number back
// instead of writing data.totalWeight.
function setTotalWeight(setValues = true) {
  const items = record.data?.inventory || [];
  let totalWeight = 0;

  const ignoreWornArmor =
    getEffectsAndModifiers(["ignoreWornArmorWeight"]).length > 0;

  items.forEach((item) => {
    if (item.data?.carried !== "dropped") {
      const itemType = (item.data?.type || "").toLowerCase();
      if (
        ignoreWornArmor &&
        item.data?.carried === "equipped" &&
        (itemType.includes("armor") || itemType === "shield")
      ) {
        return;
      }
      let weight = parseFloat(item.data?.weight || "0");
      let count = parseFloat(item.data?.count || "0");
      if (count === undefined || isNaN(count)) {
        count = 0;
      }
      if (weight !== undefined && !isNaN(weight)) {
        totalWeight += weight * count;
      }
    }
  });

  const includeCoinage = api.getSetting("coinWeight") === "yes";
  if (includeCoinage) {
    const totalCoins =
      (record?.data?.cp || 0) +
      (record?.data?.sp || 0) +
      (record?.data?.ep || 0) +
      (record?.data?.gp || 0) +
      (record?.data?.pp || 0);
    totalWeight += totalCoins / 50;
  }

  totalWeight = Math.round(totalWeight * 100) / 100;

  if (setValues) {
    api.setValue("data.totalWeight", totalWeight);
  } else {
    return totalWeight;
  }
}

// Shared inventory "Use" logic. Outputs the item's description (plus any linked
// spell and effect/healing/damage macros) to chat, then, for consumables,
// deducts count and removes the item at 0. Shared by the item-row Use button
// (useItem) and the grid popover's Use button (useGridItem). `itemDataPath` is
// the path to the item, e.g. "data.inventory.3".
function useInventoryItem(itemDataPath) {
  const itemName = api.getValue(`${itemDataPath}.name`);
  const itemCount = api.getValue(`${itemDataPath}.data.count`);
  const indexValue = parseInt(itemDataPath.split(".").pop());
  const isConsumable =
    api.getValue(`${itemDataPath}.data.consumable`) || false;

  const description = api.getValue(`${itemDataPath}.data.description`) || "";
  const effects = api.getValue(`${itemDataPath}.data.effects`) || [];
  const healing = api.getValue(`${itemDataPath}.data.healing`);
  const damage = api.getValue(`${itemDataPath}.data.useDamage`);
  const rawPortrait = api.getValue(`${itemDataPath}.portrait`);
  const itemIcon = rawPortrait
    ? `![${itemName}](${assetUrl}${encodeURI(rawPortrait)}?width=40&height=40) `
    : "";
  const itemDescription = api.richTextToMarkdown(description || "");
  let markdownDescription = `
#### ${itemIcon}${itemName}

---
${itemDescription}
`;

  let recordLinks;
  const spell = api.getValue(`${itemDataPath}.data.spell`);
  if (spell) {
    const spellName = JSON.parse(spell)?.name || "";
    const spellId = JSON.parse(spell)?._id || "";
    if (spellId) {
      recordLinks = [
        {
          tooltip: spellName,
          type: "records",
          value: {
            _id: spellId,
            recordType: "spells",
          },
        },
      ];
    }
  }

  if (effects) {
    let effectButtons = getEffectMacrosFor(effects);
    markdownDescription += `\n${effectButtons}`;
  }

  if (healing) {
    const escapedName = itemName.replace(/'/g, "\\'");
    const escapedHealing = healing.replace(/'/g, "\\'");
    const healingButton = `\`\`\`Roll_Healing
api.promptRoll('${escapedName} Healing', '${escapedHealing}', [], {}, 'healing')
\`\`\``;
    markdownDescription += `\n${healingButton}`;
  }

  if (damage) {
    const escapedName = itemName.replace(/'/g, "\\'");
    const escapedDamage = damage.replace(/'/g, "\\'");
    const damageButton = `\`\`\`Roll_Damage
api.promptRoll('${escapedName} Damage', '${escapedDamage}', [], {}, 'damage')
\`\`\``;
    markdownDescription += `\n${damageButton}`;
  }

  api.sendMessage(markdownDescription, undefined, recordLinks);

  // If consumable, deduct count by 1, delete item if count is 0
  if (isConsumable) {
    const count = parseFloat(itemCount || "0");
    if (count - 1 > 0) {
      api.setValue(`${itemDataPath}.data.count`, count - 1, function () {
        api.getRecord(record.recordType, record._id, function (rec) {
          record = rec;
          setTotalWeight();
        });
      });
    } else if (!isNaN(indexValue)) {
      api.removeValue(`data.inventory`, indexValue, function () {
        api.getRecord(record.recordType, record._id, function (rec) {
          record = rec;
          setTotalWeight();
        });
      });
    }
  }
}

// Apply an item's attribute modifiers (hitpoints / AC bonus/penalty) across all
// six abilities. Shared by onItemEquippedFor / onItemAttunedFor.
function updateAttributes(item, valuesToSet) {
  const hasModifiers =
    (item.data.modifiers || []).filter(
      (modifier) =>
        modifier.data.type === "hitpoints" ||
        modifier.data.type === "armorClassBonus" ||
        modifier.data.type === "armorClassPenalty",
    ).length > 0;

  if (!hasModifiers) {
    return;
  }

  [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
  ].forEach((attribute) => {
    const value = record?.data?.[attribute] || 0;
    setModifier(value, attribute, {}, valuesToSet);
  });
}

// Shared equip/carry/drop handler. Recomputes weight, AC, per-item field
// visibility (ammo row, range/melee toggles, use/attune buttons), equip effects,
// one-time modifiers, attribute bonuses and speed. Shared by the item-row
// carried dropdown (onItemEquipped) and the grid Equip/Carry/Drop actions
// (equipGridItem). `itemDataPath` is the item path; `newValue` is the new
// carried state ("equipped"/"carried"/"dropped").
function onItemEquippedFor(itemDataPath, newValue) {
  const item = api.getValue(itemDataPath);

  const itemFields = api.getValue(`${itemDataPath}.fields`) || {};
  const itemType = api.getValue(`${itemDataPath}.data.type`);
  const weaponProperties =
    api.getValue(`${itemDataPath}.data.weaponProperties`) || [];
  const hasAttunement =
    api.getValue(`${itemDataPath}.data.attunement`) || false;
  const isConsumable =
    api.getValue(`${itemDataPath}.data.consumable`) || false;
  const hasUseBtn = api.getValue(`${itemDataPath}.data.hasUseBtn`) || false;
  const isTwoHanded = weaponProperties.includes("Two-Handed");
  const isThrown = weaponProperties.includes("Thrown");
  const isMelee = (itemType || "").toLowerCase().includes("melee");

  const equipEffect = api.getValue(`${itemDataPath}.data.equipEffect`);
  const isEquipEffect = newValue === "equipped";

  if (equipEffect) {
    const effect = JSON.parse(equipEffect);
    const effectId = effect?._id || "";
    const ourToken = api.getToken();
    if (effectId && isEquipEffect && ourToken) {
      api.addEffectById(effectId, ourToken);
    } else if (effectId && !isEquipEffect && ourToken) {
      api.removeEffectById(effectId, ourToken);
    }
  }

  const valuesToSet = {};
  const totalWeight = setTotalWeight(false);
  if (totalWeight !== record?.data?.totalWeight) {
    valuesToSet["data.totalWeight"] = totalWeight;
  }

  updateAttributes(item, valuesToSet);

  const bestEquippedArmor = getBestEquippedArmor();
  if (
    JSON.stringify(record?.data?.armor || "{}") !==
    JSON.stringify(bestEquippedArmor)
  ) {
    valuesToSet["data.armor"] = bestEquippedArmor;
  }

  const totalAc = getArmorClass(bestEquippedArmor);
  if (record?.data?.ac !== totalAc) {
    valuesToSet["data.ac"] = totalAc;
  }

  valuesToSet[`${itemDataPath}.fields`] = {
    ...itemFields,
    attuned: { hidden: !hasAttunement },
    useBtn: { hidden: !isConsumable && !hasUseBtn },
    handBtn: { hidden: isTwoHanded },
    rangeToggleBtn: {
      hidden: !(isMelee && isThrown),
    },
    rangeToggleBtnDisabled: {
      hidden: isMelee,
    },
    meleeToggleBtnDisabled: {
      hidden: !isMelee || (isMelee && isThrown),
    },
    ammoRow: {
      hidden: isMelee && !isThrown,
    },
    ammoSelect: {
      hidden: isMelee || isThrown,
    },
  };

  if (isThrown && item.data?.count !== item.data?.ammo) {
    valuesToSet[`${itemDataPath}.data.ammo`] = item.data?.count || 0;
  }

  let needsHpRecalc = false;
  if (newValue === "equipped") {
    const result = applyOneTimeModifiers(item, valuesToSet);
    needsHpRecalc = result.needsHpRecalc;
  }
  const pendingItems = extractAllPending(valuesToSet);

  const afterPendingAll = () => {
    if (needsHpRecalc) recalcHitPoints();
  };
  const applyPendingIfNeeded = (rec) => {
    if (hasAnyPending(pendingItems)) {
      applyAllPending(pendingItems, rec || record, afterPendingAll);
    } else {
      afterPendingAll();
    }
  };

  const recompileBonuses = (rec) => {
    const latest = rec || record;
    const bonusFields = {};
    recalcAttributeBonuses(bonusFields, latest);
    const calculatedSpeed = calculateSpeed(latest);
    if (calculatedSpeed !== latest?.data?.speed) {
      bonusFields["data.speed"] = calculatedSpeed;
    }
    if (Object.keys(bonusFields).length > 0) {
      api.setValues(bonusFields, (afterBonuses) =>
        applyPendingIfNeeded(afterBonuses),
      );
    } else {
      applyPendingIfNeeded(latest);
    }
  };

  if (Object.keys(valuesToSet).length > 0) {
    api.setValues(valuesToSet, (updatedRecord) =>
      recompileBonuses(updatedRecord),
    );
  } else {
    recompileBonuses(record);
  }
}

// Shared attune/unattune handler. Re-derives attribute bonuses so attuning
// applies (and un-attuning removes) an item's attributeBonus/attributeSet
// modifiers. Shared by the item-row attuned toggle (onItemAttuned) and the grid
// Attune/Break actions (attuneGridItem). The item's data.attuned must already be
// set before calling.
function onItemAttunedFor(itemDataPath) {
  const item = api.getValue(itemDataPath);
  const valuesToSet = {};

  updateAttributes(item, valuesToSet);
  valuesToSet[`${itemDataPath}.data.attuned`] = item?.data?.attuned;

  api.setValues(valuesToSet, (updatedRecord) => {
    const bonusFields = {};
    recalcAttributeBonuses(bonusFields, updatedRecord);
    if (Object.keys(bonusFields).length > 0) {
      api.setValues(bonusFields);
    }
  });
}
