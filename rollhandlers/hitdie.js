// Here we heal the charcter by the amount rolled 
// And deduct 1 hit die from their total remaining

const recordId = record?._id;
const hitDieField = data?.roll?.metadata?.hitDieField;

// Requery the record incase multiple dice are being used
api.getRecord('characters', recordId, (record) => {
  // Update hit die remaining
  const hitDieRemaining = parseInt(record?.data?.[hitDieField] || '0', 10);

  if (hitDieRemaining) {

    const valuesToSet = {};
    if (hitDieRemaining && hitDieField && recordId) {
      const hitDieCount = parseInt(data?.roll?.metadata?.hitDieCount || "1", 10);
      valuesToSet[`data.${hitDieField}`] = hitDieRemaining - hitDieCount <= 0 ? null : hitDieRemaining - hitDieCount;
    }

    // Add the amount rolled + con mod to the character's curhp
    let amountToAdd = data?.roll?.total;
    // Minimum of 1
    if (amountToAdd <= 0) { amountToAdd = 1; }

    // Hit-die healing multiplier (e.g. doubles HP from hit dice). Highest active
    // multiplier wins (they don't compound); a value <= 1 has no effect.
    let hdMultiplier = 1;
    getEffectsAndModifiersForToken(record, ["hitDieHealingMultiplier"]).forEach((mod) => {
      const v = parseInt(mod.value, 10);
      if (!isNaN(v) && v > hdMultiplier) hdMultiplier = v;
    });
    if (hdMultiplier > 1) { amountToAdd *= hdMultiplier; }

    // Hit-die healing bonus (flat bonus per die spent)
    let hdBonus = 0;
    getEffectsAndModifiersForToken(record, ["hitDieHealingBonus"]).forEach((mod) => {
      const v = parseInt(mod.value, 10);
      if (!isNaN(v)) hdBonus += v;
    });
    if (hdBonus !== 0) {
      const diceSpent = parseInt(data?.roll?.metadata?.hitDieCount || "1", 10);
      amountToAdd += hdBonus * diceSpent;
    }
    if (amountToAdd <= 0) { amountToAdd = 1; }

    const maxHp = parseInt(record?.data?.hitpoints || '0', 10);
    let newHp = amountToAdd + parseInt(record?.data?.curhp || '0', 10);
    if (newHp > maxHp) {
      // Not to exceed max hp
      newHp = maxHp;
    }

    valuesToSet['data.curhp'] = newHp;

    api.setValues(valuesToSet);

    const tags = [{
      name: "Hit Die",
      tooltip: "Hit Die Roll"
    }];

    // Send a message
    api.sendMessage(`[center]Recovered ${amountToAdd} HP[/center]`, data.roll, [], tags);
  }
  else {
    api.showNotification(`No Hit Die Remaining for ${record?.name}`, 'red', "No Hit Dice");
  }
});

