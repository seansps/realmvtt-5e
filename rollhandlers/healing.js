// Here we need to determine if it was a hit or miss and display in the chat.
const tags = [
  {
    name: "Healing",
    tooltip: "Healing Roll",
  },
];

const mods = data.roll?.metadata?.modifiers || [];

mods.forEach((mod) => {
  if (mod.value > 0) {
    tags.push({
      name: mod.name,
      tooltip: `Modifier for ${
        mod.name.charAt(0).toUpperCase() + mod.name.slice(1)
      }`,
    });
  }
});

// Separate roll by temp healing and regular healing
const tempHealing = data.roll.types.reduce(
  (acc, type) => (type.type == "temp" ? acc + type.value : acc),
  0
);
const regularHealing = data.roll.types.reduce(
  (acc, type) => (type.type != "temp" ? acc + type.value : acc),
  0
);

let message = "";

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

// Here you would check targets and apply damage, etc.
api.sendMessage(message, data.roll, [], tags);
