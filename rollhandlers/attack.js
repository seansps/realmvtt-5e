// Script to get all modifier and effects affecting the target
const getEffectsAndModifiers = `
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
  const features = target?.record?.data?.features || [];
  const items = target?.record?.data?.inventory || [];
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
          value = target?.record?.data?.[fieldToUse] || '';
        }
      }
      else if (modifier.data?.valueType === 'string' && !value.trim().startsWith('-') && isPenalty) {
        value = '-' + value;
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
`;

// Script to get the Resistance, Immunity, and Vulnerability of a target
const getRIVScript = `
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
`;

// If the target is currently dying (0 hp) we add a death save failure
// We add two if it it was from a critical hit
// If they are then at 3, we add the 'Dead' effect
const applyDeathFailures = (isCritical) => `
function applyDeathFailures(target) {
  if (target.data?.curhp <= 0) {

    let failures = parseInt(target.data.deathSaveFailures || '0', 10);
    if (${isCritical}) {
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
`;

function getGrazeMacro(abilityMod) {
  return `
\`\`\`Apply_Graze_Damage
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

// Add get effects and modifiers script
${getEffectsAndModifiers}

// Add RIV script
${getRIVScript}

// Add death save failure script
${applyDeathFailures(false)}

targets.forEach(target => {
  // Apply damage
  if (target && target.data) {
    let damage = 0;

    const RIV = getRIV(target);

    // First, just get the total of all damage for each type
    const damageByType = {};
    const damageType = '${abilityMod.type}' || 'untyped';
    damageByType[damageType] = (damageByType[damageType] || 0) + ${abilityMod.value};

    // We need to go through each damage type and check if the target has resistance, immunity, or vulnerability to it.
    Object.keys(damageByType).forEach(type => {
      let thisDamage = damageByType[type];
      if (RIV.resistances.includes(type.toLowerCase() || '')) {
        thisDamage = Math.floor(thisDamage * 0.5);
      }
      if (RIV.immunities.includes(type.toLowerCase() || '')) {
        thisDamage = 0;
      }
      if (RIV.vulnerabilities.includes(type.toLowerCase() || '')) {
        thisDamage = Math.floor(thisDamage * 2);
      }
      damage += thisDamage;
    });

    // Finally, we cannot deal negative damage
    if (damage < 0) {
      damage = 0;
    }

    // First deduct from Temp HP
    const oldTempHp = parseInt(target.data?.tempHp || '0', 10);
    const newTempHp = Math.max(oldTempHp - damage, 0);
    damage = Math.max(damage - oldTempHp, 0);
    let usedTempHp = false;
    if (newTempHp !== oldTempHp) {
      api.setValueOnToken(target, "data.tempHp", newTempHp);
      usedTempHp = true;
    }

    // Then deduct from Current HP
    var curhp = target.data?.curhp || 0;
    curhp -= damage;
    if (curhp < 0) { curhp = 0; }
    if (curhp > target.data?.hitpoints) { curhp = target.data?.hitpoints; }
    const oldHp = (target.data?.curhp || 0);
    api.setValueOnToken(target, "data.curhp", curhp);
    
    const unIdentified = target.identified === false;
    const targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;

    let message = \`\$\{targetName\} took \$\{damage\} damage.\`;
    if (usedTempHp) {
      message = \`\$\{targetName\} took \$\{damage\} damage after deducting Temp HP.\`;
    }

    // If damage was done, we apply death failures if necessary
    if (damage > 0) {
      applyDeathFailures(target);
    }

    // Check for Concentration effect, and add a button to Roll Concentration Check
    let concentrationMacro = '';
    const effects = target.effects || [];
    const concentration = effects.find(effect => effect.name === 'Concentration');
    let oldSpellName = '';
    if (concentration && damage > 0 && curhp > 0) {
      // DC is half the damage done rounded down or 10, whichever is higher, to a max of 30      
      concentrationMacro = \`\\\`\\\`\\\`Concentration_Check\\n const tokens = api.getSelectedOrDroppedToken(); tokens.forEach(token => { const metadata = { dc: Math.min(Math.max(Math.floor(\$\{damage\} / 2), 10), 30), rollName: 'Constitution Save', tooltip: 'Constitution Saving Throw' }; const conMod = parseInt(token?.record?.data?.constitutionMod || '0', 10); const modifiers = conMod > 0 ? [{ name: 'Constitution Save Modifier', tooltip: 'Constitution Saving Throw', value: conMod, active: true }] : []; api.promptRollForToken(token, 'Constitution Save', '1d20', modifiers, metadata, 'concentration'); }); \\n\\\`\\\`\\\`\`;
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

    const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.tempHp', '\$\{oldTempHp\}'); api.editMessage(null, '~\$\{message\}~'); } else { api.showNotification('Only the GM can undo damage.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;

    if (oldSpellName) {
      message += \`\nLost concentration on \$\{oldSpellName\}.\`;
    }

    api.sendMessage(\`\$\{message\}\\n\$\{macro\}\\n\$\{concentrationMacro\}\`, undefined, undefined, undefined, target);
  }
});
\`\`\`
`;
}

