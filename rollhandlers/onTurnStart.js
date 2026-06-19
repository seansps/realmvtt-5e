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
    let targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;
    targetName = targetName.replace(/'/g, ''); // Just remove the single quotes

    // A set linked value means target is a token (address by token id); no linked
    // value means it is a record/sheet (address via getRecord + setValuesOnRecord).
    const isToken = target.linked !== undefined && target.linked !== null;
    const undoBody = isToken
      ? "api.setValueOnTokenById('" + target._id + "', '" + target.recordType + "', 'data.curhp', '" + oldHp + "')"
      : "api.getRecord('" + target.recordType + "', '" + target._id + "', (rec) => { if (rec) api.setValuesOnRecord(rec, { 'data.curhp': " + oldHp + " }); })";

    const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { \$\{undoBody\}; api.editMessage(null, '~\$\{targetName\} healed for \$\{healing\} HP.~'); } else { api.showNotification('Only the GM can undo healing.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;
    
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

// Check for Temporary HP at start of turn (e.g. Heroism). Temp HP doesn't
// stack — take the highest granted value rather than summing.
const tempHpMods = getEffectsAndModifiersForToken(token, ["tempHpStartOfTurn"], "");
let tempHpAmount = 0;
let tempHpEffectNames = "";
tempHpMods.forEach((modifier) => {
  const val = typeof modifier.value === "number" ? modifier.value : parseInt(modifier.value, 10);
  if (!isNaN(val) && val > 0) {
    if (val > tempHpAmount) tempHpAmount = val;
    if (tempHpEffectNames !== "") {
      tempHpEffectNames += ", ";
    }
    tempHpEffectNames += modifier.name;
  }
});

if (tempHpAmount > 0) {
  const tempHpMacro = `\`\`\`Apply_Temp_HP
const tempHpGain = ${tempHpAmount};

let targets = api.getSelectedOrDroppedToken();

if (record) {
  if (isGM || record?.record?.ownerId === userId) {
    targets = [record];
  }
}

if (!isGM && targets.length === 0) {
  targets = api.getSelectedOwnedTokens().map(target => target.token);
}

targets.forEach(target => {
  if (target && target.data) {
    const oldTempHp = parseInt(target.data?.tempHp || '0', 10);
    // Gaining temp HP overrides whatever the target currently has.
    const newTempHp = tempHpGain;
    api.setValueOnToken(target, "data.tempHp", newTempHp);
    const unIdentified = target.identified === false;
    let targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;
    targetName = targetName.replace(/'/g, '');

    // A set linked value means target is a token (address by token id); no linked
    // value means it is a record/sheet (address via getRecord + setValuesOnRecord).
    const isToken = target.linked !== undefined && target.linked !== null;
    const undoBody = isToken
      ? "api.setValueOnTokenById('" + target._id + "', '" + target.recordType + "', 'data.tempHp', '" + oldTempHp + "')"
      : "api.getRecord('" + target.recordType + "', '" + target._id + "', (rec) => { if (rec) api.setValuesOnRecord(rec, { 'data.tempHp': " + oldTempHp + " }); })";

    const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { \$\{undoBody\}; api.editMessage(null, '~\$\{targetName\} temp HP reverted to \$\{oldTempHp\}.~'); } else { api.showNotification('Only the GM can undo this.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;

    api.sendMessage(\`\$\{targetName\} gains \$\{tempHpGain\} temporary hit points.\\n\$\{macro\}\`, undefined, undefined, undefined, target);

    if (tempHpGain > 0) {
      api.floatText(target, \`+\${tempHpGain}\`, "#1165ed");
    }
  }
});
\`\`\``;

  const tempHpMessage = `Gains ${tempHpAmount} temporary hit points at the start of its turn (${tempHpEffectNames}).\n\n${tempHpMacro}`;
  api.sendMessage(tempHpMessage, undefined, [], [], token);
}
