// Regenerates vectors.json from colormapping_ref.c with gcc. The committed
// JSON is what the tests read, so a machine without a compiler still runs the
// suite; run this (`npm run reference`) after touching the C.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = __dirname;
const build = path.join(dir, ".build");
fs.mkdirSync(build, { recursive: true });
const exe = path.join(build, process.platform === "win32" ? "colormapping_ref.exe" : "colormapping_ref");

// -ffp-contract=off: no fused multiply-adds, so each operation rounds as written.
const cc = spawnSync(
  process.env.CC ?? "gcc",
  ["-O2", "-std=c11", "-ffp-contract=off", "-Wall", "-Wno-sign-compare", path.join(dir, "colormapping_ref.c"), "-o", exe, "-lm"],
  { stdio: "inherit" },
);
if (cc.error || cc.status !== 0) {
  console.error("gcc is required to regenerate vectors.json (the committed file still serves the tests)");
  process.exit(2);
}

const run = spawnSync(exe, [], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(run.status ?? 1);
}
JSON.parse(run.stdout);
fs.writeFileSync(path.join(dir, "vectors.json"), run.stdout);
console.log(`wrote ${path.join(dir, "vectors.json")} (${run.stdout.length} bytes)`);
