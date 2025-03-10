// Apply damage
// Ignore negative healing as that is what damage is for
// This script ignores tempHp, as it is not a factor in healing
if (value > 0) {
  var curhp = record.data?.curhp || 0;
  curhp += value;
  if (curhp < 0) {
    curhp = 0;
  }
  if (curhp > record.data?.hitpoints) {
    curhp = record.data?.hitpoints;
  }
  api.setValue("data.curhp", curhp);
}

// If healing > 0, float text
const token = api.getToken();
if (value > 0 && token) {
  api.floatText(token, `+${value}`, "#1bc91b");
}
