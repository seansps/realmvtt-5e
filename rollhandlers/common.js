function capitalize(string) {
  if (!string || typeof string !== 'string') return '';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function normalToCamelCase(str) {
  return str.toLowerCase().replace(/\s+(.)/g, (match, char) => char.toUpperCase());
}

function camelToNormal(skill) {
  return skill.replace(/([A-Z])/g, ' $1').replace(/^./, function (str) { return str.toUpperCase(); });
}

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
    case '0':
      return '10';
    case '1/8':
      return '25';
    case '1/4':
      return '50';
    case '1/2':
      return '100';
    case '1':
      return '200';
    case '2':
      return '450';
    case '3':
      return '700';
    case '4':
      return '1,100';
    case '5':
      return '1,800';
    case '6':
      return '2,300';
    case '7':
      return '2,900';
    case '8':
      return '3,900';
    case '9':
      return '5,000';
    case '10':
      return '5,900';
    case '11':
      return '7,200';
    case '12':
      return '8,400';
    case '13':
      return '10,000';
    case '14':
      return '11,500';
    case '15':
      return '13,000';
    case '16':
      return '15,000';
    case '17':
      return '18,000';
    case '18':
      return '20,000';
    case '19':
      return '22,000';
    case '20':
      return '25,000';
    case '21':
      return '33,000';
    case '22':
      return '41,000';
    case '23':
      return '50,000';
    case '24':
      return '62,000';
    case '25':
      return '75,000';
    case '26':
      return '90,000';
    case '27':
      return '105,000';
    case '28':
      return '120,000';
    case '29':
      return '135,000';
    case '30':
      return '155,000';
    default:
      if (parseInt(cr, 10) > 30) {
        return '155,000';
      }
      return '0';
  }
}

// Returns all skills by name with their ability fields and defaults
function getSkills() {
  return [
    {
      name: 'Acrobatics',
      field: 'acrobatics',
      ability: 'dexterity',
    },
    {
      name: 'Animal Handling',
      field: 'animalHandling',
      ability: 'wisdom',
    },
    {
      name: 'Arcana',
      field: 'arcana',
      ability: 'intelligence',
    },
    {
      name: 'Athletics',
      field: 'athletics',
      ability: 'strength',
    },
    {
      name: 'Deception',
      field: 'deception',
      ability: 'charisma',
    },
    {
      name: 'History',
      field: 'history',
      ability: 'intelligence',
    },
    {
      name: 'Insight',
      field: 'insight',
      ability: 'wisdom',
    },
    {
      name: 'Intimidation',
      field: 'intimidation',
      ability: 'charisma',
    },
    {
      name: 'Investigation',
      field: 'investigation',
      ability: 'intelligence',
    },
    {
      name: 'Medicine',
      field: 'medicine',
      ability: 'wisdom',
    },
    {
      name: 'Nature',
      field: 'nature',
      ability: 'intelligence',
    },
    {
      name: 'Perception',
      field: 'perception',
      ability: 'wisdom',
    },
    {
      name: 'Performance',
      field: 'performance',
      ability: 'charisma',
    },
    {
      name: 'Persuasion',
      field: 'persuasion',
      ability: 'charisma',
    },
    {
      name: 'Religion',
      field: 'religion',
      ability: 'intelligence',
    },
    {
      name: 'Sleight of Hand',
      field: 'sleightOfHand',
      ability: 'dexterity',
    },
    {
      name: 'Stealth',
      field: 'stealth',
      ability: 'dexterity',
    },
    {
      name: 'Survival',
      field: 'survival',
      ability: 'wisdom',
    }
  ]
}

// Get the carry and drag/lift/push weights for a creature
function getCarryWeight(strength, size) {
  let carry = 0;
  let dragLiftPush = 0;

  if (size.toLowerCase() === 'tiny') {
    carry = strength * 7.5;
    dragLiftPush = strength * 15;
  }
  else if (size.toLowerCase() === 'small') {
    carry = strength * 15;
    dragLiftPush = strength * 30;
  }
  else if (size.toLowerCase() === 'medium') {
    carry = strength * 15;
    dragLiftPush = strength * 30;
  }
  else if (size.toLowerCase() === 'large') {
    carry = strength * 30;
    dragLiftPush = strength * 60;
  }
  else if (size.toLowerCase() === 'huge') {
    carry = strength * 60;
    dragLiftPush = strength * 120;
  }
  else if (size.toLowerCase() === 'gargantuan') {
    carry = strength * 120;
    dragLiftPush = strength * 240;
  }
  else {
    // Default to Medium
    carry = strength * 15;
    dragLiftPush = strength * 30;
  }

  return {
    carry: carry,
    dragLiftPush: dragLiftPush
  };
}

