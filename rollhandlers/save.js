const rollName = data?.roll?.metadata?.rollName;
const tooltip = data?.roll?.metadata?.tooltip;

let message = '';

let dc = 0;
dc = parseInt(data?.roll?.metadata?.dc || '0', 10);
if (isNaN(dc)) {
  dc = 0;
}
if (dc > 0) {
  const total = data?.roll?.total || 0;
  if (total >= dc) {
    message = `**[center][color=green]SUCCESS[/color] [gm]vs DC ${dc}[/gm][/center]**`
  }
  else {
    message = `**[center][color=red]FAILURE[/color] [gm]vs DC ${dc}[/gm][/center]**`
  }
}

api.sendMessage(message, data.roll, [], [{
  name: rollName || "Save",
  tooltip: tooltip || `${rollName || ""} Saving Throw`
}]);