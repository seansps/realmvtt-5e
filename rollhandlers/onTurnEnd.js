// End-of-turn hook: applies ongoing damage (from effects carrying an
// `ongoingDamage` rule) and end-of-turn regeneration (`regenerationOnTurnEnd`
// modifiers). Both dice and flat ongoing damage are routed through api.roll →
// damage.js so damage typing/resistances are handled there.
const token = data?.token;

const effects = token?.effects || [];
const effectValues = token?.effectValues || {};

// Find all effects that carry an ongoingDamage rule
const ongoingDamageEffects = effects.filter((effect) => {
  const rules = effect?.rules || [];
  return rules.some((rule) => rule.type === "ongoingDamage");
});

const hasDiceRoll = (v) => /\d*d\d+/i.test(String(v));

const processOngoingDamage = (damageValue, effectName) => {
  if (!damageValue) return;
  // Resolve @record/@caster/{expression} references against the affected token.
  let resolved = checkForReplacements(String(damageValue), {}, token, undefined);
  if (!resolved || !resolved.toString().trim()) return;
  resolved = resolved.toString();

  if (hasDiceRoll(resolved)) {
    // Dice damage — roll it (routes to damage.js, which applies + shows buttons).
    api.roll(resolved, { isOngoingDamage: true, rollName: effectName }, "damage");
    return;
  }

  // Flat damage (e.g. "5 fire") — show inline Apply / Apply-Half buttons.
  const parts = resolved.trim().split(/\s+/);
  const flat = parseInt(parts[0], 10) || 0;
  if (flat <= 0) return;
  const dtype =
    parts.length >= 2 ? parts.slice(1).join(" ").toLowerCase() : "untyped";
  const damageByType = { [dtype]: flat };
  const safeName = effectName.replace(/\s+/g, "_");
  const applyMacro = getDamageMacro(
    "Apply_" + safeName + "_Damage",
    damageByType,
    {},
  );
  const halfMacro = getDamageMacro(
    "Apply_Half_" + safeName + "_Damage",
    damageByType,
    { isHalf: true },
  );
  const message =
    "**[center]" +
    effectName +
    ": " +
    flat +
    " " +
    dtype +
    " damage[/center]**\n" +
    applyMacro +
    "\n" +
    halfMacro;
  api.sendMessage(
    message,
    undefined,
    [],
    [{ name: "Ongoing Damage", tooltip: effectName }],
    token,
  );
};

ongoingDamageEffects.forEach((effect) => {
  const rules = effect?.rules || [];
  const ongoingRule = rules.find((rule) => rule.type === "ongoingDamage");
  if (!ongoingRule) return;
  const effectName = effect.name || "Ongoing Damage";

  // effectValues may carry a literal damage override (string/array/{value}),
  // or just a caster reference ({tokenId,...}) which is NOT an override.
  const rawEffectValue = effectValues?.[effect?._id];
  const isDamageOverride =
    typeof rawEffectValue === "string" ||
    Array.isArray(rawEffectValue) ||
    (typeof rawEffectValue === "object" &&
      rawEffectValue !== null &&
      rawEffectValue.value !== undefined);
  const existingValue = isDamageOverride ? rawEffectValue : null;

  if (existingValue) {
    const resolvedValue =
      typeof existingValue === "object" && existingValue.value !== undefined
        ? existingValue.value
        : existingValue;
    if (typeof resolvedValue === "string") {
      processOngoingDamage(resolvedValue, effectName);
    } else if (Array.isArray(resolvedValue)) {
      resolvedValue.forEach((item) =>
        processOngoingDamage(item?.value || item, effectName),
      );
    }
  } else {
    processOngoingDamage(ongoingRule?.value || "", effectName);
  }
});

// Regeneration (End of Turn): sum regenerationOnTurnEnd modifiers
const regenEndMods = getEffectsAndModifiersForToken(
  token,
  ["regenerationOnTurnEnd"],
  "",
);
let regenEndHealing = 0;
const regenEndDiceParts = [];
let regenEndNames = "";
const isBloodied =
  token?.data?.curhp <= Math.floor((token?.data?.hitpoints || 0) / 2);
regenEndMods.forEach((modifier) => {
  if (modifier.field === "bloodied" && !isBloodied) return;
  const raw = (modifier.value ?? "").toString().trim();
  if (!raw) return;
  if (/\d*d\d+/i.test(raw)) {
    regenEndDiceParts.push(raw);
    if (regenEndNames !== "") regenEndNames += ", ";
    regenEndNames += modifier.name || "";
  } else {
    const val = parseInt(raw, 10);
    if (!isNaN(val) && val > 0) {
      regenEndHealing += val;
      if (regenEndNames !== "") regenEndNames += ", ";
      regenEndNames += modifier.name || "";
    }
  }
});

// Dice-based regeneration: roll it as a healing roll (so e.g. 7d4 actually
// rolls instead of applying a flat 7). Any flat regeneration is folded in.
if (regenEndDiceParts.length > 0 && token.data?.curhp < token.data?.hitpoints) {
  const regenFormula = [
    ...regenEndDiceParts,
    ...(regenEndHealing > 0 ? [String(regenEndHealing)] : []),
  ].join(" + ");
  api.roll(
    regenFormula,
    {
      rollName: regenEndNames
        ? `Regeneration (${regenEndNames})`
        : "Regeneration",
      recordId: token.record?._id || token._id,
      recordType: token.recordType || token.record?.recordType,
      tokenId: token._id,
    },
    "healing",
  );
}

if (
  regenEndDiceParts.length === 0 &&
  regenEndHealing > 0 &&
  token.data?.curhp < token.data?.hitpoints
) {
  const healingMacro = `\`\`\`Apply_Healing
const healing = ${regenEndHealing};

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
    var curhp = target.data?.curhp || 0;
    curhp += healing;
    if (curhp > target.data?.hitpoints) { curhp = target.data?.hitpoints; }
    const oldHp = (target.data?.curhp || 0);
    api.setValueOnToken(target, "data.curhp", curhp);
    const unIdentified = target.identified === false;
    let targetName = !unIdentified ? target.name || target.record.name : target.unidentifiedName || target.record.unidentifiedName;
    targetName = targetName.replace(/'/g, '');

    const macro = \`\\\`\\\`\\\`Undo\\n if (isGM) { api.setValueOnTokenById('\$\{target._id\}', '\$\{target.recordType\}', 'data.curhp', '\$\{oldHp\}'); api.editMessage(null, '~\$\{targetName\} healed for \$\{healing\} HP.~'); } else { api.showNotification('Only the GM can undo healing.', 'yellow', 'Notice'); } \\n\\\`\\\`\\\`\`;

    api.sendMessage(\`\$\{targetName\} healed for \$\{healing\} HP.\\n\$\{macro\}\`, undefined, undefined, undefined, target);

    if (healing > 0) {
      api.floatText(target, \`+\${healing}\`, "#1bc91b");
    }
  }
});
\`\`\``;

  const message = `Regenerates ${regenEndHealing} HP (end of turn), unless deactivated.\n\n${healingMacro}`;
  api.sendMessage(message, undefined, [], [], token);
}
