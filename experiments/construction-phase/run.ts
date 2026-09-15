import assert from "node:assert/strict";
import { join } from "node:path";
import { phaseFixture } from "./fixture";
import {
  capturePhase,
  preparePhase,
  executePhase,
} from "../../src/construction-phase/runner";
import { writeJson } from "../../src/handoff/io";
const f = await phaseFixture({
  host: process.argv.includes("--codex") ? "codex" : "claude",
  twoUnits: true,
  repairs: process.argv.includes("--repairs"),
  integrationRepair: process.argv.includes("--repairs"),
});
await capturePhase(f.project, f.event);
f.approve();
const h = (await preparePhase(f.project, f.event))!;
console.log(
  JSON.stringify({
    run: h.run,
    scope: "construction",
    provider: "mock",
    approval: "synthetic fixture",
  }),
);
const result = await executePhase(f.project, h.id);
writeJson(join(h.run, "experiment-result.json"), result);
console.log(
  JSON.stringify({
    state: result.state,
    steps: result.steps,
    reason: result.reason,
  }),
);
assert.equal(result.state, "verified", result.reason ?? "Construction failed");
