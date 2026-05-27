// On Encounter End, we want tally the XP for all NPC tokens that were enemies.
// PCs/characters can carry the enemy faction in mind-control / charm scenarios
// but they shouldn't contribute XP — only count NPC records.
const enemies = (data?.tokens || []).filter(
  (t) => t?.faction === "enemy" && t?.recordType === "npcs",
);
const xp = enemies.reduce((acc, token) => {
  // xp may be stored as a number or a string ("1,800" / "1,800 or 2,300 in lair").
  // Coerce to string before running any string-shape parsing.
  const xpString = String(token?.data?.xp ?? "0");
  let xpValue;

  if (token?.data?.inLair === true && xpString.includes("in lair")) {
    // Extract the "in lair" XP value if token is in lair
    const match = xpString.match(/or\s*([\d,]+)\s*in lair/);
    xpValue = match ? match[1].replace(/,/g, "") : xpString.replace(/,/g, "");
  } else {
    // Use the first number if not in lair or no "in lair" value exists
    xpValue = xpString.split(",or")[0].replace(/,/g, "");
  }

  const parsed = parseInt(xpValue, 10);
  return acc + (isNaN(parsed) ? 0 : parsed);
}, 0);

// Here is a macro to award the XP to the player
let macro = "";
if (enemies.length > 0) {
  macro = `\`\`\`Award_XP
if (isGM) {
  api.awardExp(${xp}, 'Encounter with ${enemies.length} enemies.');
  api.broadcast('xp-awarded', { amount: ${xp}, source: 'encounter' });
  api.editMessage(null, 'Awarded ${xp} XP to the Party.');
}
\`\`\`
`;

  api.sendMessage(
    `[center]Encounter Ended - Total XP: ${xp}[/center]\n${macro}`
  );
}
