import assert from "node:assert/strict";
import test from "node:test";
import {
  VIOLATION_GROUPS,
  VIOLATION_REQUIRED_CODES,
  countViolationReported,
  getViolationInvalidCodes,
  getViolationTotal,
  isValidViolationValue,
} from "../src/lib/violation-report.ts";

test("2026 Pelanggaran contract has 17 unique codes split into 11 Tatib and six Lalin", () => {
  assert.equal(VIOLATION_REQUIRED_CODES.length, 17);
  assert.equal(new Set(VIOLATION_REQUIRED_CODES).size, 17);
  assert.deepEqual(VIOLATION_GROUPS.map((group) => group.codes.length), [11, 6]);
});

test("each violation code is captured against four rank groups", () => {
  const fieldCodes = VIOLATION_REQUIRED_CODES.flatMap((code) => ["PA", "BA", "TA", "PNS"].map((rank) => code + "_" + rank));
  assert.equal(fieldCodes.length, 68);
  assert.equal(new Set(fieldCodes).size, 68);

  const formValues = Object.fromEntries(fieldCodes.map((code) => [code, ""]));
  formValues.B1_PA = "0";
  formValues.C6_PNS = "3";
  assert.equal(fieldCodes.filter((code) => (formValues[code] ?? "").trim() !== "").length, 2);
  assert.equal(fieldCodes.filter((code) => !/^\\d+$/.test((formValues[code] ?? "").trim()) && (formValues[code] ?? "").trim() !== "").length, 0);
  formValues.B2_TA = "-1";
  assert.equal(fieldCodes.filter((code) => !/^-?\\d+$/.test((formValues[code] ?? "").trim()) && (formValues[code] ?? "").trim() !== "").length, 1);
});

test("blank values are unreported while zero is a valid reported amount", () => {
  const values = { B1_PA: "", B1_BA: "0", B1_TA: "2" };
  assert.equal(countViolationReported(values), 2);
  assert.equal(getViolationTotal(values, ["B1_PA", "B1_BA", "B1_TA"]), null);
  assert.equal(getViolationTotal({ B1_PA: "0", B1_BA: "0", B1_TA: "2" }, ["B1_PA", "B1_BA", "B1_TA"]), 2);
});

test("Tatib and Lalin group totals remain separate and add to overall total", () => {
  const values = Object.fromEntries(VIOLATION_REQUIRED_CODES.flatMap((code) => ["PA", "BA", "TA", "PNS"].map((rank) => [code + "_" + rank, "1"])));
  const tatibCodes = VIOLATION_GROUPS[0].codes.flatMap((code) => ["PA", "BA", "TA", "PNS"].map((rank) => code + "_" + rank));
  const lalinCodes = VIOLATION_GROUPS[1].codes.flatMap((code) => ["PA", "BA", "TA", "PNS"].map((rank) => code + "_" + rank));
  assert.equal(getViolationTotal(values, tatibCodes), 44);
  assert.equal(getViolationTotal(values, lalinCodes), 24);
  assert.equal(getViolationTotal(values, [...tatibCodes, ...lalinCodes]), 68);
});

test("only non-negative safe integers or blanks are accepted", () => {
  for (const value of ["", "0", "12", "0007"]) assert.equal(isValidViolationValue(value), true);
  for (const value of ["-1", "1.5", "1e2", "abc", "9007199254740992"]) assert.equal(isValidViolationValue(value), false);
});

test("invalid values are reported by exact field code", () => {
  const values = Object.fromEntries(VIOLATION_REQUIRED_CODES.flatMap((code) => ["PA", "BA", "TA", "PNS"].map((rank) => [code + "_" + rank, ""])));
  values.B2_PA = "-5";
  values.C4_PNS = "1.5";
  assert.deepEqual(getViolationInvalidCodes(values), ["B2", "C4"]);
});