// Get metadata for a given mastery property
// Some have effects to apply, some are just tags
const getMasteryProperties = (masterProperty, damageModifiers) => {
  // For Graze, determine the ability mod of the attack roll
  const abilityMod = damageModifiers.find(dm => ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].includes(dm.name.toLowerCase().trim()));

  switch (masterProperty) {
    case 'Cleave': return {
      name: 'Cleave',
      description: "If you hit a creature with a melee attack roll using this weapon, you can make a melee attack roll with the weapon against a second creature within 5 feet of the first that is also within your reach. On a hit, the second creature takes the weapon's damage, but don't add your ability modifier to that damage unless that modifier is negative. You can make this extra attack only once per turn.",
      effect: null,
      macro: null,
    };
    case 'Graze': return {
      name: 'Graze',
      description: "If your attack roll with this weapon misses a creature, you can deal damage to that creature equal to the ability modifier you used to make the attack roll. This damage is the same type dealt by the weapon, and the damage can be increased only by increasing the ability modifier.",
      // Here we make a macro to apply damage equal the the ability mod 
      effect: null,
      macro: getGrazeMacro(abilityMod)
    };
    case 'Nick': return {
      name: 'Nick',
      description: 'When you make the extra attack of the Light property, you can make it as part of the Attack action instead of as a Bonus Action. You can make this extra attack only once per turn.',
      effect: null,
      macro: null,
    };
    case 'Push': return {
      name: 'Push',
      description: 'If you hit a creature with this weapon, you can push the creature up to 10 feet straight away from yourself if it is Large or smaller.',
      effect: null,
      macro: null,
    };
    case 'Sap': return {
      name: 'Sap',
      description: 'If you hit a creature with this weapon, that creature has Disadvantage on its next attack roll before the start of your next turn.',
      effect: null,
      macro: null,
    };
    case 'Slow': return {
      name: 'Slow',
      description: '',
      effect: null,
      macro: null,
    };
    case 'Topple': return {
      name: 'Topple',
      description: '',
      effect: null,
      macro: null,
    };
    case 'Vex': return {
      name: 'Vex',
      description: '',
      effect: null,
      macro: null,
    };
    default: return null;
  }
}

function getWeaponMasteryMetadata(weaponMasteries, damageModifiers) {
  let results = [];
  console.log('weaponMasteries', weaponMasteries);

  weaponMasteries.forEach(wm => {
    console.log('wm', wm);
    const mastery = getWeaponMastery(wm, damageModifiers);
    if (mastery) {
      results.push(mastery);
    }
  });

  return results;
}

function doubleDamageDice(damage) {
  return damage.replace(/(\d+)?d(\d+)/g, (match, n, d) => {
    n = n ? parseInt(n) * 2 : 2; // If n is undefined, it means 1d, so we use 2
    return `${n}d${d}`;
  });
}

