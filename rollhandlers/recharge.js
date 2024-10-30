const token = data?.roll?.metadata?.token;
const actionName = data?.roll?.metadata?.actionName;
const effectId = data?.roll?.metadata?.effectId;
const dc = data?.roll?.metadata?.dc;

let message = '';

// If roll is within the range remove the effect and state in message
if (data?.roll?.total >= dc) {
  api.removeEffectById(effectId, token);
  message = `${actionName} recharges.`;
  // Find the action in their list with this name
  const actions = token?.data?.actions || [];
  const actionIndex = actions.findIndex(action => (action?.name || '').toLowerCase().startsWith(actionName.toLowerCase()));
  if (actionIndex !== -1) {
    const action = actions[actionIndex];
    const uses = action.data.uses || 0;
    if (uses > 0) {
      api.setValueOnToken(token, `data.actions.${actionIndex}.data.uses`, uses - 1);
    }
  }
}
else {
  message = `${actionName} does not recharge.`;
}

// Send a message
api.sendMessage(message, data.roll, [], []);
