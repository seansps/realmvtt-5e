// Here we need to determine if it was a hit or miss and display in the chat.
const tags = [{
  name: "Damage",
  tooltip: "Damage Roll"
}];

const showHalf = data.roll?.metadata?.save !== undefined && data.roll?.metadata?.save !== '';

const getRIVScript = `
function getRIV(target) {
  const resistString = target.data?.resistances || '';
  const resistances = resistString.split(',').map(r => r.toLowerCase().trim());
  const immuneString = target.data?.immunities || '';
  const immunities = immuneString.split(',').map(i => i.toLowerCase().trim());
  const vulnString = target.data?.vulnerabilities || '';
  const vulnerabilities = vulnString.split(',').map(v => v.toLowerCase().trim());

  if (resistString.toLowerCase().includes("bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered")) {
    resistances = resistances.map(r => {
      if (r.includes('bludgeoning')) {
        return 'bludgeoning';
      }
      else if (r.includes('piercing')) {
        return 'piercing';
      }
      else if (r.includes('slashing')) {
        return 'slashing';
      }
      return r;
    });
  }
  else if (resistString.toLowerCase().includes("bludgeoning, piercing, and slashing from nonmagical attacks")) {
    resistances = resistances.map(r => {
      if (r.includes('bludgeoning')) {
        return 'bludgeoning';
      }
      else if (r.includes('piercing')) {
        return 'piercing';
      }
      else if (r.includes('slashing')) {
        return 'slashing';
      }
      return r;
    });
    // Include silvered weapons
    resistances.push('silvered bludgeoning');
    resistances.push('silvered piercing');
    resistances.push('silvered slashing');
  }

  // Do the above for immunities and vulnerabilities
  if (immuneString.toLowerCase().includes("bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered")) {
    immunities = immunities.map(immune => {
      if (immune.includes('bludgeoning')) {
        return 'bludgeoning';
      }
      else if (immune.includes('piercing')) {
        return 'piercing';
      }
      else if (immune.includes('slashing')) {
        return 'slashing';
      }
      return immune;
    });
  }
  else if (immuneString.toLowerCase().includes("bludgeoning, piercing, and slashing from nonmagical attacks")) {
    immunities = immunities.map(immune => {
      if (immune.includes('bludgeoning')) {
        return 'bludgeoning';
      }
      else if (immune.includes('piercing')) {
        return 'piercing';
      }
      else if (immune.includes('slashing')) {
        return 'slashing';
      }
      return immune;
    });
    // Include silvered weapons
    immunities.push('silvered bludgeoning');
    immunities.push('silvered piercing');
    immunities.push('silvered slashing');
  }

  if (vulnString.toLowerCase().includes("bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered")) {
    vulnerabilities = vulnerabilities.map(vuln => {
      if (vuln.includes('bludgeoning')) {
        return 'bludgeoning';
      }
      else if (vuln.includes('piercing')) {
        return 'piercing';
      }
      else if (vuln.includes('slashing')) {
        return 'slashing';
      }
      return vuln;
    });
  }
  else if (vulnString.toLowerCase().includes("bludgeoning, piercing, and slashing from nonmagical attacks")) {
    vulnerabilities = vulnerabilities.map(vuln => {
      if (vuln.includes('bludgeoning')) {
        return 'bludgeoning';
      }
      else if (vuln.includes('piercing')) {
        return 'piercing';
      }
      else if (vuln.includes('slashing')) {
        return 'slashing';
      }
      return vuln;
    });
    // Include silvered weapons
    vulnerabilities.push('silvered bludgeoning');
    vulnerabilities.push('silvered piercing');
    vulnerabilities.push('silvered slashing');
  }

  return {
    resistances,
    immunities,
    vulnerabilities
  };
}
`;

const damageMacro = `
\`\`\`Apply_Damage
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

// Add RIV script
${getRIVScript}

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

    const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.tempHp', '\$\{oldTempHp\}'); api.editMessage(null, '~\$\{message\}~'); } else { api.showNotification('Only the GM can undo damage.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;

    api.sendMessage(\`\$\{message\}\\n\$\{macro\}\`, undefined, undefined, undefined, target);
  }
});
\`\`\`
`;

const halfDamageMacro = showHalf ? `
\`\`\`Apply_Half_Damage
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

// Add RIV script
${getRIVScript}

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