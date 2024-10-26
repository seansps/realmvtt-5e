
function getEffectsAndModifiersForToken(target, types = [], field = '', itemId = undefined) {
  if (!target) {
    return [];
  }
  let results = [];

  // First collect modifiers from effects
  const effects = target?.effects || [];
  effects.forEach((effect) => {
    const rules = effect.rules || [];
    rules.forEach((rule) => {
      const ruleType = rule?.type || '';
      const isPenalty = ruleType.toLowerCase().includes('penalty');
      let value = rule.value || '';
      if (rule.valueType === 'number') {
        value = parseInt(rule.value, 10);
        if (isNaN(value)) {
          value = 0;
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
      }
      else if (rule.valueType === 'string' && !value.trim().startsWith('-') && isPenalty && !value.includes('disadvantage')) {
        value = '-' + value;
      }
      if (value !== 0 && (rule.valueType === 'number' || rule.valueType === 'string')) {
        results.push({
          name: effect.name || 'Effect',
          value: value,
          active: true,
          modifierType: ruleType,
          field: rule?.field || '',
          valueType: rule.valueType,
          isPenalty: isPenalty
        });
      }
      else if (rule.valueType === 'api') {
        let value = parseInt(target?.effectValues?.[effect?._id] || '0', 10);
        if (isPenalty && value > 0) {
          value = -value;
        }
        if (value !== 0) {
          results.push({
            name: effect.name || 'Effect',
            value: value,
            active: true,
            modifierType: ruleType,
            field: rule?.field || '',
            valueType: rule.valueType,
            isPenalty: isPenalty
          });
        }
      }
      else if (rule.valueType === 'stack') {
        // The value is the number of times they have this effect
        let value = target?.effectIds?.filter(id => id === effect?._id).length;
        if (isPenalty && value > 0) {
          value = -value;
        }
        // Check if there is addtional math to apply to it
        const math = rule?.value || '';
        if (math) {
          value = applyMath(value, math);
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
        if (value !== 0) {
          results.push({
            name: effect.name || 'Effect',
            value: value,
            active: true,
            modifierType: ruleType,
            field: rule?.field || '',
            valueType: rule.valueType,
            isPenalty: isPenalty
          });
        }
      }
    });
  });

  // Now collect all modifiers from Features and Items
  const features = target?.record?.data?.features || [];
  const items = target?.record?.data?.inventory || [];
  // Filter items that are not equipped or that require attunement and not attuned
  const equippedItems = items.filter(item => item.data?.carried === 'equipped'
    && (!item.data?.attunement || item.data?.attuned === 'true'));
  [...features, ...equippedItems].forEach((feature) => {
    const modifiers = feature.data?.modifiers || [];
    modifiers.forEach((modifier) => {
      const ruleType = modifier.data?.type || '';
      const isPenalty = ruleType.toLowerCase().includes('penalty');
      let value = modifier.data?.value || '';
      if (modifier.data?.valueType === 'number') {
        value = parseInt(modifier.data?.value, 10);
        if (isNaN(value)) {
          value = 0;
        }
        if (isPenalty && value > 0) {
          value = -value;
        }
      }
      else if (modifier.data?.valueType === 'field') {
        const fieldToUse = modifier.data?.value || '';
        if (fieldToUse) {
          value = target?.record?.data?.[fieldToUse] || '';
        }
      }
      else if (modifier.data?.valueType === 'string' && !value.trim().startsWith('-') && isPenalty) {
        value = '-' + value;
      }

      // Only relevant if it has a value
      if (value !== 0) {
        // Check if this only applies to equipped item and mark it with ID if so 
        const itemOnly = modifier.data?.itemOnly || false;
        results.push({
          name: feature?.name || 'Feature',
          value: value,
          active: modifier.data?.active === true,
          modifierType: ruleType,
          field: modifier.data?.field || '',
          valueType: modifier.data?.valueType,
          itemId: itemOnly ? feature?._id : undefined,
          isPenalty: isPenalty
        });
      }
    });
  });

  if (types && types.length > 0) {
    results = results.filter(r => types.includes(r.modifierType));
  }

  if (field && field !== '') {
    results = results.filter(r => r.field === field || r.field === 'all' || !r.field);
  }

  // Filter by itemId if provided
  results = results.filter(r => r.itemId === itemId || r.itemId === undefined);

  return results;
}

const token = data?.tokens && data?.tokens.length > 0 ? data?.tokens[0] : undefined;

if (!token) {
  return;
}

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
  "dc": 0,
  "group": data?.tokens
}, 'initiative');
