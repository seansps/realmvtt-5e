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
      applyDeathFailures(target, false);
    }

    // Check for Concentration effect, and add a button to Roll Concentration Check
    let concentrationMacro = '';
    const effects = target.effects || [];
    const concentration = effects.find(effect => effect.name === 'Concentration');
    let oldSpellName = '';
    if (concentration && damage > 0 && curhp > 0) {
      // DC is half the damage done rounded down or 10, whichever is higher, to a max of 30      
      concentrationMacro = \`\\\`\\\`\\\`Concentration_Check\\n const tokens = api.getSelectedOrDroppedToken(); tokens.forEach(token => { const metadata = { dc: Math.min(Math.max(Math.floor(\$\{damage\} / 2), 10), 30), rollName: 'Constitution Save', tooltip: 'Constitution Saving Throw' }; const conMod = parseInt(token?.data?.constitutionMod !== undefined ? token?.data?.constitutionMod : '0', 10); const modifiers = conMod !== 0 ? [{ name: 'Constitution Save Modifier', tooltip: 'Constitution Saving Throw', value: conMod, active: true }] : []; api.promptRollForToken(token, 'Constitution Save', '1d20', modifiers, metadata, 'concentration'); }); \\n\\\`\\\`\\\`\`;
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

function getToppleMacro(abilityMod, proficiencyBonus) {
  const dc = 8 + abilityMod.value + proficiencyBonus;
  const savingThrow = 'constitution';
  return `
\`\`\`Roll_Constitution_Save
const selectedTokens = api.getSelectedOrDroppedToken();
selectedTokens.forEach(token => {
  const saveModifiers = [];
  const modifier = token?.data?.['${savingThrow}Save'] || 0;
  saveModifiers.push({
    name: '${capitalize(savingThrow)} Save',
    value: modifier,
    active: true,
  });

  const saveMods = getEffectsAndModifiersForToken(token, ['saveBonus', 'savePenalty'], '${savingThrow}');
  saveMods.forEach(mod => {
    saveModifiers.push(mod);
  });

  const metadata = {
    "rollName": '${capitalize(savingThrow)} Save',
    "tooltip": '${capitalize(savingThrow)} Saving Throw',
    "dc": ${dc}
  }

  api.promptRollForToken(token, '${capitalize(savingThrow)} Save', '1d20', saveModifiers, metadata, 'save');
});
  \`\`\`
`;
}

// Get metadata for a given mastery property
// Some have effects to apply, some are just tags
const getMasteryProperties = (masterProperty, damageModifiers, proficiencyBonus) => {
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
      effect: 'Sap',
      macro: null,
    };
    case 'Slow': return {
      name: 'Slow',
      description: "If you hit a creature with this weapon and deal damage to it, you can reduce its Speed by 10 feet until the start of your next turn. If the creature is hit more than once by weapons that have this property, the Speed reduction doesn't exceed 10 feet.",
      effect: "Slow",
      macro: null,
    };
    case 'Topple': return {
      name: 'Topple',
      description: 'If you hit a creature with this weapon, you can force the creature to make a Constitution saving throw (DC 8 plus the ability modifier used to make the attack roll and your Proficiency Bonus). On a failed save, the creature has the Prone condition.',
      effect: "Prone",
      macro: getToppleMacro(abilityMod, proficiencyBonus),
    };
    case 'Vex': return {
      name: 'Vex',
      description: 'If you hit a creature with this weapon and deal damage to the creature, you have Advantage on your next attack roll against that creature before the end of your next turn.',
      effect: null,
      macro: null,
    };
    default: return null;
  }
}

function getWeaponMasteryMetadata(weaponMasteries, damageModifiers) {
  let results = [];

  weaponMasteries.forEach(wm => {
    const mastery = getWeaponMastery(wm, damageModifiers);
    if (mastery) {
      results.push(mastery);
    }
  });

  return results;
}

