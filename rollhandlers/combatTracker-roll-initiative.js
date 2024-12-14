const token = data?.token;

const roll = "1d20";

// Get modifiers for initiative, which is a dexterity check
const modifiers = [];

// Add dexterity modifier for PCs
if (token.recordType === "characters") {
  const dexMod = parseInt(token?.data?.dexterityMod || "0", 10);
  modifiers.push({
    name: "Dexterity",
    value: dexMod,
    active: true,
  });
} else {
  // Use NPC's initiative modifier
  const initiativeMod = parseInt(token?.data?.initiativeMod || "0", 10);
  modifiers.push({
    name: "Initiative",
    value: initiativeMod,
    active: true,
  });
}

// Check effects for all initiative bonuses and penalties
const initiativeModifiers = getEffectsAndModifiersForToken(token, [
  "initiativeBonus",
  "initiativePenalty",
]);
initiativeModifiers.forEach((modifier) => {
  modifiers.push(modifier);
});

const dextertyCheckModifiers = getEffectsAndModifiersForToken(
  token,
  ["abilityBonus", "abilityPenalty"],
  "dexterity"
);
dextertyCheckModifiers.forEach((modifier) => {
  modifiers.push(modifier);
});

api.promptRollForToken(
  token,
  "Initiative",
  roll,
  modifiers,
  {
    rollName: "Initiative",
    tooltip: "Initiative Roll",
    token: token,
    dc: 0,
  },
  "initiative"
);
