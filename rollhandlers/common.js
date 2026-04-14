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
  let idx = 0;
  const processNext = (currentRec) => {
    if (idx >= groups.length) {
      done(currentRec);
      return;
    }
    const ag = groups[idx++];
    const existingGroup = currentRec?.data?.abilityGroups?.find(
      (g) => g?.name === ag.abilityGroupName,
    );

    const afterGroupExists = (recWithGroup) => {
      const groupIdx = recWithGroup?.data?.abilityGroups?.findIndex(
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

function capitalize(string) {
  if (!string || typeof string !== "string") return "";
  return string.charAt(0).toUpperCase() + string.slice(1);
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

  // Remove "Concentration, up to " if present
  const cleanDuration = duration
    .toLowerCase()
    .replace(/^concentration,\s+up\s+to\s+/, "");

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
    const size = record?.data?.size || "Medium";
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
        valuesToSet[`data.${skill.field}Mod`] = totalVal;
      } else if (isExpertise) {
        totalVal = modVal + proficiencyBonus * 2;
        valuesToSet[`data.${skill.field}Mod`] = totalVal;
      } else if (isProficient) {
        totalVal = modVal + proficiencyBonus;
        valuesToSet[`data.${skill.field}Mod`] = totalVal;
      } else {
        totalVal = modVal;
        valuesToSet[`data.${skill.field}Mod`] = totalVal;
      }

      if (skill.field === "perception") {
        valuesToSet["data.passivePerception"] = 10 + totalVal;
      }
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
  const abilityGroups = record?.data?.abilityGroups || [];
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
function checkForReplacements(value, replacements = {}, recordOverride = null) {
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
      // Class specific half level
      const characterClassLevel =
        (thisRecord?.data?.classLevels || "").match(
          `${className} (\\d+)`,
        )?.[1] || 0;
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
      // Class specific level
      const characterClassLevel =
        (thisRecord?.data?.classLevels || "").match(
          `${className} (\\d+)`,
        )?.[1] || 0;
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
  // Replace @record.data.X with the value at that path on the character
  const recordDataMatches = [...value.matchAll(/@record\.data\.([\w.]+)/g)];
  for (const match of recordDataMatches) {
    const path = match[1];
    let resolved = thisRecord?.data;
    for (const segment of path.split(".")) {
      resolved = resolved?.[segment];
    }
    if (resolved !== undefined && resolved !== null) {
      value = value.replaceAll(match[0], String(resolved));
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
    const result = evaluateMath(expression);
    return String(result);
  });

  return value;
}

function isClassLevel(field) {
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
  ].includes(field);
}

function getClassLevel(recordContext, field, fieldValueOverrides) {
  const className = field.replace("Level", "");
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
) {
  let total = 0;
  let times5 = false;
  let plus1 = false;
  fieldsToAddToUses.forEach((field) => {
    let value = 0;
    if (field === "times5") {
      times5 = true;
    } else if (field === "plus1") {
      plus1 = true;
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
  if (times5) {
    total *= 5;
  }
  if (plus1) {
    total += 1;
  }
  return total;
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
) {
  let results = [];

  // Set of stack modifiers that we have seen so we don't duplicate them
  const stackModifiers = {};

  // First collect modifiers from effects
  const effects = record?.effects || [];
  effects.forEach((effect) => {
    const rules = effect.rules || [];
    rules.forEach((rule) => {
      // Check for extra data on the rule (e.g. active: false)
      const ruleActive = rule.data && rule.data.active === false ? false : true;

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
        value = checkForReplacements(value);
      }
      if (
        value !== 0 &&
        (rule.valueType === "number" || rule.valueType === "string")
      ) {
        let name = effect.name || "Effect";
        // If this is a stackable effect, add the effect per stack amount with a different name each time
        let times = 1;
        if (effect.stackable) {
          times = record?.effectIds?.filter((id) => id === effect?._id).length;
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
            appliedBy: getEffectAppliedBy(record, effect),
          });
        }
      } else if (rule.valueType === "api") {
        let value = parseInt(record?.effectValues?.[effect?._id] || "0", 10);
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
        let value = record?.effectIds?.filter(
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
            appliedBy: getEffectAppliedBy(record, effect),
          });
        }
      }
    });
  });

  // Now collect all modifiers from Features and Items
  const features = record?.data?.features || [];
  const items = record?.data?.inventory || [];
  // Filter items that are not equipped or that require attunement and not attuned
  const equippedItems = items.filter(
    (item) =>
      item.data?.carried === "equipped" &&
      (!item.data?.attunement || item.data?.attuned === "true"),
  );
  [...features, ...equippedItems].forEach((feature) => {
    const modifiers = feature.data?.modifiers || [];
    modifiers.forEach((modifier) => {
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
          value = record?.data?.[fieldToUse] || "";
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
        value = checkForReplacements(value);
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
    const bestEquippedArmor = record?.data?.armor || undefined;
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

// Same as getEffectsAndModifiers but for a token that is passed
function getEffectsAndModifiersForToken(
  target,
  types = [],
  field = "",
  itemId = undefined,
  appliedById = undefined,
) {
  if (!target) {
    return [];
  }
  let results = [];

  // Set of stack modifiers that we have seen so we don't duplicate them
  const stackModifiers = {};

  // First collect modifiers from effects
  const effects = target?.effects || [];
  effects.forEach((effect) => {
    const rules = effect.rules || [];
    rules.forEach((rule) => {
      // Check for extra data on the rule (e.g. active: false)
      const ruleActive = rule.data && rule.data.active === false ? false : true;

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
  [...features, ...equippedItems].forEach((feature) => {
    const modifiers = feature.data?.modifiers || [];
    modifiers.forEach((modifier) => {
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
        ? Math.min(dexMod, bestEquippedArmor.maxDex)
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

    // Replace the spell level with the actual spell level if in a  modifier
    altDamageModifiers.forEach((modifier) => {
      if (modifier?.valueType?.toLowerCase() === "string") {
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

    return `\`\`\`Roll_${
      altDamageType !== "untyped" ? capitalize(altDamageType) : "Spell"
    }_Damage
api.promptRoll(\`${
      altDamageType !== "untyped" ? capitalize(altDamageType) : "Spell"
    } Damage\`, '${damageString}', ${JSON.stringify(
      altDamageModifiers,
    )}, ${JSON.stringify(saveDamageMetadata)}, 'damage')
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

function rollSavingThrow(save, dc) {
  const selectedTokens = api.getSelectedOrDroppedToken();
  selectedTokens.forEach((token) => {
    save = save.toLowerCase();
    const mod = `${save.trim().toLowerCase()}Save`;
    let modifiers = [];
    let saveMod = token?.data?.[mod] || "0";
    if (saveMod === undefined) {
      saveMod = 0;
    }

    if (saveMod !== "0") {
      modifiers.push({
        name: `${capitalize(save)} Save Modifier`,
        value: saveMod,
        active: true,
      });
    }

    // Check effects for all save bonuses and penalties for saves
    const saveModifiers = getEffectsAndModifiersForToken(
      token,
      ["saveBonus", "savePenalty"],
      save,
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
      // skill is already normalized to camelCase field format (e.g., "sleightOfHand")
      const ability =
        token?.data?.[`${skill}Ability`] ||
        skillInfo?.ability ||
        getAbilityFromSkill(skill);
      const mod = `${ability}Mod`;

      let modifiers = [];
      let abilityMod = parseInt(token?.data?.[mod] || "0", 10);
      if (abilityMod === undefined || isNaN(abilityMod)) {
        abilityMod = 0;
      }

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
