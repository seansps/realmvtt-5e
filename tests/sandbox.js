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
  getOtherTokens: () => [],
  getSelectedOrDroppedToken: () => [],
  promptRollForToken: () => {},
  removeEffectById: () => {},
  playAnimation: () => {},
  richTextToMarkdown: (v) => v || "",
};

function createSandbox() {
  // Each sandbox gets its own api stub object so a test that overrides a method
  // can't leak into another sandbox.
  const sandbox = {
    api: { ...api },
    record: { data: {}, fields: {}, type: "characters", _id: "test" },
    console,
    dataPath: "",
    assetUrl: "https://assets.test/",
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
