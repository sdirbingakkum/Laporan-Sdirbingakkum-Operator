import assert from "node:assert/strict";
import test from "node:test";
import {
  LAKA_FIELD_BINDINGS,
  LAKA_REPORT_GROUPS,
  LAKA_REQUIRED_CODES,
  countLakaReported,
  getLakaInvalidCodes,
  getLakaTotal,
  isValidLakaValue,
} from "../src/lib/laka-report.ts";

test("LAKA input contract contains 18 unique atomic fields mapped to canonical dimensions", () => {
  assert.equal(LAKA_REQUIRED_CODES.length, 18);
  assert.equal(new Set(LAKA_REQUIRED_CODES).size, 18);
  assert.equal(LAKA_FIELD_BINDINGS.length, 18);
  assert.equal(LAKA_REPORT_GROUPS.length, 5);
  assert.equal(LAKA_FIELD_BINDINGS.filter((field) => field.target === "accident").length, 3);
  assert.equal(LAKA_FIELD_BINDINGS.filter((field) => field.target === "material").length, 4);
});

test("all canonical sections have the expected source categories", () => {
  assert.deepEqual(LAKA_REPORT_GROUPS.map((group) => group.codes.length), [3, 4, 4, 3, 4]);
});

test("blank values remain unreported and are not converted to zero", () => {
  const values = { ACC_GANDA: "", ACC_TUNGGAL: "0", ACC_TABRAK_LARI: "2" };
  assert.equal(getLakaTotal(values, LAKA_REPORT_GROUPS[0].codes), null);
  assert.equal(countLakaReported(values), 2);
});

test("zero is a reported value and contributes to derived group totals", () => {
  const values = { ACC_GANDA: "0", ACC_TUNGGAL: "5", ACC_TABRAK_LARI: "2" };
  assert.equal(getLakaTotal(values, LAKA_REPORT_GROUPS[0].codes), 7);
});

test("five derived totals are calculated independently from atomic inputs", () => {
  const values = Object.fromEntries(LAKA_REQUIRED_CODES.map((code) => [code, "1"]));
  assert.equal(getLakaTotal(values, LAKA_REPORT_GROUPS[0].codes), 3);
  assert.equal(getLakaTotal(values, LAKA_REPORT_GROUPS[1].codes), 4);
  assert.equal(getLakaTotal(values, LAKA_REPORT_GROUPS[2].codes), 4);
  assert.equal(getLakaTotal(values, LAKA_REPORT_GROUPS[3].codes), 3);
  assert.equal(getLakaTotal(values, LAKA_REPORT_GROUPS[4].codes), 4);
});

test("only non-negative safe integers or blank values are accepted", () => {
  for (const value of ["", "0", "12", "0007"]) assert.equal(isValidLakaValue(value), true);
  for (const value of ["-1", "1.5", "1e2", "abc", "9007199254740992"]) {
    assert.equal(isValidLakaValue(value), false);
  }
});

test("validation reports negative and malformed values", () => {
  const values = Object.fromEntries(LAKA_REQUIRED_CODES.map((code) => [code, ""]));
  values.ACC_GANDA = "4";
  values.PERSONNEL_TA = "-4";
  values.MATERIAL_RANDIS_RR = "2.5";
  assert.deepEqual(getLakaInvalidCodes(values), ["PERSONNEL_TA", "MATERIAL_RANDIS_RR"]);
});
