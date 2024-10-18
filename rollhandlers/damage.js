// Here we need to determine if it was a hit or miss and display in the chat.
const tags = [{
  name: "Damage",
  tooltip: "Damage Roll"
}];

const showHalf = data.roll?.metadata?.save !== undefined && data.roll?.metadata?.save !== '';

const damageMacro = `
\`\`\`Apply_Damage
let damage = ${data.roll.total};

let targets = api.getSelectedTokens().map(target => target.token);

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

// TODO determine damage from data.roll.types, example:
// types [ { die: 6, narrative: false, rollId: 0, type: "acid", value: 6 } ] 

targets.forEach(target => {
  // Apply wounds
  if (target && target.data) {
    // TODO Check for Resistance and Immunities

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

    const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.tempHp', '\$\{oldTempHp\}'); api.editMessage(null, '~\$\{message\}~'); } else { api.showNotification('Only the GM can undo damage.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;

    api.sendMessage(\`\$\{message\}\\n\$\{macro\}\`, undefined, undefined, undefined, target);
  }
});
\`\`\`
`;

const halfDamageMacro = showHalf ? `
\`\`\`Apply_Half_Damage
let damage = Math.floor(${data.roll.total} / 2);

let targets = api.getSelectedTokens().map(target => target.token);

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
  // Apply wounds
  if (target && target.data) {
    // TODO Check for Resistance and Immunities

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

    const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.tempHp', '\$\{oldTempHp\}'); api.editMessage(null, '~\$\{message\}~'); } else { api.showNotification('Only the GM can undo damage.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;

    api.sendMessage(\`\$\{message\}\\n\$\{macro\}\`, undefined, undefined, undefined, target);
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