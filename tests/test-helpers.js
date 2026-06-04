// Shared test runner and assertion helpers
// Used by all test files in this directory

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok =
    typeof expected === "object"
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : actual === expected;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertIncludes(label, arr, item) {
  const ok = arr && arr.includes(item);
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected to include: ${JSON.stringify(item)}`);
    console.error(`       actual array: ${JSON.stringify(arr)}`);
    failed++;
  }
}

function assertNotIncludes(label, arr, item) {
  const ok = arr && !arr.includes(item);
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected NOT to include: ${JSON.stringify(item)}`);
    console.error(`       actual array: ${JSON.stringify(arr)}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n${name}`);
}

function summary() {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);
  return failed;
}

module.exports = { assert, assertIncludes, assertNotIncludes, section, summary };
