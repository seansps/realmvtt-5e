#!/usr/bin/env node
// Run all test suites
// Usage: node tests/run-all.js

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const testsDir = __dirname;
const testFiles = fs
  .readdirSync(testsDir)
  .filter((f) => f.startsWith("test-") && f.endsWith(".js") && f !== "test-helpers.js")
  .sort();

let allPassed = true;

console.log(`Running ${testFiles.length} test suite(s)...\n`);

for (const file of testFiles) {
  const filePath = path.join(testsDir, file);
  console.log(`${"═".repeat(50)}`);
  console.log(`  ${file}`);
  console.log(`${"═".repeat(50)}`);
  try {
    const output = execSync(`node "${filePath}"`, { encoding: "utf8" });
    process.stdout.write(output);
  } catch (err) {
    process.stdout.write(err.stdout || "");
    process.stderr.write(err.stderr || "");
    allPassed = false;
  }
  console.log("");
}

console.log(`${"═".repeat(50)}`);
if (allPassed) {
  console.log("  All test suites passed!");
} else {
  console.log("  Some test suites FAILED");
  process.exit(1);
}
