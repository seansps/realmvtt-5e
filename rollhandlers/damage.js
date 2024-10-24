const isCritical = data.roll?.metadata?.critical === true;

// Here we need to determine if it was a hit or miss and display in the chat.
const tags = [{
  name: "Damage",
  tooltip: "Damage Roll"
}];

const showHalf = data.roll?.metadata?.save !== undefined && data.roll?.metadata?.save !== '';

// Script to get all modifier and effects affecting the target
const getEffectsAndModifiers = `
function getEffectsAndModifiersForToken(target, types = [], field = '') {
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
      else if (rule.valueType === 'string' && !value.trim().startsWith('-') && isPenalty) {
        value = '-' + value;
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

  // Now collect all modifiers from Features
  const features = target?.record?.data?.features || [];
  features.forEach((feature) => {
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
        results.push({
          name: feature?.name || 'Feature',
          value: value,
          active: modifier.data?.active === true,
          modifierType: ruleType,
          field: modifier.data?.field || '',
          valueType: modifier.data?.valueType,
          isPenalty: isPenalty
        });
      }
    });
  });

  if (types && types.length > 0) {
    results = results.filter(r => types.includes(r.modifierType));
  }

  if (field && field !== '') {
    results = results.filter(r => r.field === field || r.field === 'all');
  }

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
const applyDeathFailures = `
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

const damageMacro = `
\`\`\`Apply_Damage
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
${applyDeathFailures}

targets.forEach(target => {
  // Apply damage
  if (target && target.data) {
    let damage = 0;

    const RIV = getRIV(target);

    // We need to go through each damage type and check if the target has resistance, immunity, or vulnerability to it.
    data.roll.types.forEach(type => {
      let thisDamage = type.value;
      if (RIV.resistances.includes(type?.type?.toLowerCase() || '')) {
        thisDamage = Math.floor(thisDamage * 0.5);
      }
      if (RIV.immunities.includes(type?.type?.toLowerCase() || '')) {
        thisDamage = 0;
      }
      if (RIV.vulnerabilities.includes(type?.type?.toLowerCase() || '')) {
        thisDamage = Math.floor(thisDamage * 2);
      }
      damage += thisDamage;
    });

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

const halfDamageMacro = showHalf ? `
\`\`\`Apply_Half_Damage
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
${applyDeathFailures}

targets.forEach(target => {
  // Apply damage
  if (target && target.data) {
    let damage = 0;

    const RIV = getRIV(target);

    // We need to go through each damage type and check if the target has resistance, immunity, or vulnerability to it.
    data.roll.types.forEach(type => {
      let thisDamage = Math.floor(type.value / 2);
      if (RIV.resistances.includes(type?.type?.toLowerCase() || '')) {
        thisDamage = Math.floor(thisDamage * 0.5);
      }
      if (RIV.immunities.includes(type?.type?.toLowerCase() || '')) {
        thisDamage = 0;
      }
      if (RIV.vulnerabilities.includes(type?.type?.toLowerCase() || '')) {
        thisDamage = Math.floor(thisDamage * 2);
      }
      damage += thisDamage;
    });

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
` : '';

const message = `
${damageMacro}
${halfDamageMacro}
`;

// Here you would check targets and apply damage, etc.
api.sendMessage(message, data.roll, [], tags);