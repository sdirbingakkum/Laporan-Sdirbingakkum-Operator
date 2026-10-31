import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_MODULES } from "../src/data/report-modules.ts";

test("dashboard exposes the six active report types from the database master", () => {
  assert.deepEqual(
    REPORT_MODULES.map((module) => module.code),
    ["GAKKUM", "LAKA_LALIN", "PELANGGARAN", "PROVOS", "SIM_TNI", "TINDAK_PIDANA"],
  );
});

test("every report module has a unique code and a visible title and description", () => {
  assert.equal(new Set(REPORT_MODULES.map((module) => module.code)).size, REPORT_MODULES.length);
  for (const module of REPORT_MODULES) {
    assert.ok(module.title.trim().length > 0);
    assert.ok(module.description.trim().length > 0);
  }
  assert.equal(REPORT_MODULES.some((module) => module.code === "K9"), false);
});
