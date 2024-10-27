const token = data?.token;

const roll = '1d20';

// Get modifiers for initiative, which is a dexterity check
const modifiers = [];

// Add dexterity modifier
const dexMod = parseInt(token?.record?.data?.dexterityMod || '0', 10);
modifiers.push({
  name: 'Dexterity',
  value: dexMod,
  active: true
});

// Check effects for all initiative bonuses and penalties
const initiativeModifiers = getEffectsAndModifiersForToken(token, ['initiativeBonus', 'initiativePenalty']);
initiativeModifiers.forEach(modifier => {
  modifiers.push(modifier);
});

const dextertyCheckModifiers = getEffectsAndModifiersForToken(token, ['abilityBonus', 'abilityPenalty'], 'dexterity');
dextertyCheckModifiers.forEach(modifier => {
  modifiers.push(modifier);
});

api.promptRollForToken(token, 'Initiative', roll, modifiers, {
  "rollName": "Initiative",
  "tooltip": "Initiative Roll",
  "dc": 0
}, 'initiative');