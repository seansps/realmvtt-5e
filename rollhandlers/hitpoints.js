// Here we update the character that rolled with the result
// And update the hpByLevelMap at record?.data?.hpByLevel
const className = data?.roll?.metadata?.className;
const newLevel = data?.roll?.metadata?.newLevel;
const newHitDie = data?.roll?.metadata?.newHitDie;
const newHp = data?.roll?.total;

const recordId = record?._id;
const hpByLevel = JSON.parse(record?.data?.hpByLevel || "[]");

if (className && newLevel && newHitDie && newHp && recordId) {
  const valuesToSet = {};

  // Set hpByLevel map
  hpByLevel.push({
    className: className,
    level: newLevel,
    hitDie: newHitDie,
    hp: newHp,
  });

  valuesToSet[`data.hpByLevel`] = JSON.stringify(hpByLevel);

  // Add a hitdie
  const hitDieField = `data.${newHitDie}HitDie`;
  const numHitDie = parseInt(record?.data?.[hitDieField] || "0", 10);
  valuesToSet[hitDieField] = numHitDie + 1;

  // Set hpByLevel and hitDie, then recalc total HP
  api.setValues(valuesToSet, (recordUpdated) => {
    // Send a Message
    const conMod = parseInt(recordUpdated?.data?.constitutionMod || "0", 10);
    const newHpMax = getHpForLevel(conMod, recordUpdated);

    const newHpDiff = newHpMax - (recordUpdated?.data?.hitpoints || 0);

    const newValuesToSet = {
      [`data.hitpoints`]: newHpMax,
      [`data.curhp`]: (recordUpdated?.data?.curhp || 0) + newHpDiff,
    };

    // Update hpByLevel fields
    setHpPerLevel(recordUpdated, newValuesToSet);

    api.setValues(newValuesToSet);

    const characterName = record?.name || "New Character";
    api.sendMessage(
      `Added 1 Level of ${className} to ${characterName}.\n\n[color=green]New Hit Point Total:[/color] ${newHpMax}`,
      data.roll,
      [],
      []
    );
  });
}
