import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVOS_GROUPS,
  PROVOS_REQUIRED_CODES,
  countProvosReported,
  getProvosInvalidCodes,
  getProvosTotal,
  isValidProvosValue,
} from "../src/lib/provos-report.ts";

test("Provos input contract has seven atomic metrics in three independent domains", () => {
  assert.deepEqual(PROVOS_REQUIRED_CODES, [
    "DSPP", "NYATA", "PA", "BA", "TA", "SUDAH", "BELUM",
  ]);
  assert.deepEqual(PROVOS_GROUPS.map((group) => group.codes.length), [2, 3, 2]);
  assert.equal(new Set(PROVOS_REQUIRED_CODES).size, 7);
});

test("personnel and education totals are derived from atomic values only", () => {
  const values = {
    DSPP: "240",
    NYATA: "210",
    PA: "4",
    BA: "86",
    TA: "120",
    SUDAH: "35",
    BELUM: "175",
  };
  assert.equal(getProvosTotal(values, ["PA", "BA", "TA"]), 210);
  assert.equal(getProvosTotal(values, ["SUDAH", "BELUM"]), 210);
  assert.equal(getProvosTotal(values, ["DSPP", "NYATA"]), 450);
});

test("blank values remain unreported and are never silently converted to zero", () => {
  const values = { DSPP: "", NYATA: "0", PA: "4", BA: "", TA: "0", SUDAH: "", BELUM: "8" };
  assert.equal(countProvosReported(values), 4);
  assert.equal(getProvosTotal(values, ["PA", "BA", "TA"]), null);
  assert.equal(getProvosTotal(values, ["SUDAH", "BELUM"]), null);
  assert.deepEqual(getProvosInvalidCodes(values), []);
});

test("zero is valid while negative, fractional, exponential and unsafe values are rejected", () => {
  for (const value of ["", "0", "12", "0007"]) assert.equal(isValidProvosValue(value), true);
  for (const value of ["-1", "1.5", "1e2", "abc", "9007199254740992"]) {
    assert.equal(isValidProvosValue(value), false);
  }
});

test("invalid field names are reported exactly", () => {
  const values = Object.fromEntries(PROVOS_REQUIRED_CODES.map((code) => [code, ""]));
  values.PA = "-3";
  values.BELUM = "2.5";
  assert.deepEqual(getProvosInvalidCodes(values), ["PA", "BELUM"]);
});

test("the Provos source scope deliberately excludes PNS", () => {
  assert.equal(PROVOS_REQUIRED_CODES.includes("PNS"), false);
  assert.deepEqual(PROVOS_GROUPS.find((group) => group.key === "PERSONNEL")?.codes, ["PA", "BA", "TA"]);
});
