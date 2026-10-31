import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesPomdamLabel,
  parseReportMonth,
} from "../src/lib/excel-template-export.ts";

test("Pomdam aliases match the canonical master without confusing nearby codes", () => {
  assert.equal(matchesPomdamLabel("POMDAM XVI/PTM", "XV/PTM"), true);
  assert.equal(matchesPomdamLabel("POMDAM XX/TB", "XXII/TB"), true);
  assert.equal(matchesPomdamLabel("POMDAM XIV/MT", "XXIV/MT"), true);
  assert.equal(matchesPomdamLabel("POMDAM XX/TIB", "XXII/TB"), false);
  assert.equal(matchesPomdamLabel("POMDAM XXII/TB", "XX/TIB"), false);
});

test("period label mapping uses Indonesian month names and report abbreviations", () => {
  assert.deepEqual(parseReportMonth("2026-10"), {
    year: 2026,
    month: 10,
    name: "OKTOBER",
    shortName: "OKT",
  });
  assert.equal(parseReportMonth("2026-02").shortName, "FEB");
  assert.throws(() => parseReportMonth("2026-13"), /Periode laporan tidak valid/);
});
