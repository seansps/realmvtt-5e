const name = data?.roll?.metadata?.rollName;

let message = '';

let dc = 0;
dc = parseInt(data?.roll?.metadata?.dc || '0', 10);
if (isNaN(dc)) {
  dc = 0;
}
if (dc > 0) {
  const total = data?.roll?.total || 0;
  if (total >= dc) {
    message = `[color=green]Success[/color] [gm]vs DC ${dc}[/gm]`
  }
  else {
    message = `[color=red]Failure[/color] [gm]vs DC ${dc}[/gm]`
  }
}

api.sendMessage(message, data.roll, [], [{
  name: name || "Save",
  tooltip: `${name || ""} Saving Throw`
}]);