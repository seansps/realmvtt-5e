// Shared sandbox setup for loading rollhandler scripts in a VM context
const fs = require("fs");
const vm = require("vm");

const rollhandlersDir = __dirname + "/../rollhandlers";

// Stubs for globals that rollhandler scripts reference
const api = {
  getValue: () => null,
  setValue: () => {},
  setValues: () => {},
  getRecord: () => {},
  showNotification: () => {},
  showPrompt: () => {},
  sendMessage: () => {},
  getSetting: () => null,
  getTargets: () => [],
  getToken: () => null,
  getSelectedTokens: () => [],
  roll: () => {},
  promptRoll: () => {},
  rollInstant: () => ({ total: 0 }),
  getDistance: () => 5,
  addEffect: () => {},
  floatText: () => {},
  openRecord: () => {},
  addValue: () => {},
  removeValue: () => {},
  setHidden: () => {},
};

function createSandbox() {
  const record = { data: {}, fields: {}, type: "characters", _id: "test" };
  const sandbox = {
    api,
    record,
    console,
    dataPath: "",
    getNearestParentDataPath: () => "",
  };
  const ctx = vm.createContext(sandbox);

  // Load common.js (required by all other rollhandler scripts)
  const commonCode = fs.readFileSync(rollhandlersDir + "/common.js", "utf8");
  new vm.Script(commonCode, { filename: "common.js" }).runInContext(ctx);

  return ctx;
}

function loadScript(ctx, filename) {
  const code = fs.readFileSync(rollhandlersDir + "/" + filename, "utf8");
  new vm.Script(code, { filename }).runInContext(ctx);
}

module.exports = { createSandbox, loadScript };
