import assert from "node:assert/strict";
import test from "node:test";
import {
  GAKKUM_ACTIVITY_GROUPS,
  GAKKUM_REQUIRED_CODES,
  countGakkumReported,
  getGakkumInvalidCodes,
  getGakkumTotal,
  isValidGakkumValue,
} from "../src/lib/gakkum-report.ts";

test("GAKKUM input contract contains 14 unique atomic activity codes", () => {
  assert.equal(GAKKUM_REQUIRED_CODES.length, 14);
  assert.equal(new Set(GAKKUM_REQUIRED_CODES).size, 14);
  assert.equal(GAKKUM_ACTIVITY_GROUPS.length, 5);
});

test("blank values remain unreported and are not converted to zero", () => {
  const values = { PATROLI_BERKENDARAAN: "", PATROLI_KOMBINASI: "0" };
  assert.equal(getGakkumTotal(values, ["PATROLI_BERKENDARAAN", "PATROLI_KOMBINASI"]), null);
  assert.equal(countGakkumReported(values), 1);
});

test("zero is a reported value and contributes to derived totals", () => {
  const values = { PATROLI_BERKENDARAAN: "0", PATROLI_KOMBINASI: "17" };
  assert.equal(getGakkumTotal(values, ["PATROLI_BERKENDARAAN", "PATROLI_KOMBINASI"]), 17);
});

test("all fourteen values are required before the grand total is displayed", () => {
  const complete = Object.fromEntries(GAKKUM_REQUIRED_CODES.map((code) => [code, "1"]));
  assert.equal(getGakkumTotal(complete, GAKKUM_REQUIRED_CODES), 14);
  complete[GAKKUM_REQUIRED_CODES[13]] = "";
  assert.equal(getGakkumTotal(complete, GAKKUM_REQUIRED_CODES), null);
});

test("only non-negative safe integers or blank values are accepted", () => {
  for (const value of ["", "0", "12", "0007"]) assert.equal(isValidGakkumValue(value), true);
  for (const value of ["-1", "1.5", "1e2", "abc", "9007199254740992"]) {
    assert.equal(isValidGakkumValue(value), false);
  }
});

test("validation reports invalid fields without rejecting optional blank fields", () => {
  const values = Object.fromEntries(GAKKUM_REQUIRED_CODES.map((code) => [code, ""]));
  values.PATROLI_BERKENDARAAN = "2";
  values.RAZIA_KENDARAAN_BERMOTOR = "-4";
  assert.deepEqual(getGakkumInvalidCodes(values), ["RAZIA_KENDARAAN_BERMOTOR"]);
});
