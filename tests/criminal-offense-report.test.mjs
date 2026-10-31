import assert from "node:assert/strict";
import test from "node:test";
import {
  countCriminalOffenseReported,
  criminalOffenseInputCode,
  getCriminalOffenseInvalidCodes,
  getCriminalOffenseTotal,
  isValidCriminalOffenseValue,
} from "../src/lib/criminal-offense-report.ts";

test("criminal-offense input keys are unique by offense version and personnel category", () => {
  assert.notEqual(
    criminalOffenseInputCode("version-1", "PA"),
    criminalOffenseInputCode("version-1", "BA"),
  );
  assert.notEqual(
    criminalOffenseInputCode("version-1", "PA"),
    criminalOffenseInputCode("version-2", "PA"),
  );
});

test("blank cells remain unreported while literal zero is valid", () => {
  const values = { a: "", b: "0", c: "12" };
  assert.equal(countCriminalOffenseReported(values, ["a", "b", "c"]), 2);
  assert.equal(getCriminalOffenseTotal(values, ["a", "b", "c"]), null);
  assert.equal(isValidCriminalOffenseValue("0"), true);
});

test("totals are calculated only when every cell is a valid integer", () => {
  assert.equal(getCriminalOffenseTotal({ a: "0", b: "7", c: "3" }, ["a", "b", "c"]), 10);
  assert.equal(getCriminalOffenseTotal({ a: "4", b: "" }, ["a", "b"]), null);
});

test("negative, decimal, and unsafe integer inputs are rejected", () => {
  assert.equal(isValidCriminalOffenseValue("-1"), false);
  assert.equal(isValidCriminalOffenseValue("1.5"), false);
  assert.equal(isValidCriminalOffenseValue("9007199254740992"), false);
  assert.deepEqual(
    getCriminalOffenseInvalidCodes({ a: "-2", b: "1.5", c: "" }, ["a", "b", "c"]),
    ["a", "b"],
  );
});
