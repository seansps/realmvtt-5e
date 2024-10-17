function doubleDamageDice(damage) {
  return damage.replace(/(\d+)?d(\d+)/g, (match, n, d) => {
    n = n ? parseInt(n) * 2 : 2; // If n is undefined, it means 1d, so we use 2
    return `${n}d${d}`;
  });
}

// Here we need to determine if it was a hit or miss and display in the chat.
const rollName = data?.roll?.metadata?.rollName;
const attack = data?.roll?.metadata?.attack;
const targetName = data?.roll?.metadata?.targetName;
const tooltip = data?.roll?.metadata?.tooltip;
const damageModifiers = data?.roll?.metadata?.damageModifiers || [];
const icon = data?.roll?.metadata?.icon;
let damage = data?.roll?.metadata?.damage;

const isCritical = data?.roll?.total - data?.roll?.modifier >= 20; // Should never be > 20, but just in case
const isMiss = data?.roll?.total - data?.roll?.modifier <= 1; // Should never be < 1, but just in case

let message = '';

let dc = 0;
dc = parseInt(data?.roll?.metadata?.dc || '0', 10);
if (isNaN(dc)) {
  dc = 0;
}
if (dc > 0) {
  const total = data?.roll?.total || 0;
  if (isCritical) {
    message = `[center]${icon ? `:${icon}:` : ''} ${attack} :IconTargetArrow: ${targetName}[/center]\n\n**[center][color=green]CRITICAL HIT[/color] [gm](vs AC ${dc})[/gm][/center]**
  `
    // If damage was defined, we need to double the dice 
    if (damage) {
      damage = doubleDamageDice(damage);
    }
  }
  else if (isMiss) {
    message = `[center]${icon ? `:${icon}:` : ''} ${attack} :IconTargetArrow: ${targetName}[/center]\n\n**[center][color=red]AUTOMATIC MISS[/color] [gm](vs AC ${dc})[/gm][/center]**`
  }
  else if (total >= dc) {
    message = `[center]${icon ? `:${icon}:` : ''} ${attack} :IconTargetArrow: ${targetName}[/center]\n\n**[center][color=green]HIT[/color] [gm](vs AC ${dc})[/gm][/center]**`
  }
  else {
    message = `[center]${icon ? `:${icon}:` : ''} ${attack} :IconTargetArrow: ${targetName}[/center]\n\n**[center][color=red]MISS[/color] [gm](vs AC ${dc})[/gm][/center]**`
  }
}
else {
  message = `[center]${icon ? `:${icon}:` : ''} ${attack} :IconTargetArrow: ${targetName}[/center]`
}

const tags = [{
  name: rollName || "Attack",
  tooltip: tooltip || "Attack Roll"
}];

// Add damage button to message
const damageButton = damage ? `\`\`\`Roll_Damage
api.promptRoll('${attack} Damage', '${damage}', ${JSON.stringify(damageModifiers)}, {}, 'damage')
\`\`\`` : '';

message = `
${message}

${damageButton}
`;

api.sendMessage(message, data.roll, [], tags);