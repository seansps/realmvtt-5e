// On the Start of an NPCs Turn, check for any Recharge effects and if the value is within the range, send a message and remove the effect
const token = data?.token;
const effects = token?.effects || [];
const effectValues = token?.effectValues || {};
const rechargeEffect = effects.find(effect => effect?.name?.toLowerCase() === 'recharge');

if (rechargeEffect) {
  const effectValue = effectValues?.[rechargeEffect?._id];
  const actionName = (effectValue || '').split('[')[0].trim();
  let effectDc = '6';
  if (effectValue && effectValue.includes('[')) {
    effectDc = parseInt(effectValue.split('[')[1].trim(), 10);
    if (isNaN(effectDc)) {
      effectDc = '6';
    }
  }

  api.roll('1d6', {
    token: token,
    actionName: actionName,
    effectId: rechargeEffect?._id,
    dc: effectDc
  }, 'recharge');
}

// Update reactions if needed
if (token?.data?.usedReactions) {
  if (token?.data?.usedReactions > 0) {
    api.setValueOnToken(token, 'data.usedReactions', 0);
  }
}