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
      valuesToSet[`data.${hitDieField}`] = hitDieRemaining - 1 <= 0 ? null : hitDieRemaining - 1;
    }

    // Add the amount rolled + con mod to the character's curhp
    let amountToAdd = data?.roll?.total;
    // Minimum of 1
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

