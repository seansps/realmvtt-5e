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

// ===== Item spells =====
// The import script stashes each item's DDB spells on it as data.ddbItemSpells
// ({ name, data } with castLevel/charges set). Resolve them into the item's
// data.itemSpells: copy the compendium spell when one exists (keeping DDB's cast
// level and charge cost), otherwise add a placeholder built from the DDB data.
// Spells the matched compendium item already lists are left as they are.
function lookupSpell(name, callback) {
  api.getRecordByTypeAndName("spells", name, function (found) {
    if (found) {
      callback(found);
      return;
    }
    var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    api.getRecordsByQuery(
      "spells",
      { name: { $regex: "^" + escaped + "$", $options: "i" } },
      function (results) {
        callback(results && results.length > 0 ? results[0] : null);
      },
      1,
    );
  });
}

var processedItemSpellIds = {};
function processItemSpells(currentRec, done) {
  var inventory = currentRec?.data?.inventory || [];
  // Tracked by item _id so a callback record that still shows the stash can't
  // send us around the same item twice.
  var itemIdx = inventory.findIndex(function (item) {
    return (
      (item?.data?.ddbItemSpells || []).length > 0 &&
      !processedItemSpellIds[item._id]
    );
  });
  if (itemIdx === -1) {
    done(currentRec);
    return;
  }

  var item = inventory[itemIdx];
  processedItemSpellIds[item._id] = true;
  var pending = item.data.ddbItemSpells;
  var itemSpells = (item.data.itemSpells || []).slice();
  var haveNames = {};
  itemSpells.forEach(function (sp) {
    if (sp?.name) haveNames[sp.name.toLowerCase()] = true;
  });

  var sIdx = 0;
  function nextSpell() {
    if (sIdx >= pending.length) {
      var prefix = "data.inventory." + itemIdx;
      var valuesToSet = {};
      valuesToSet[prefix + ".data.itemSpells"] = itemSpells;
      valuesToSet[prefix + ".data.ddbItemSpells"] = null;
      valuesToSet[prefix + ".tabs.Spells.hidden"] = false;
      valuesToSet[prefix + ".fields.hasSpells.hidden"] = false;
      if (item.data.hasUseBtn) {
        valuesToSet[prefix + ".fields.usesRemaining.hidden"] = false;
        valuesToSet[prefix + ".fields.maxUses.hidden"] = false;
        valuesToSet[prefix + ".fields.recharge.hidden"] = false;
      }
      api.setValues(valuesToSet, function (r) {
        processItemSpells(r, done);
      });
      return;
    }

    var entry = pending[sIdx++];
    if (!entry?.name || haveNames[entry.name.toLowerCase()]) {
      nextSpell();
      return;
    }
    haveNames[entry.name.toLowerCase()] = true;

    lookupSpell(entry.name, function (found) {
      if (found) {
        itemSpells.push({
          ...found,
          _id: generateId(),
          data: {
            ...(found.data || {}),
            castLevel: entry.data.castLevel,
            charges: entry.data.charges,
          },
        });
      } else {
        itemSpells.push({
          _id: generateId(),
          name: entry.name,
          unidentifiedName: entry.name,
          recordType: "spells",
          identified: true,
          data: entry.data,
        });
      }
      nextSpell();
    });
  }
  nextSpell();
}

// Kick off processing: item spells first, then ability groups, one at a time so
// their writes don't race on the same record.
processItemSpells(record, function (rec) {
  processNextGroup(rec);
});
