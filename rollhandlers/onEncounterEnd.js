// On Encounter End, we want tally the XP for all tokens that were enemies
const enemies = (data?.tokens || []).filter((t) => t?.faction === "enemy");
const xp = enemies.reduce((acc, token) => {
  const xpString = token?.data?.xp || "0";
  let xpValue;

  if (token?.data?.inLair === true && xpString.includes("in lair")) {
    // Extract the "in lair" XP value if token is in lair
    const match = xpString.match(/or\s*([\d,]+)\s*in lair/);
    xpValue = match ? match[1].replace(/,/g, "") : xpString.replace(/,/g, "");
  } else {
    // Use the first number if not in lair or no "in lair" value exists
    xpValue = xpString.split(",or")[0].replace(/,/g, "");
  }

  return acc + parseInt(xpValue, 10);
}, 0);

// Here is a macro to award the XP to the player
let macro = "";
if (enemies.length > 0) {
  macro = `\`\`\`Award_XP
if (isGM) {
  api.awardExp(${xp}, 'Encounter with ${enemies.length} enemies.');
  api.editMessage(null, 'Awarded ${xp} XP to the Party.');
}
\`\`\`
`;

  api.sendMessage(
    `[center]Encounter Ended - Total XP: ${xp}[/center]\n${macro}`
  );
}
