import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_MODULES } from "../src/data/report-modules.ts";

test("dashboard keeps the six active report types from the database master", () => {
  const activeModules = REPORT_MODULES.filter((module) => module.code !== "K9");
  assert.deepEqual(
    activeModules.map((module) => module.code),
    ["GAKKUM", "LAKA_LALIN", "PELANGGARAN", "PROVOS", "SIM_TNI", "TINDAK_PIDANA"],
  );
});

test("every report menu has a unique code and visible title and description", () => {
  assert.equal(new Set(REPORT_MODULES.map((module) => module.code)).size, REPORT_MODULES.length);
  for (const module of REPORT_MODULES) {
    assert.ok(module.title.trim().length > 0);
    assert.ok(module.description.trim().length > 0);
  }
});

test("K9 exists only as a preparation menu until an official database contract exists", () => {
  const k9 = REPORT_MODULES.find((module) => module.code === "K9");
  assert.ok(k9);
  assert.match(k9.description, /menunggu kontrak data dan master input resmi/i);
});
