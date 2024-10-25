// Example initiative roll result logic
if (data.roll?.metadata?.group && data.roll?.metadata?.group.length > 0) {
	data.roll?.metadata?.group.forEach(token => {
		api.setValueOnToken(token, 'data.initiative', data.roll.total);
	})
	api.sendMessage("", data.roll, [], [{
		name: "Init",
		tooltip: "Initiative Roll"
	}])
}
else {
	api.setValue('data.initiative', data.roll.total);

	api.sendMessage("", data.roll, [], [{
		name: "Initiative",
		tooltip: "Initiative Roll"
	}])
}