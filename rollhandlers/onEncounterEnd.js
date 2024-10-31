// On Encounter End, we want tally the XP for all tokens that were enemies
const enemies = (data?.tokens || []).filter(t => t?.faction === 'enemy');
const xp = enemies.reduce((acc, token) => acc + (parseInt(token?.data?.xp || '0', 10)), 0);

// Here is a macro to award the XP to the player
let macro = '';
if (enemies.length > 0) {
  macro = `\`\`\`Award_XP
if (isGM) {
  api.awardExp(${xp}, 'Encounter with ${enemies.length} enemies.');
  api.editMessage(null, 'Awarded ${xp} XP to the Party.');
}
\`\`\`
`;

  api.sendMessage(`[center]Encounter Ended - Total XP: ${xp}[/center]\n${macro}`);
}