const rollName = data?.roll?.metadata?.rollName;
const tooltip = data?.roll?.metadata?.tooltip;
const minRoll = data?.roll?.metadata?.minRoll;

// Find the unddropped d20, and if minroll is set
// alter the actual roll to be the minroll if it's lower
const roll = {
  ...data.roll,
  dice: [...(data?.roll?.dice || [])],
  total: data?.roll?.total !== undefined ? data?.roll?.total : 0
}

if (roll.dice) {
  roll.dice = roll.dice.map(d => {
    let value = parseInt(d.value, 10);
    if (d.type === 20 && d.reason !== 'dropped') {
      if (minRoll && value < minRoll) {
        roll.total += (minRoll - value);
        value = minRoll;
      }
    }
    return {
      ...d,
      value: value
    };
  });
}

let message = '';

let dc = 0;
dc = parseInt(data?.roll?.metadata?.dc || '0', 10);
if (isNaN(dc)) {
  dc = 0;
}
if (dc > 0) {
  const total = roll.total;
  if (total >= dc) {
    message = `**[center][color=green]SUCCESS[/color] [gm]vs DC ${dc}[/gm][/center]**`
  }
  else {
    // Here we need to remove the Concentration effect.
    const effects = record?.effects || [];
    const concentrationEffect = effects.find(effect => effect.name === 'Concentration');
    let oldSpellName = '';
    if (concentrationEffect) {
      const tokenForRecord = api.getToken();
      const oldValues = tokenForRecord?.effectValues || {};
      if (oldValues[concentrationEffect?._id]) {
        oldSpellName = oldValues[concentrationEffect?._id];
      }
      lostConcentrationOn = oldSpellName;
      api.removeEffectById(concentrationEffect._id, tokenForRecord);
    }
    message = `**[center][color=red]FAILURE[/color] [gm]vs DC ${dc}[/gm][/center]**`
    if (oldSpellName) {
      message += `\n\n[center]Lost concentration on ${oldSpellName}.[/center]`;
    }
  }
}

api.sendMessage(message, roll, [], [{
  name: rollName || "Save",
  tooltip: tooltip || `${rollName || ""} Saving Throw`
}]);