// Here we need to determine if it was a hit or miss and display in the chat.
const rollName = data?.roll?.metadata?.rollName;
const attack = data?.roll?.metadata?.attack;
const targetName = data?.roll?.metadata?.targetName;
const tooltip = data?.roll?.metadata?.tooltip;
const damageModifiers = data?.roll?.metadata?.damageModifiers || [];
const icon = data?.roll?.metadata?.icon;
const masteryProperties = data?.roll?.metadata?.masteryProperties || [];
let damage = data?.roll?.metadata?.damage;

// If the d20 was a 20, it's a critical hit
const d20 = (data?.roll?.dice || []).find(d => d.type === 20 && d.reason !== 'dropped');
const isCritical = d20 && d20.value === 20;
// If the d20 was a 1, it's a miss
const isMiss = d20 && d20.value === 1;

let message = '';

let dc = 0;
dc = parseInt(data?.roll?.metadata?.dc || '0', 10);
if (isNaN(dc)) {
  dc = 0;
}

const total = data?.roll?.total || 0;
if (isCritical) {
  message = `[center]${icon ? `:${icon}:` : ''} ${attack} ${targetName ? ` :IconTargetArrow: ${targetName}` : ''}[/center]\n\n**[center][color=green]CRITICAL HIT[/color] [gm]${dc > 0 ? `(vs AC ${dc})` : ''}[/gm][/center]**
`
  // If damage was defined, we need to double the dice 
  if (damage) {
    damage = doubleDamageDice(damage);
  }
}
else if (isMiss) {
  message = `[center]${icon ? `:${icon}:` : ''} ${attack} ${targetName ? ` :IconTargetArrow: ${targetName}` : ''}[/center]\n\n**[center][color=red]AUTOMATIC MISS[/color] [gm]${dc > 0 ? `(vs AC ${dc})` : ''}[/gm][/center]**`
}
else if (total >= dc && dc > 0) {
  message = `[center]${icon ? `:${icon}:` : ''} ${attack} ${targetName ? ` :IconTargetArrow: ${targetName}` : ''}[/center]\n\n**[center][color=green]HIT[/color] [gm](vs AC ${dc})[/gm][/center]**`
}
else if (dc > 0) {
  message = `[center]${icon ? `:${icon}:` : ''} ${attack} ${targetName ? ` :IconTargetArrow: ${targetName}` : ''}[/center]\n\n**[center][color=red]MISS[/color] [gm](vs AC ${dc})[/gm][/center]**`
}
else {
  message = `[center]${icon ? `:${icon}:` : ''} ${attack} ${targetName ? ` :IconTargetArrow: ${targetName}` : ''}[/center]`
}

const tags = [{
  name: rollName || "Attack",
  tooltip: tooltip || "Attack Roll"
}];

const damageMetadata = {
  // This is so that our damage handler script can tell if it was from a critical hit
  "critical": isCritical,
}

// Add damage button to message
const damageButton = damage ? `\`\`\`Roll_Damage
api.promptRoll('${attack} Damage', '${damage}', ${JSON.stringify(damageModifiers)}, ${JSON.stringify(damageMetadata)}, 'damage')
\`\`\`` : '';

// Get weapon masteries
masteryProperties.forEach(mp => {
  const masteryPropertyMetadata = getMasteryProperties(mp, damageModifiers);
  tags.push({
    name: masteryPropertyMetadata.name,
    tooltip: masteryPropertyMetadata.description
  });
});

// Get weapon master macros
const macros = masteryProperties.map(mp => {
  const masteryPropertyMetadata = getMasteryProperties(mp, damageModifiers);
  return masteryPropertyMetadata?.macro;
}).filter(macro => macro).join('\n');

message = `
${message}

${damageButton}
${macros}
`;

api.sendMessage(message, data.roll, [], tags);