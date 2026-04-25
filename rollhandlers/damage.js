const isCritical = data.roll?.metadata?.critical === true;

// Optional header — when the damage roll came from an attack, render the
// attack's portrait (or icon) + name above the damage breakdown.
const damageAttackName = data.roll?.metadata?.attack || "";
const damageIcon = data.roll?.metadata?.icon;
const damagePortrait = data.roll?.metadata?.portrait;
const damageIconStr = damagePortrait
  ? `![](${assetUrl}${encodeURI(damagePortrait)}?width=30&height=30)`
  : damageIcon
    ? `:${damageIcon}:`
    : "";
const damageHeader =
  damageAttackName || damageIconStr
    ? `[center]${damageIconStr} ${damageAttackName}[/center]`
    : "";

// Get any ignore resistances or immunities from the metadata
const damageIgnoresResistances = (
  data.roll?.metadata?.damageIgnoresResistances || ""
)
  .split(",")
  .map((s) => s.toLowerCase().trim());
const damageIgnoresImmunities = (
  data.roll?.metadata?.damageIgnoresImmunities || ""
)
  .split(",")
  .map((s) => s.toLowerCase().trim());

// Here we need to determine if it was a hit or miss and display in the chat.
const tags = [
  {
    name: "Damage",
    tooltip: "Damage Roll",
  },
];

// We'll always show half damage, even if the damage was a normal attack, in case the GM
// needs to apply half damage
const showHalf = true;
// If the damage came from a spell, we track that here for "spell" resistance/immunity/vulnerability
const isSpell = data.roll?.metadata?.isSpell === true;

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
\`\`\`
`;

const halfDamageMacro = showHalf
  ? `
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

    // First, just get the total of all damage for each type
    const damageByType = {};
    data.roll.types.forEach(type => {
      const damageType = type.type || 'untyped';
      damageByType[damageType] = (damageByType[damageType] || 0) + type.value;
    });

    // We need to go through each damage type and check if the target has resistance, immunity, or vulnerability to it.
    Object.keys(damageByType).forEach(type => {
      let thisDamage = Math.floor(damageByType[type] / 2);
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
\`\`\`
`
  : "";

const message = `
${damageHeader}
${damageMacro}
${halfDamageMacro}
`;

api.sendMessage(message, data.roll, [], tags);
