// Post-Import Script for D&D Beyond Character Import
// Runs after the character is created and all pending records (classes, species,
// items, spells, features) are resolved. Sets up ability groups from features
// that have abilityGroupName and ability references.
//
// Available: record (the created character), value (original DDB JSON), api.*

var features = record?.data?.features || [];
var existingGroups = record?.data?.abilityGroups || [];

// Collect ability groups from features
var groupMap = {};
features.forEach(function (feature) {
  var fd = feature?.data || {};
  var groupName = fd.abilityGroupName || "";
  if (!groupName) return;

  if (!groupMap[groupName]) {
    groupMap[groupName] = {
      abilities: [],
      maxDailyUses: 0,
      value: "",
      restoreOn: "",
      savingThrowAbility: "",
      fieldsToAddToUses: [],
    };
  }

  var group = groupMap[groupName];

  // Take the highest maxDailyUses across features in this group
  var uses = parseInt(fd.maxDailyUses || "0", 10);
  if (isNaN(uses)) uses = 0;
  if (uses > group.maxDailyUses) group.maxDailyUses = uses;

  // Take the latest value/restoreOn/savingThrowAbility
  if (fd.value) group.value = fd.value;
  if (fd.restoreOn) group.restoreOn = fd.restoreOn;
  if (fd.savingThrowAbility) group.savingThrowAbility = fd.savingThrowAbility;
  if (fd.fieldsToAddToUses && fd.fieldsToAddToUses.length > 0) {
    group.fieldsToAddToUses = fd.fieldsToAddToUses;
  }

  // Collect ability reference (JSON string like '{"_id":"...","name":"..."}')
  if (fd.ability && fd.ability !== "") {
    group.abilities.push(fd.ability);
  }
});

// Calculate actual maxDailyUses from fieldsToAddToUses (like the 5e ruleset does)
Object.keys(groupMap).forEach(function (groupName) {
  var group = groupMap[groupName];
  if (group.fieldsToAddToUses.length > 0) {
    var total = getTotalValueFromFields(record, group.fieldsToAddToUses, {});
    if (total > group.maxDailyUses) {
      group.maxDailyUses = total;
    }
  }
});

// Process groups sequentially — create group, add abilities, set fields
var groupNames = Object.keys(groupMap);
var gIdx = 0;

function processNextGroup(currentRec) {
  if (gIdx >= groupNames.length) return;

  var groupName = groupNames[gIdx++];
  var group = groupMap[groupName];

  // Skip if this group already exists on the character
  var alreadyExists = (currentRec?.data?.abilityGroups || []).some(function (g) {
    return g?.name === groupName;
  });
  if (alreadyExists) {
    // Still process next
    api.getRecord(
      currentRec.recordType || "characters",
      currentRec._id,
      function (freshRec) {
        processNextGroup(freshRec);
      },
    );
    return;
  }

  // Create the ability group
  var newGroup = {
    name: groupName,
    unidentifiedName: groupName,
    recordType: "records",
    data: {
      abilities: [],
      maxDailyUses: group.maxDailyUses,
      value: group.value,
      restore: group.restoreOn,
      savingThrowAbility: group.savingThrowAbility,
      fieldsToAddToUses: group.fieldsToAddToUses,
    },
    fields: {
      dailyUses: { hidden: group.maxDailyUses <= 0 },
    },
  };

  safeAddValue("data.abilityGroups", newGroup, function (recAfterAdd) {
    // Find the index of the group we just added
    var groupIdx = (recAfterAdd?.data?.abilityGroups || []).findIndex(
      function (g) {
        return g?.name === groupName;
      },
    );
    if (groupIdx === -1) {
      processNextGroup(recAfterAdd);
      return;
    }

    // Add abilities to the group sequentially
    var aIdx = 0;
    function addNextAbility(latestRec) {
      if (aIdx >= group.abilities.length) {
        // Done with this group — set the group fields and move to next
        var groupFields = {};
        if (group.maxDailyUses > 0) {
          groupFields["data.abilityGroups." + groupIdx + ".data.maxDailyUses"] =
            group.maxDailyUses;
          groupFields[
            "data.abilityGroups." + groupIdx + ".fields.dailyUses.hidden"
          ] = false;
        }
        if (group.value) {
          groupFields["data.abilityGroups." + groupIdx + ".data.value"] =
            group.value;
        }
        if (group.restoreOn) {
          groupFields["data.abilityGroups." + groupIdx + ".data.restore"] =
            group.restoreOn;
        }
        if (Object.keys(groupFields).length > 0) {
          api.setValues(groupFields, function (r) {
            processNextGroup(r);
          });
        } else {
          processNextGroup(latestRec);
        }
        return;
      }

      var abilityRefStr = group.abilities[aIdx++];
      var abilityId = "";
      try {
        var parsed = JSON.parse(abilityRefStr);
        abilityId = parsed?._id || "";
      } catch (e) {
        // Not valid JSON
      }

      if (!abilityId) {
        addNextAbility(latestRec);
        return;
      }

      // Check if this ability is already in the group
      var existingAbilities =
        latestRec?.data?.abilityGroups?.[groupIdx]?.data?.abilities || [];
      var alreadyHas = existingAbilities.some(function (a) {
        return a?._id === abilityId;
      });
      if (alreadyHas) {
        addNextAbility(latestRec);
        return;
      }

      // Look up the ability record from the compendium
      api.getRecord("abilities", abilityId, function (abilityRecord) {
        if (!abilityRecord) {
          addNextAbility(latestRec);
          return;
        }
        safeAddValue(
          "data.abilityGroups." + groupIdx + ".data.abilities",
          abilityRecord,
          function (r) {
            addNextAbility(r);
          },
          latestRec,
        );
      });
    }

    addNextAbility(recAfterAdd);
  }, recAfterAdd);
}

// Kick off processing
processNextGroup(record);