// On Change of Attributes, Set the Relavant Mods
function setModifier(value, attribute, skillProfOverrides = {}) {
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

  let proficiencyBonus = parseInt(record?.data?.['proficiencyBonus'] || '2', 10);
  if (isNaN(proficiencyBonus)) {
    proficiencyBonus = 0;
  }

  const isProficient = record?.data?.[saveProf] === 'true';
  const savVal = isProficient ? modVal + proficiencyBonus : modVal;
  valuesToSet[`data.${saveField}`] = savVal;

  // Update hit points if this is constitution
  if (attribute === 'constitution') {
    const level = parseInt(record?.data?.level || '0', 10);
    const hpByLevel = record?.data?.hpByLevel || '[]';
    const hpByLevelArr = JSON.parse(hpByLevel);
    const newHp = getHpForLevel(modVal, level, hpByLevelArr);
    if (level > 0 && newHp < 1) {
      // To a minimum of 1
      newHp = 1;
    }
    // Set our HP to be totalHp per level + conMod * level
    valuesToSet['data.hitpoints'] = newHp;
  }

  // Update carry weight if strength
  if (attribute === 'strength') {
    const size = record?.data?.size || 'Medium';
    const { carry, dragLiftPush } = getCarryWeight(val, size);
    valuesToSet['data.maxCarryWeight'] = carry;
    valuesToSet['data.dragLiftPush'] = dragLiftPush;
  }

  // Update AC as needed
  const acCalculationMods = getEffectsAndModifiers(['armorClassCalculation']);
  const dexMod = attribute !== 'dexterity' ? parseInt(record?.data?.dexterityMod || '0', 10) : modVal;
  const bestEquippedArmor = record?.data?.armor || undefined;
  let armorClass = 10 + dexMod;
  if (bestEquippedArmor && bestEquippedArmor.ac > 0) {
    // PC's base class is the best equipped armor if provided
    // Add the dex bonus to the ac, using max dex as the max.
    // If maxDex is not set, we assume it is 0
    armorClass = bestEquippedArmor.ac + (bestEquippedArmor.maxDex ? Math.min(dexMod, bestEquippedArmor.maxDex) : 0);
  }
  let calcBonus = 0;
  // Only add acCalculationMods if we are unarmored
  if (bestEquippedArmor?.ac === 0 || !bestEquippedArmor) {
    acCalculationMods.forEach(mod => {
      // We only benefit from the highest AC calculation modifier
      if (mod.field && mod.field !== 'dexterity') {
        const acBonus = attribute !== mod.field ? parseInt(record?.data?.[`${mod.field}Mod`] || '0', 10) : modVal;
        if (acBonus > calcBonus) {
          calcBonus = acBonus;
        }
      }
    });
  }
  // Get general AC bonuses
  const acBonuses = getEffectsAndModifiers(['armorClassBonus']);
  acBonuses.forEach(mod => {
    if (mod.value) {
      const acBonus = parseInt(mod.value || '0', 10);
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
  valuesToSet['data.ac'] = armorClass;

  getSkills().forEach(skill => {
    // Get the ability being used for this skill, fallback to the skill's default
    const ability = record?.data?.[`${skill.field}Ability`] || skill.ability;

    if (ability === attribute) {
      // Skills can be also be half, proficient, or expertise
      const proficiency = skillProfOverrides[`data.${skill.field}Prof`] || record?.data?.[`${skill.field}Prof`] || 'false';
      const isHalfProficient = proficiency === 'half';
      const isExpertise = proficiency === 'expertise';
      const isProficient = proficiency === 'true';
      if (isHalfProficient) {
        valuesToSet[`data.${skill.field}Mod`] = modVal + (Math.floor(proficiencyBonus / 2));
      }
      else if (isExpertise) {
        valuesToSet[`data.${skill.field}Mod`] = modVal + (proficiencyBonus * 2);
      }
      else if (isProficient) {
        valuesToSet[`data.${skill.field}Mod`] = modVal + proficiencyBonus;
      }
      else {
        valuesToSet[`data.${skill.field}Mod`] = modVal;
      }
    }
  });

  // Also update otherSkills
  const otherSkills = record?.data?.otherSkills || [];
  otherSkills.forEach((skill, index) => {
    if (skill?.data?.ability === attribute) {
      // Skills can be also be half, proficient, or expertise
      const proficiency = skill?.data?.skillProf || 'false';
      const isHalfProficient = proficiency === 'half';
      const isExpertise = proficiency === 'expertise';
      const isProficient = proficiency === 'true';
      if (isHalfProficient) {
        valuesToSet[`data.otherSkills.${index}.data.skillMod`] = modVal + (Math.floor(proficiencyBonus / 2));
      }
      else if (isExpertise) {
        valuesToSet[`data.otherSkills.${index}.data.skillMod`] = modVal + (proficiencyBonus * 2);
      }
      else if (isProficient) {
        valuesToSet[`data.otherSkills.${index}.data.skillMod`] = modVal + proficiencyBonus;
      }
      else {
        valuesToSet[`data.otherSkills.${index}.data.skillMod`] = modVal;
      }
    }
  });

  api.setValues(valuesToSet);
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
    case '+':
      return value + number;
    case '-':
      return value - number;
    case '*':
      return value * number;
    case '/':
      return Math.floor(value / number); // Always round down
    default:
      return value;
  }
}

function getDamageType(rollString) {
  const regex = /(?:\d*d\d+|\+\d+)?(?:\s*\+?-?\s*\d+)?(?:\s+(\w+))?/;
  const match = rollString.match(regex);
  return match && match[1] ? match[1] : "untyped";
}

// Doubles the dice in the damage string
function doubleDamageDice(damage) {
  if (damage && typeof damage === 'string' && damage.includes('d')) {
    return damage.replace(/(\d+)?d(\d+)/g, (match, n, d) => {
      n = n ? parseInt(n) * 2 : 2; // If n is undefined, it means 1d, so we use 2
      return `${n}d${d}`;
    });
  }
  return damage;
}

// Checks for replacements in a string modifier
function checkForReplacements(value) {
  // Case for 'Half <class> Level'
  const matchLevel = value.match(/[Hh]alf (\w+) [Ll]evel/);
  if (matchLevel) {
    const className = matchLevel[1];
    const characterClassLevel = (record?.data?.classLevels || '').match(`${className} (\\d+)`)?.[1] || 0;
    if (characterClassLevel) {
      value = value.replace(matchLevel[0], Math.floor(parseInt(characterClassLevel, 10) / 2));
    }
  }
  // Case for 'Proficiency Bonus'
  const matchProficiencyBonus = value.match(/[Pp]roficiency [Bb]onus/);
  if (matchProficiencyBonus) {
    value = value.replace(matchProficiencyBonus[0], record?.data?.proficiencyBonus || 0);
  }
  return value;
}

// Collects all effects and modifiers for the record (assuming this is
// called in the context of a record.)
// If types is provided, it will only return effects of those types
// If field is provided, it will only return effects that match that field
function getEffectsAndModifiers(types = [], field = '', itemId = undefined) {
  let results = [];

  // First collect modifiers from effects
  const effects = record?.effects || [];
  effects.forEach((effect) => {
    const rules = effect.rules || [];
    rules.forEach((rule) => {
      const ruleType = rule?.type || '';
      const isPenalty = ruleType.toLowerCase().includes('penalty');
      let value = rule.value || '';
      if (rule.valueType === 'number') {
        value = parseInt(rule.value, 10);
        if (isNaN(value)) {
          value = 0;
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
      }
      else if (rule.valueType === 'string' && !value.trim().startsWith('-') && isPenalty && !value.includes('disadvantage')) {
        value = '-' + value;
      }
      // Check for strings that require replacements
      if (rule.valueType === 'string') {
        value = checkForReplacements(value);
      }
      if (value !== 0 && (rule.valueType === 'number' || rule.valueType === 'string')) {
        results.push({
          name: effect.name || 'Effect',
          value: value,
          active: true,
          modifierType: ruleType,
          field: rule?.field || '',
          valueType: rule.valueType,
          isPenalty: isPenalty
        });
      }
      else if (rule.valueType === 'api') {
        let value = parseInt(record?.effectValues?.[effect?._id] || '0', 10);
        if (isPenalty && value > 0) {
          value = -value;
        }
        if (value !== 0) {
          results.push({
            name: effect.name || 'Effect',
            value: value,
            active: true,
            modifierType: ruleType,
            field: rule?.field || '',
            valueType: rule.valueType,
            isPenalty: isPenalty
          });
        }
      }
      else if (rule.valueType === 'stack') {
        // The value is the number of times they have this effect
        let value = record?.effectIds?.filter(id => id === effect?._id).length;
        if (isPenalty && value > 0) {
          value = -value;
        }
        // Check if there is addtional math to apply to it
        const math = rule?.value || '';
        if (math) {
          value = applyMath(value, math);
        }
        if (value !== 0) {
          results.push({
            name: effect.name || 'Effect',
            value: value,
            active: true,
            modifierType: ruleType,
            field: rule?.field || '',
            valueType: rule.valueType,
            isPenalty: isPenalty
          });
        }
      }
    });
  });

  // Now collect all modifiers from Features and Items
  const features = record?.data?.features || [];
  const items = record?.data?.inventory || [];
  // Filter items that are not equipped or that require attunement and not attuned
  const equippedItems = items.filter(item => item.data?.carried === 'equipped'
    && (!item.data?.attunement || item.data?.attuned === 'true'));
  [...features, ...equippedItems].forEach((feature) => {
    const modifiers = feature.data?.modifiers || [];
    modifiers.forEach((modifier) => {
      const ruleType = modifier.data?.type || '';
      const isPenalty = ruleType.toLowerCase().includes('penalty');
      let value = modifier.data?.value || '';
      if (modifier.data?.valueType === 'number') {
        value = parseInt(modifier.data?.value, 10);
        if (isNaN(value)) {
          value = 0;
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
      }
      else if (modifier.data?.valueType === 'field') {
        const fieldToUse = modifier.data?.value || '';
        if (fieldToUse) {
          value = record?.data?.[fieldToUse] || '';
        }
      }
      else if (modifier.data?.valueType === 'string' && !value.trim().startsWith('-') && isPenalty) {
        value = '-' + value;
      }

      // Check for strings that require replacements
      if (modifier.data?.valueType === 'string') {
        value = checkForReplacements(value);
      }

      // Only relevant if it has a value
      if (value !== 0) {
        // Check if this only applies to equipped item and mark it with ID if so 
        const itemOnly = modifier.data?.itemOnly || false;
        results.push({
          name: feature?.name || 'Feature',
          value: value,
          active: modifier.data?.active === true,
          modifierType: ruleType,
          field: modifier.data?.field || '',
          valueType: modifier.data?.valueType,
          itemId: itemOnly ? feature?._id : undefined,
          isPenalty: isPenalty
        });
      }
    });
  });

  // Special case for armor, if this is a stealth check
  if (field === 'stealth') {
    const bestEquippedArmor = record?.data?.armor || undefined;
    if (bestEquippedArmor?.stealthPenalty) {
      results.push({
        name: 'Disadvantage due to Armor',
        value: 'disadvantage',
        active: true,
        modifierType: 'skillPenalty',
        isPenalty: true,
        field: 'stealth'
      });
    }
  }

  if (types && types.length > 0) {
    results = results.filter(r => types.includes(r.modifierType));
  }

  if (field && field !== '') {
    results = results.filter(r => r.field === field || r.field === 'all' || !r.field);
  }

  // Filter by itemId if provided
  results = results.filter(r => r.itemId === itemId || r.itemId === undefined);

  return results;
}

// Same as getEffectsAndModifiers but for a token that is passed
function getEffectsAndModifiersForToken(target, types = [], field = '', itemId = undefined) {
  if (!target) {
    return [];
  }
  let results = [];

  // First collect modifiers from effects
  const effects = target?.effects || [];
  effects.forEach((effect) => {
    const rules = effect.rules || [];
    rules.forEach((rule) => {
      const ruleType = rule?.type || '';
      const isPenalty = ruleType.toLowerCase().includes('penalty');
      let value = rule.value || '';
      if (rule.valueType === 'number') {
        value = parseInt(rule.value, 10);
        if (isNaN(value)) {
          value = 0;
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
      }
      else if (rule.valueType === 'string' && !value.trim().startsWith('-') && isPenalty && !value.includes('disadvantage')) {
        value = '-' + value;
      }
      // Check for strings that require replacements
      if (rule.valueType === 'string') {
        value = checkForReplacements(value);
      }
      if (value !== 0 && (rule.valueType === 'number' || rule.valueType === 'string')) {
        results.push({
          name: effect.name || 'Effect',
          value: value,
          active: true,
          modifierType: ruleType,
          field: rule?.field || '',
          valueType: rule.valueType,
          isPenalty: isPenalty
        });
      }
      else if (rule.valueType === 'api') {
        let value = parseInt(target?.effectValues?.[effect?._id] || '0', 10);
        if (isPenalty && value > 0) {
          value = -value;
        }
        if (value !== 0) {
          results.push({
            name: effect.name || 'Effect',
            value: value,
            active: true,
            modifierType: ruleType,
            field: rule?.field || '',
            valueType: rule.valueType,
            isPenalty: isPenalty
          });
        }
      }
      else if (rule.valueType === 'stack') {
        // The value is the number of times they have this effect
        let value = target?.effectIds?.filter(id => id === effect?._id).length;
        if (isPenalty && value > 0) {
          value = -value;
        }
        // Check if there is addtional math to apply to it
        const math = rule?.value || '';
        if (math) {
          value = applyMath(value, math);
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
        if (value !== 0) {
          results.push({
            name: effect.name || 'Effect',
            value: value,
            active: true,
            modifierType: ruleType,
            field: rule?.field || '',
            valueType: rule.valueType,
            isPenalty: isPenalty
          });
        }
      }
    });
  });

  // Now collect all modifiers from Features and Items
  const features = target?.data?.features || [];
  const items = target?.data?.inventory || [];
  // Filter items that are not equipped or that require attunement and not attuned
  const equippedItems = items.filter(item => item.data?.carried === 'equipped'
    && (!item.data?.attunement || item.data?.attuned === 'true'));
  [...features, ...equippedItems].forEach((feature) => {
    const modifiers = feature.data?.modifiers || [];
    modifiers.forEach((modifier) => {
      const ruleType = modifier.data?.type || '';
      const isPenalty = ruleType.toLowerCase().includes('penalty');
      let value = modifier.data?.value || '';
      if (modifier.data?.valueType === 'number') {
        value = parseInt(modifier.data?.value, 10);
        if (isNaN(value)) {
          value = 0;
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
      }
      else if (modifier.data?.valueType === 'field') {
        const fieldToUse = modifier.data?.value || '';
        if (fieldToUse) {
          value = target?.data?.[fieldToUse] || '';
        }
      }
      else if (modifier.data?.valueType === 'string' && !value.trim().startsWith('-') && isPenalty) {
        value = '-' + value;
      }

      // Check for strings that require replacements
      if (modifier.data?.valueType === 'string') {
        value = checkForReplacements(value);
      }

      // Only relevant if it has a value
      if (value !== 0) {
        // Check if this only applies to equipped item and mark it with ID if so 
        const itemOnly = modifier.data?.itemOnly || false;
        results.push({
          name: feature?.name || 'Feature',
          value: value,
          active: modifier.data?.active === true,
          modifierType: ruleType,
          field: modifier.data?.field || '',
          valueType: modifier.data?.valueType,
          itemId: itemOnly ? feature?._id : undefined,
          isPenalty: isPenalty
        });
      }
    });
  });

  // Special case for armor, if this is a stealth check
  if (field === 'stealth') {
    const bestEquippedArmor = target?.data?.armor || undefined;
    if (bestEquippedArmor?.stealthPenalty) {
      results.push({
        name: 'Disadvantage due to Armor',
        value: 'disadvantage',
        active: true,
        modifierType: 'skillPenalty',
        isPenalty: true,
        field: 'stealth'
      });
    }
  }

  if (types && types.length > 0) {
    results = results.filter(r => types.includes(r.modifierType));
  }

  if (field && field !== '') {
    results = results.filter(r => r.field === field || r.field === 'all' || !r.field);
  }

  // Filter by itemId if provided
  results = results.filter(r => r.itemId === itemId || r.itemId === undefined);

  return results;
}

function getArmorClassForToken(token) {
  const record = token?.record;
  const acCalculationMods = getEffectsAndModifiersForToken(token, ['armorClassCalculation']);

  // If this is a character, we use their dexterity modifier
  const dexMod = parseInt(record?.data?.dexterityMod || '0', 10);
  const bestEquippedArmor = record?.data?.armor || undefined;
  let armorClass = 10 + dexMod;
  // Else, we use the armor class value (for tokens)
  if (record?.recordType === 'npcs') {
    armorClass = parseInt(token?.data?.ac || '0', 10);
  }
  else if (bestEquippedArmor && bestEquippedArmor.ac > 0) {
    // PC's base class is the best equipped armor if provided
    // Add the dex bonus to the ac, using max dex as the max.
    // If maxDex is not set, we assume it is 0
    armorClass = bestEquippedArmor.ac + (bestEquippedArmor.maxDex ? Math.min(dexMod, bestEquippedArmor.maxDex) : 0);
  }

  let calcBonus = 0;
  // Only add acCalculationMods if we are unarmored
  if (bestEquippedArmor?.ac === 0 || !bestEquippedArmor) {
    acCalculationMods.forEach(mod => {
      // We only benefit from the highest AC calculation modifier
      if (mod.field && mod.field !== 'dexterity') {
        const acBonus = parseInt(record?.data?.[`${mod.field}Mod`] || '0', 10);
        if (acBonus > calcBonus) {
          calcBonus = acBonus;
        }
      }
    });
  }
  // Get general AC bonuses
  const acBonuses = getEffectsAndModifiersForToken(token, ['armorClassBonus', 'armorClassPenalty']);
  acBonuses.forEach(mod => {
    if (mod.value) {
      const acBonus = parseInt(mod.value || '0', 10);
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
  return armorClass;
}

function getArmorClass(bestEquippedArmor) {
  const acCalculationMods = getEffectsAndModifiers(['armorClassCalculation']);

  // If this is a character, we use their dexterity modifier
  const dexMod = parseInt(record?.data?.dexterityMod || '0', 10);
  let armorClass = 10 + dexMod;
  // Else, we use the armor class value
  if (record?.recordType === 'npcs') {
    armorClass = parseInt(record?.data?.ac || '0', 10);
  }
  else if (bestEquippedArmor && bestEquippedArmor.ac > 0) {
    // PC's base class is the best equipped armor if provided
    // Add the dex bonus to the ac, using max dex as the max.
    // If maxDex is not set, we assume it is 0
    armorClass = bestEquippedArmor.ac + (bestEquippedArmor.maxDex ? Math.min(dexMod, bestEquippedArmor.maxDex) : 0);
  }

  let calcBonus = 0;
  // Only add acCalculationMods if we are unarmored
  if (bestEquippedArmor?.ac === 0 || !bestEquippedArmor) {
    acCalculationMods.forEach(mod => {
      // We only benefit from the highest AC calculation modifier
      if (mod.field && mod.field !== 'dexterity') {
        const acBonus = parseInt(record?.data?.[`${mod.field}Mod`] || '0', 10);
        if (acBonus > calcBonus) {
          calcBonus = acBonus;
        }
      }
    });
  }
  // Get general AC bonuses
  const acBonuses = getEffectsAndModifiers(['armorClassBonus', 'armorClassPenalty']);
  acBonuses.forEach(mod => {
    if (mod.value) {
      const acBonus = parseInt(mod.value || '0', 10);
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
  items.forEach(item => {
    if (item.data?.carried === 'equipped' && item.data?.type === 'armor') {
      const ac = item?.data?.armorClass || 0;
      const maxDex = item?.data?.addDex ? item?.data?.maxDex || 0 : 0;
      if (ac > bestEquippedArmor.ac) {
        bestEquippedArmor.ac = ac;
        bestEquippedArmor.maxDex = maxDex;
        bestEquippedArmor.stealthPenalty = item?.data?.stealth === 'disadvantage';
      }
    }
    else if (item.data?.carried === 'equipped' && item.data?.type === 'shield') {
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
  const resistString = (target.data?.resistances || '').toLowerCase();
  const immuneString = (target.data?.immunities || '').toLowerCase();
  const vulnString = (target.data?.vulnerabilities || '').toLowerCase();

  // Use regular expressions to match specific patterns
  const resistances = [];
  const immunities = [];
  const vulnerabilities = [];

  const patterns = [
    { type: 'resistance', regex: /bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered/i, values: ['bludgeoning', 'piercing', 'slashing'] },
    { type: 'resistance', regex: /bludgeoning, piercing, and slashing from nonmagical attacks/i, values: ['bludgeoning', 'piercing', 'slashing', 'silvered-bludgeoning', 'silvered-piercing', 'silvered-slashing'] },
    { type: 'resistance', regex: /bludgeoning, piercing, and slashing/i, values: ['bludgeoning', 'piercing', 'slashing', 'magical-bludgeoning', 'magical-piercing', 'magical-slashing', 'silvered-bludgeoning', 'silvered-piercing', 'silvered-slashing'] },
    { type: 'immunity', regex: /bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered/i, values: ['bludgeoning', 'piercing', 'slashing'] },
    { type: 'immunity', regex: /bludgeoning, piercing, and slashing from nonmagical attacks/i, values: ['bludgeoning', 'piercing', 'slashing', 'silvered-bludgeoning', 'silvered-piercing', 'silvered-slashing'] },
    { type: 'immunity', regex: /bludgeoning, piercing, and slashing/i, values: ['bludgeoning', 'piercing', 'slashing', 'magical-bludgeoning', 'magical-piercing', 'magical-slashing', 'silvered-bludgeoning', 'silvered-piercing', 'silvered-slashing'] },
    { type: 'vulnerability', regex: /bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered/i, values: ['bludgeoning', 'piercing', 'slashing'] },
    { type: 'vulnerability', regex: /bludgeoning, piercing, and slashing from nonmagical attacks/i, values: ['bludgeoning', 'piercing', 'slashing', 'silvered-bludgeoning', 'silvered-piercing', 'silvered-slashing'] },
    { type: 'vulnerability', regex: /bludgeoning, piercing, and slashing/i, values: ['bludgeoning', 'piercing', 'slashing', 'magical-bludgeoning', 'magical-piercing', 'magical-slashing', 'silvered-bludgeoning', 'silvered-piercing', 'silvered-slashing'] }
  ];

  // Function to extract and remove matched patterns
  function extractPatterns(string, type) {
    patterns.forEach(pattern => {
      if (pattern.type === type && pattern.regex.test(string)) {
        if (type === 'resistance') resistances.push(...pattern.values);
        if (type === 'immunity') immunities.push(...pattern.values);
        if (type === 'vulnerability') vulnerabilities.push(...pattern.values);
        string = string.replace(pattern.regex, ''); // Remove matched pattern
      }
    });
    return string;
  }

  // Extract complex patterns and remove them from the string
  let remainingResistString = extractPatterns(resistString, 'resistance');
  let remainingImmuneString = extractPatterns(immuneString, 'immunity');
  let remainingVulnString = extractPatterns(vulnString, 'vulnerability');

  // Split remaining strings by commas to capture additional values
  resistances.push(...remainingResistString.split(',').map(r => r.toLowerCase().trim()).filter(r => r));
  immunities.push(...remainingImmuneString.split(',').map(i => i.toLowerCase().trim()).filter(i => i));
  vulnerabilities.push(...remainingVulnString.split(',').map(v => v.toLowerCase().trim()).filter(v => v));

  // Then add RIV from modifiers
  const modifiers = getEffectsAndModifiersForToken(target, ['resistance', 'vulnerability', 'immunity']);
  modifiers.forEach(mod => {
    if (mod.modifierType === 'resistance') {
      resistances.push(mod.value);
    }
    else if (mod.modifierType === 'vulnerability') {
      vulnerabilities.push(mod.value);
    }
    else if (mod.modifierType === 'immunity') {
      immunities.push(mod.value);
    }
  });

  return {
    resistances,
    immunities,
    vulnerabilities
  };
}

// If the target is currently dying (0 hp) we add a death save failure
// We add two if it it was from a critical hit
// If they are then at 3, we add the 'Dead' effect
function applyDeathFailures(target, isCritical) {
  if (target.data?.curhp <= 0) {

    let failures = parseInt(target.data.deathSaveFailures || '0', 10);
    if (isCritical) {
      failures += 2;
    }
    else {
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
