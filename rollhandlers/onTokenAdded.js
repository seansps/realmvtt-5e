const rollHp = api.getSetting('rollHp') === 'yes';

const hitDice = data?.token?.data?.hitDice;

// If this is an NPC with hitdice and rollHp is enabled, roll for the HP
if (rollHp && hitDice && data?.token?.recordType === 'npcs') {
  const hitPointsRoll = api.rollInstant(hitDice);
  const hitPoints = hitPointsRoll?.total;
  api.setValueOnToken(data?.token, 'data.curhp', hitPoints);
  api.setValueOnToken(data?.token, 'data.hitpoints', hitPoints);
}
