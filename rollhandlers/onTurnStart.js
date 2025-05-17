// On the Start of an NPCs Turn, check for any Recharge effects and if the value is within the range, send a message and remove the effect
const token = data?.token;
const effects = token?.effects || [];
const effectValues = token?.effectValues || {};
const rechargeEffect = effects.find(
  (effect) => effect?.name?.toLowerCase() === "recharge"
);

if (rechargeEffect) {
  const effectValue = effectValues?.[rechargeEffect?._id];
  const actionName = (effectValue || "").split("[")[0].trim();
  let effectDc = "6";
  if (effectValue && effectValue.includes("[")) {
    effectDc = parseInt(effectValue.split("[")[1].trim(), 10);
    if (isNaN(effectDc)) {
      effectDc = "6";
    }
  }

  api.roll(
    "1d6",
    {
      tokenId: token?._id,
      actionName: actionName,
      effectId: rechargeEffect?._id,
      dc: effectDc,
    },
    "recharge"
  );
}

// Update reactions if needed
if (token?.data?.usedReactions) {
  if (token?.data?.usedReactions > 0) {
    api.setValueOnToken(token, "data.usedReactions", 0);
  }
}

// Update legendary actions if needed
if (token?.data?.usedLegendaryActions) {
  if (token?.data?.usedLegendaryActions > 0) {
    api.setValueOnToken(token, "data.usedLegendaryActions", 0);
  }
}

// Check for Regeneration effects
const modifiers = getEffectsAndModifiersForToken(token, ["regeneration"], "");

// This gets applied to the token's HP via a macro
let healing = 0;
let effectsNames = "";
modifiers.forEach((modifier) => {
  if (typeof modifier.value === "number" && modifier.value > 0) {
    healing += modifier.value;
    if (effectsNames !== "") {
      effectsNames += ", ";
    }
    effectsNames += modifier.name;
  }
});

if (healing > 0 && token.data?.curhp < token.data?.hitpoints) {
  const healingMacro = `\`\`\`Apply_Healing
const healing = ${healing};

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
\`\`\``;

  const message = `Regenerates ${healing} HP, unless deactivated.\n\n${healingMacro}`;
  api.sendMessage(message, undefined, [], [], token);
}
