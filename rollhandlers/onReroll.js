const { roll, record } = data;
const metadata = roll?.metadata;
const recordId = metadata?.recordId;
const recordType = metadata?.recordType;

if (recordType && recordId) {
  // Check if we have heroic inspiration
  const inspiration = record.data?.inspiration;
  if (inspiration === "true") {
    api.setValuesOnRecord(record, { "data.inspiration": "false" });
    return {
      success: true,
    };
  } else {
    api.showNotification(
      "You do not have heroic inspiration.",
      "red",
      "No Inspiration"
    );
    return {
      success: false,
    };
  }
} else {
  return {
    success: true,
  };
}