// Here we need to determine if it was a hit or miss and display in the chat.
const rollName = data?.roll?.metadata?.rollName;
const attack = data?.roll?.metadata?.attack;
const targetName = data?.roll?.metadata?.targetName;
const tooltip = data?.roll?.metadata?.tooltip;
let damageModifiers = data?.roll?.metadata?.damageModifiers || [];
const icon = data?.roll?.metadata?.icon;
const masteryProperties = data?.roll?.metadata?.masteryProperties || [];
const proficiencyBonus = data?.roll?.metadata?.attackerProficiencyBonus || 2;
let damage = data?.roll?.metadata?.damage;
// This means it's automatically a critical hit, if it was a hit
let autoCritical = data?.roll?.metadata?.autoCritical;

// If the d20 was a 20, it's a critical hit
const d20 = (data?.roll?.dice || []).find(d => d.type === 20 && d.reason !== 'dropped');
let isCritical = d20 && d20.value === 20;
// If the d20 was a 1, it's a miss
const isMiss = d20 && d20.value === 1;

let message = '';

let dc = 0;
dc = parseInt(data?.roll?.metadata?.dc || '0', 10);
if (isNaN(dc)) {
  dc = 0;
}

const total = data?.roll?.total || 0;
const isHit = total >= dc && dc > 0;

// If it's an auto critical, we need to set isCritical to true
if (isHit && autoCritical && !isCritical) {
  isCritical = true;
}
else {
  // Mark auto critical false if it was already a critical hit (or a miss)
  autoCritical = false;
}

if (isCritical) {
  const automatic = autoCritical ? 'AUTOMATIC ' : '';
  message = `[center]${icon ? `:${icon}:` : ''} ${attack} ${targetName ? ` :IconTargetArrow: ${targetName}` : ''}[/center]\n\n**[center][color=green]${automatic}CRITICAL HIT[/color] [gm]${dc > 0 ? `(vs AC ${dc})` : ''}[/gm][/center]**
`
  // If damage was defined, we need to double the dice in the damage string and modifiers
  if (damage) {
    damage = doubleDamageDice(damage);
  }

  // Double any damage modifiers
  damageModifiers = damageModifiers.map(mod => {
    return {
      ...mod,
      value: doubleDamageDice(mod.value),
    }
  });
}
else if (isMiss) {
  message = `[center]${icon ? `:${icon}:` : ''} ${attack} ${targetName ? ` :IconTargetArrow: ${targetName}` : ''}[/center]\n\n**[center][color=red]AUTOMATIC MISS[/color] [gm]${dc > 0 ? `(vs AC ${dc})` : ''}[/gm][/center]**`
}
else if (isHit) {
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
const dmgRollName = isCritical ? 'Roll_Critical_Damage' : 'Roll_Damage';
const damageButton = damage ? `\`\`\`${dmgRollName}
api.promptRoll('${attack} Damage', '${damage}', ${JSON.stringify(damageModifiers)}, ${JSON.stringify(damageMetadata)}, 'damage')
\`\`\`` : '';

let effectMacros = '';

// Get weapon masteries
masteryProperties.forEach(mp => {
  const masteryPropertyMetadata = getMasteryProperties(mp, damageModifiers, proficiencyBonus);
  tags.push({
    name: masteryPropertyMetadata.name,
    tooltip: masteryPropertyMetadata.description
  });

  // Create macros for all effects that this property can apply
  const effect = masteryPropertyMetadata?.effect || '';
  if (effect) {
    const effectTitle = `Apply_${effect.replace(/ /g, '_')}`;
    if (effectMacros !== '') {
      effectMacros += '\n';
    }
    effectMacros += `\`\`\`${effectTitle}
let targets = api.getSelectedOrDroppedToken();
targets.forEach(target => {
api.addEffect('${effect}', target);
});
\`\`\``;
  }
});

// Get weapon mastery macros
const macros = masteryProperties.map(mp => {
  const masteryPropertyMetadata = getMasteryProperties(mp, damageModifiers, proficiencyBonus);
  return masteryPropertyMetadata?.macro;
}).filter(macro => macro).join('\n');

message = `
${message}

${damageButton}
${macros}
${effectMacros}
`;

api.sendMessage(message, data.roll, [], tags);