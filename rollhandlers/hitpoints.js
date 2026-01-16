// Here we update the character that rolled with the result
// And update the hpByLevelMap at record?.data?.hpByLevel
const className = data?.roll?.metadata?.className;
const totalLevel = data?.roll?.metadata?.totalLevel;
const newHitDie = data?.roll?.metadata?.newHitDie;
const newHp = data?.roll?.total;

const recordId = record?._id;
const recordType = record?.recordType;

if (className && totalLevel && newHitDie && newHp && recordId && recordType) {
  // Requery the record to get the latest data
  api.getRecord(recordType, recordId, (freshRecord) => {
    const hpByLevel = JSON.parse(freshRecord?.data?.hpByLevel || "[]");

    const valuesToSet = {};

    // Set hpByLevel map
    hpByLevel.push({
      className: className,
      level: totalLevel,
      hitDie: newHitDie,
      hp: newHp,
    });

    valuesToSet[`data.hpByLevel`] = JSON.stringify(hpByLevel);

    // Set the individual hpLevel field for this level
    valuesToSet[`data.hpLevel${totalLevel}`] = newHp;

    // Add a hitdie
    const hitDieField = `data.${newHitDie}HitDie`;
    const numHitDie = parseInt(freshRecord?.data?.[hitDieField] || "0", 10);
    valuesToSet[hitDieField] = numHitDie + 1;

    // Set hpByLevel and hitDie, then recalc total HP
    api.setValues(valuesToSet, (recordUpdated) => {
      // Send a Message
      const conMod = parseInt(recordUpdated?.data?.constitutionMod || "0", 10);

      // Deduplicate hpByLevel in case of re-rolls
      let hpByLevelArr = JSON.parse(recordUpdated?.data?.hpByLevel || "[]");
      const { deduplicated, hasChanges } = deduplicateHpByLevel(hpByLevelArr);

      if (hasChanges) {
        hpByLevelArr = deduplicated;
        // We'll include this in the next setValues call
      }

      const newValuesToSet = {};

      // Update hpByLevel if we deduplicated
      if (hasChanges) {
        newValuesToSet[`data.hpByLevel`] = JSON.stringify(hpByLevelArr);
      }

      // Update hpByLevel fields FIRST before calculating HP
      setHpPerLevel(recordUpdated, newValuesToSet);

      // Now calculate the new HP max after the individual fields are set
      const newHpMax = getHpForLevel(conMod, recordUpdated);

      const newHpDiff = newHpMax - (recordUpdated?.data?.hitpoints || 0);

      newValuesToSet[`data.hitpoints`] = newHpMax;
      newValuesToSet[`data.curhp`] =
        (recordUpdated?.data?.curhp || 0) + newHpDiff;

      api.setValues(newValuesToSet);

      const characterName = freshRecord?.name || "New Character";
      api.sendMessage(
        `Added 1 Level of ${className} to ${characterName}.\n\n[color=green]New Hit Point Total:[/color] ${newHpMax}`,
        data.roll,
        [],
        []
      );
    });
  });
}
