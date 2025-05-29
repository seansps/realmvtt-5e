const name = data?.roll?.metadata?.rollName;
const tooltip = data?.roll?.metadata?.tooltip;
const description = data?.roll?.metadata?.description || "";
const damageTypes = data?.roll?.metadata?.damageTypes || [];
const showHalf = data?.roll?.metadata?.showHalf || false;
const showHealing = data?.roll?.metadata?.showHealing || false;
const minRoll = data?.roll?.metadata?.minRoll;
const tokenId = data?.roll?.metadata?.tokenId;
const targetId = data?.roll?.metadata?.targetId;
const animation = data?.roll?.metadata?.animation || null;

// Find the undropped d20, and if minroll is set
// alter the actual roll to be the minroll if it's lower
const roll = {
  ...data.roll,
  dice: [...(data?.roll?.dice || [])],
  total: data?.roll?.total !== undefined ? data?.roll?.total : 0,
};

if (roll.dice) {
  roll.dice = roll.dice.map((d) => {
    let value = parseInt(d.value, 10);
    if (d.type === 20 && d.reason !== "dropped") {
      if (minRoll && value < minRoll) {
        roll.total += minRoll - value;
        value = minRoll;
      }
    }
    return {
      ...d,
      value: value,
    };
  });
}

let message = "";

let dc = 0;
dc = parseInt(data?.roll?.metadata?.dc || "0", 10);
if (isNaN(dc)) {
  dc = 0;
}
if (dc > 0) {
  const total = roll.total;
  if (total >= dc) {
    message = `**[center][color=green]SUCCESS[/color] [gm]vs DC ${dc}[/gm][/center]**`;
  } else {
    message = `**[center][color=red]FAILURE[/color] [gm]vs DC ${dc}[/gm][/center]**`;
  }
}

if (description) {
  if (message) {
    message += `\n\n${description}`;
  } else {
    message = description;
  }
}

if (damageTypes.length > 0) {
  damageTypes.forEach((damageType) => {
    const damageMacro = `
\`\`\`Apply_${capitalize(damageType)}_Damage
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

    let thisDamage = ${roll.total};
    const damageType = '${damageType}';
    if (RIV.resistances.includes(damageType.toLowerCase() || '')) {
      thisDamage = Math.floor(thisDamage * 0.5);
    }
    if (RIV.immunities.includes(damageType.toLowerCase() || '')) {
      thisDamage = 0;
    }
    if (RIV.vulnerabilities.includes(damageType.toLowerCase() || '')) {
      thisDamage = Math.floor(thisDamage * 2);
    }
    damage += thisDamage;

    // Apply additional one-off resistances per damage type
    if (RIV.resistanceByDamage[damageType.toLowerCase()]) {
      damage -= RIV.resistanceByDamage[damageType.toLowerCase()];
    }

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
    const targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;

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
      applyDeathFailures(target, false);
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
\`\`\`Apply_Half_${capitalize(damageType)}_Damage
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

    let thisDamage = ${Math.floor(roll.total / 2)};
    const damageType = '${damageType}';
    if (RIV.resistances.includes(damageType.toLowerCase() || '')) {
      thisDamage = Math.floor(thisDamage * 0.5);
    }
    if (RIV.immunities.includes(damageType.toLowerCase() || '')) {
      thisDamage = 0;
    }
    if (RIV.vulnerabilities.includes(damageType.toLowerCase() || '')) {
      thisDamage = Math.floor(thisDamage * 2);
    }
    damage += thisDamage;

    // Apply additional one-off resistances per damage type
    if (RIV.resistanceByDamage[damageType.toLowerCase()]) {
      damage -= RIV.resistanceByDamage[damageType.toLowerCase()];
    }

    // We cannot deal negative damage
    if (damage < 0) {
      damage = 0;
    }

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
    const targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;

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
      applyDeathFailures(target, false);
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

    message = `${message}
${damageMacro}
${halfDamageMacro}
`;
  });
}

if (showHealing) {
  // Separate roll by temp healing and regular healing
  const tempHealing = data.roll.types.reduce(
    (acc, type) => (type.type == "temp" ? acc + type.value : acc),
    0
  );
  const regularHealing = data.roll.types.reduce(
    (acc, type) => (type.type != "temp" ? acc + type.value : acc),
    0
  );

  const tempMacro = tempHealing
    ? `
\`\`\`Apply_Temporary_HP
const tempHp = ${tempHealing};

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
  const oldTempHp = parseInt(target.data?.tempHp || '0', 10);
  // Temp HP always overrides existing temp HP, if it is higher
  const newTempHp = Math.max(tempHp, oldTempHp);
  api.setValueOnToken(target, "data.tempHp", newTempHp);
  const unIdentified = target.identified === false;
  const targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;
  
  const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.tempHp', '\$\{oldTempHp\}'); api.editMessage(null, '~\$\{targetName\} received \$\{tempHp\} Temporary Hit Points.~'); } else { api.showNotification('Only the GM can undo healing.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;
  
  api.sendMessage(\`\$\{targetName\} received \$\{tempHp\} Temporary Hit Points.\\n\$\{macro\}\`, undefined, undefined, undefined, target);

  // If healing > 0, float text
  if (tempHp > 0) {
    api.floatText(target, \`+\${tempHp}\`, "#1165ed");
  }
});
\`\`\`
`
    : "";

  const healingMacro = regularHealing
    ? `
  \`\`\`Apply_Healing
  const healing = ${regularHealing};
  
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
    // Apply healing
    if (target && target.data) {
        var curhp = target.data?.curhp || 0;
        curhp += healing;
        if (curhp > target.data?.hitpoints) { curhp = target.data?.hitpoints; }
        const oldHp = (target.data?.curhp || 0);
        api.setValueOnToken(target, "data.curhp", curhp);
        const unIdentified = target.identified === false;
        const targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;
  
        const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.editMessage(null, '~\$\{targetName\} healed for \$\{healing\} HP.~'); } else { api.showNotification('Only the GM can undo healing.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;
        
        api.sendMessage(\`\$\{targetName\} healed for \$\{healing\} HP.\\n\$\{macro\}\`, undefined, undefined, undefined, target);

        // If healing > 0, float text
        if (healing > 0) {
          api.floatText(target, \`+\${healing}\`, "#1bc91b");
        }
    }
  });
  \`\`\`
  `
    : "";

  message = `${message}
  ${healingMacro}
  ${tempMacro}
  `;
}

api.sendMessage(
  message,
  roll,
  [],
  [
    {
      name: name || "Ability",
      tooltip: tooltip || `${name || ""} Ability Roll`,
    },
  ]
);

let animationToPlay = animation;

if (!animationToPlay && (damageTypes.length > 0 || showHealing)) {
  animationToPlay = getAnimationFor({
    abilityName: name || "Ability",
    damage: !showHealing ? damageTypes.join(", ") : "",
    healing: showHealing ? "healing" : "",
    isRanged: true,
  });
}

if (animationToPlay && animationToPlay.animationName && tokenId) {
  api.playAnimation(animationToPlay, tokenId, targetId);
}
