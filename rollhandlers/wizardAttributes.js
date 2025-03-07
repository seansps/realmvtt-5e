const field = data?.roll?.metadata?.field;
const valuesToSet = {};

if (field) {
  valuesToSet[`data.wizard.${field}`] = data?.roll?.total;
  api.setValues(valuesToSet);
}
