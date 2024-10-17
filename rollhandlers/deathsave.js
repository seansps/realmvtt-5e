// Perform a death save, which is always DC 10, and mark up or down the character's death save success/failure count
const recordId = record?._id;

// Hardcoded for death saves
const dc = 10;

// Requery the record incase rolling multiple death saves
api.getRecord('characters', recordId, (record) => {
  // Compare roll to DC

  const criticalSuccess = data?.roll?.total - data?.roll?.modifier >= 20;
  const criticalFailure = data?.roll?.total - data?.roll?.modifier <= 1;
  const normalSuccess = data?.roll?.total - data?.roll?.modifier >= dc;

  const tags = [{
    name: "Death Save",
    tooltip: "Death Save Roll"
  }];

  const valuesToSet = {};
  let numFailures = parseInt(record?.data?.deathSaveFailures || '0', 10);
  let numSuccesses = parseInt(record?.data?.deathSaveSuccesses || '0', 10);

  if (criticalSuccess) {
    // Add 1 HP
    const maxHp = parseInt(record?.data?.hitpoints || '0', 10);
    let newHp = 1 + parseInt(record?.data?.curhp || '0', 10);
    if (newHp > maxHp) {
      // Not to exceed max hp
      newHp = maxHp;
    }
    valuesToSet['data.curhp'] = newHp;
    api.sendMessage(`**[center][color=green]CRITICAL SUCCESS[/color][/center]**\n\n[center]Regaining 1 HP.[/center]`, data.roll, [], []);
  }
  else if (criticalFailure) {
    // Add 2 failures
    numFailures += 2;
    if (numFailures >= 3) {
      numFailures = 3;
    }
    valuesToSet['data.deathSaveFailures'] = numFailures;
    api.sendMessage(`**[center][color=red]CRITICAL FAILURE[/color][/center]**`, data.roll, [], tags);
  }
  else if (normalSuccess) {
    // Add 1 success
    numSuccesses += 1;
    if (numSuccesses >= 3) {
      numSuccesses = 3;
    }
    valuesToSet['data.deathSaveSuccesses'] = numSuccesses;
    api.sendMessage(`**[center][color=green]SUCCESS[/color][/center]**`, data.roll, [], tags);
  }
  else {
    // Add 1 failure
    numFailures += 1;
    valuesToSet['data.deathSaveFailures'] = numFailures;
    api.sendMessage(`**[center][color=red]FAILURE[/color][/center]**`, data.roll, [], tags);
  }

  api.setValues(valuesToSet);

  // If 3 failures add "Dead" effect to character

  if (numFailures >= 3) {
    const tokenForRecord = api.getToken();
    if (tokenForRecord) {
      api.addEffect('Dead', tokenForRecord);
    }
  }
});

