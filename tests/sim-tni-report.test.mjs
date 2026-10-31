import assert from "node:assert/strict";
import test from "node:test";
import {
  SIM_TNI_ACTIVITY_CODES,
  SIM_TNI_INPUT_CODES,
  SIM_TNI_TYPE_CODES,
  countSimTniReported,
  getSimTniActivityTotal,
  getSimTniInvalidCodes,
  getSimTniTotal,
  getSimTniTypeTotal,
  isValidSimTniValue,
  simTniInputCode,
} from "../src/lib/sim-tni-report.ts";

test("SIM TNI contract creates exactly 25 facts across five activities and five SIM types", () => {
  assert.equal(SIM_TNI_ACTIVITY_CODES.length, 5);
  assert.equal(SIM_TNI_TYPE_CODES.length, 5);
  assert.equal(SIM_TNI_INPUT_CODES.length, 25);
  assert.equal(new Set(SIM_TNI_INPUT_CODES).size, 25);
  assert.equal(simTniInputCode("NEW", "BII_KHUSUS"), "NEW_BII_KHUSUS");
});

test("blank cells are unresolved and explicit zero is a valid reported value", () => {
  const values = Object.fromEntries(SIM_TNI_INPUT_CODES.map((code) => [code, ""]));
  values.NEW_A = "0";
  values.RENEWAL_BI = "2";
  assert.equal(countSimTniReported(values), 2);
  assert.equal(getSimTniInvalidCodes(values).length, 0);
  assert.equal(getSimTniTotal(values), null);
});

test("activity and SIM type totals are calculated from the same 25 atomic facts", () => {
  const values = Object.fromEntries(SIM_TNI_INPUT_CODES.map((code) => [code, "1"]));
  assert.equal(getSimTniActivityTotal(values, "NEW"), 5);
  assert.equal(getSimTniTypeTotal(values, "A"), 5);
  assert.equal(getSimTniTotal(values), 25);
});

test("all five activity totals add to the same grand total as all five SIM types", () => {
  const values = Object.fromEntries(SIM_TNI_INPUT_CODES.map((code, index) => [code, String(index + 1)]));
  const byActivities = SIM_TNI_ACTIVITY_CODES.reduce(
    (sum, activity) => sum + (getSimTniActivityTotal(values, activity) ?? 0),
    0,
  );
  const byTypes = SIM_TNI_TYPE_CODES.reduce(
    (sum, simType) => sum + (getSimTniTypeTotal(values, simType) ?? 0),
    0,
  );
  assert.equal(byActivities, 325);
  assert.equal(byTypes, 325);
  assert.equal(getSimTniTotal(values), 325);
});

test("only non-negative safe integers or blanks are accepted", () => {
  for (const value of ["", "0", "12", "0007"]) assert.equal(isValidSimTniValue(value), true);
  for (const value of ["-1", "1.5", "1e2", "abc", "9007199254740992"]) {
    assert.equal(isValidSimTniValue(value), false);
  }
});

test("invalid inputs identify the exact activity and SIM type cell", () => {
  const values = Object.fromEntries(SIM_TNI_INPUT_CODES.map((code) => [code, "0"]));
  values.TRANSFER_BII_KHUSUS = "-2";
  values.REVOKED_C = "1.25";
  assert.deepEqual(
    getSimTniInvalidCodes(values),
    ["TRANSFER_BII_KHUSUS", "REVOKED_C"],
  );
});
