// Apply damage
// First deduct from Temp HP
let damage = value;
// Ignore negative damage as that is what healing is for
if (damage > 0) {
  const oldTempHp = parseInt(record.data?.tempHp || '0', 10);
  const newTempHp = Math.max(oldTempHp - damage, 0);
  damage = Math.max(damage - oldTempHp, 0);

  if (newTempHp !== oldTempHp) {
    api.setValue("data.tempHp", newTempHp);
  }

  var curhp = parseInt(record.data?.curhp, '0', 10);
  curhp -= damage;
  if (curhp < 0) { curhp = 0; }
  if (curhp > record.data?.hitpoints) { curhp = record.data?.hitpoints; }
  api.setValue("data.curhp", curhp);
}