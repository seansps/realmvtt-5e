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
	if (data.roll?.metadata?.token) {
		api.setValueOnToken(data.roll?.metadata?.token, 'data.initiative', data.roll.total);
	}
	else if (data.roll?.metadata?.isCharacter) {
		api.setValue('data.initiative', data.roll.total);
	}

	api.sendMessage("", data.roll, [], [{
		name: "Initiative",
		tooltip: "Initiative Roll"
	}])
}