// Item charge recharge — adds the rolled amount to a charged item's remaining
// uses, capped at its Max Uses. Used by magic items with charges (items whose
// "Has Use" is checked but that are not Consumable). The recharge dice value
// (e.g. "1d6") is set on the item's Recharge field and rolled from the
// inventory row's Recharge button (rechargeItem() in inventory-list.html).

const itemDataPath = data?.roll?.metadata?.itemDataPath;
const itemName = data?.roll?.metadata?.itemName || "Item";
const maxUses = parseInt(data?.roll?.metadata?.maxUses, 10);
const recordId = record?._id;
const recordType = record?.recordType || "characters";
const rolled = parseInt(data?.roll?.total, 10) || 0;

// Walk a dot-notation path to the item within the record
const getByPath = (obj, path) =>
  (path || "")
    .split(".")
    .reduce((o, k) => (o == null ? o : o[k]), obj);

if (!itemDataPath || isNaN(maxUses) || maxUses <= 0 || !recordId) {
  api.sendMessage(`**${itemName}** could not be recharged.`, data.roll, [], []);
} else {
  // Requery the record for the freshest uses value
  api.getRecord(recordType, recordId, (rec) => {
    const item = getByPath(rec, itemDataPath);
    const current = parseInt(item?.data?.usesRemaining, 10) || 0;
    const newUses = Math.max(0, Math.min(maxUses, current + rolled));

    api.setValues({
      [`${itemDataPath}.data.usesRemaining`]: newUses,
    });

    const tags = [{ name: "Recharge", tooltip: "Item Recharge" }];
    const message = `**${itemName}** recharges ${rolled} (${current} → ${newUses}/${maxUses}).`;
    api.sendMessage(message, data.roll, [], tags);
  });
}
