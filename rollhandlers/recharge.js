const tokenId = data?.roll?.metadata?.tokenId;
const actionName = data?.roll?.metadata?.actionName;
const effectId = data?.roll?.metadata?.effectId;
const dc = data?.roll?.metadata?.dc;

let message = "";

// First lookup the token

const token = api.getRecord("tokens", tokenId, (token) => {
  // If roll is within the range remove the effect and state in message
  if (data?.roll?.total >= dc) {
    api.removeEffectById(effectId, token);
    message = `${actionName} recharges.`;
    // Find the action in their list with this name
    let group = "actions";
    let groups = ["actions", "bonusActions", "reactions", "legendaryActions"];
    let actionIndex = -1;
    for (const curGroup of groups) {
      const actions = token?.data?.[curGroup] || [];
      if (actionIndex === -1) {
        actionIndex = actions.findIndex((action) =>
          (action?.name || "")
            .toLowerCase()
            .startsWith(actionName.toLowerCase())
        );
      }
      if (actionIndex !== -1) {
        group = curGroup;
        break;
      }
    }
    if (actionIndex !== -1) {
      const action = token?.data?.[group]?.[actionIndex];
      const uses = action.data.uses || 0;
      if (uses > 0) {
        api.setValueOnToken(
          token,
          `data.${group}.${actionIndex}.data.uses`,
          uses - 1
        );
      }
    }
  } else {
    message = `${actionName} does not recharge.`;
  }

  // Send a message
  api.sendMessage(message, data.roll, [], []);
});
