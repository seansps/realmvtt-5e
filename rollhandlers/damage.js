const isCritical = data.roll?.metadata?.critical === true;

// Here we need to determine if it was a hit or miss and display in the chat.
const tags = [{
  name: "Damage",
  tooltip: "Damage Roll"
}];

const showHalf = data.roll?.metadata?.save !== undefined && data.roll?.metadata?.save !== '';

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

targets.forEach(target => {
  // Apply damage
  if (target && target.data) {
    let damage = 0;

    const RIV = getRIV(target);

    // First, just get the total of all damage for each type
    const damageByType = {};
    data.roll.types.forEach(type => {
      const damageType = type.type || 'untyped';
      damageByType[damageType] = (damageByType[damageType] || 0) + type.value;
    });

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

    // First deduct from Temp HP
    const oldTempHp = parseInt(target.data?.tempHp || '0', 10);
    const newTempHp = Math.max(oldTempHp - damage, 0);
    damage = Math.max(damage - oldTempHp, 0);
    let usedTempHp = false;
    if (newTempHp !== oldTempHp) {
      api.setValueOnToken(target, "data.tempHp", newTempHp);
      usedTempHp = true;
    }

    // Then deduct from Current HP and check for Instant Death
    let instantDeath = false;
    var curhp = target.data?.curhp || 0;
    curhp -= damage;
    if (curhp < 0) { 
      // If the remainder of damage >= max HP, we apply Instant Death (if it's a character)
      if (Math.abs(curhp) >= target.data?.hitpoints && target.recordType === 'characters') {
        instantDeath = true;
      }
      curhp = 0;
    }
    if (curhp > target.data?.hitpoints) { curhp = target.data?.hitpoints; }
    const oldHp = (target.data?.curhp || 0);
    api.setValueOnToken(target, "data.curhp", curhp);
    
    const unIdentified = target.identified === false;
    const targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;

    let message = \`\$\{targetName\} took \$\{damage\} damage.\`;
    if (usedTempHp) {
      message = \`\$\{targetName\} took \$\{damage\} damage after deducting Temp HP.\`;
    }
    if (dueToThreshold) {
      message = \`\$\{targetName\} took no damage due to the damage threshold.\`;
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

    const macro = damage > 0 && !instantDeath ? \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.tempHp', '\$\{oldTempHp\}'); api.editMessage(null, '~\$\{message\}~'); } else { api.showNotification('Only the GM can undo damage.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\` : '';

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

    // First deduct from Temp HP
    const oldTempHp = parseInt(target.data?.tempHp || '0', 10);
    const newTempHp = Math.max(oldTempHp - damage, 0);
    damage = Math.max(damage - oldTempHp, 0);
    let usedTempHp = false;
    if (newTempHp !== oldTempHp) {
      api.setValueOnToken(target, "data.tempHp", newTempHp);
      usedTempHp = true;
    }

    // Then deduct from Current HP and check for Instant Death
    let instantDeath = false;
    var curhp = target.data?.curhp || 0;
    curhp -= damage;
    if (curhp < 0) { 
      // If the remainder of damage >= max HP, we apply Instant Death (if it's a character)
      if (Math.abs(curhp) >= target.data?.hitpoints && target.recordType === 'characters') {
        instantDeath = true;
      }
      curhp = 0;
    }
    if (curhp > target.data?.hitpoints) { curhp = target.data?.hitpoints; }
    const oldHp = (target.data?.curhp || 0);
    api.setValueOnToken(target, "data.curhp", curhp);

    const unIdentified = target.identified === false;
    const targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;

    let message = \`\$\{targetName\} took \$\{damage\} damage.\`;
    if (usedTempHp) {
      message = \`\$\{targetName\} took \$\{damage\} damage after deducting Temp HP.\`;
    }
    if (dueToThreshold) {
      message = \`\$\{targetName\} took no damage due to the damage threshold.\`;
    }

    if (instantDeath) {
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

    const macro = damage > 0 && !instantDeath ? \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.tempHp', '\$\{oldTempHp\}'); api.editMessage(null, '~\$\{message\}~'); } else { api.showNotification('Only the GM can undo damage.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\` : '';

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

api.sendMessage(message, data.roll, [], tags);