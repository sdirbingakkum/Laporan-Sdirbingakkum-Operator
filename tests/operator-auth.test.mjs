import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_POMDAMS } from "../src/data/pomdams.ts";
import {
  isPuspomadOperatorContext,
  operatorEmail,
  operatorLoginEmails,
  resolveAuthorizedOperator,
  resolveRestoredOperator,
  PUSPOMAD_OPERATOR_EMAIL,
} from "../src/lib/operator-auth.ts";

const pomdam = ACTIVE_POMDAMS.find((item) => item.code === "IM");
assert.ok(pomdam);

const localAccess = {
  authenticated: true,
  configured: true,
  role: { code: "POMDAM_OPERATOR" },
  scope: { type: "POMDAM", pomdam_ids: [pomdam.id] },
  capabilities: ["MANAGE_REPORT_DATA", "VIEW_REPORTS"],
};

const globalAccess = {
  authenticated: true,
  configured: true,
  role: { code: "PUSPOMAD_OPERATOR" },
  scope: { type: "ALL_POMDAM", pomdam_ids: [] },
  capabilities: ["MANAGE_REPORT_DATA", "VIEW_REPORTS"],
};

test("normalizes Pomdam code to the existing operator identity convention", () => {
  assert.equal(operatorEmail("IM"), "operator_im@puspomad.mil.id");
  assert.equal(operatorEmail("I/BB"), "operator_i_bb@puspomad.mil.id");
  assert.deepEqual(operatorLoginEmails("IM"), [
    "operator_im@puspomad.mil.id",
    PUSPOMAD_OPERATOR_EMAIL,
  ]);
});

test("accepts a Pomdam operator only for its configured Pomdam and role capability", () => {
  const result = resolveAuthorizedOperator(
    localAccess,
    "operator_im@puspomad.mil.id",
    pomdam.id,
  );
  assert.equal(result?.roleCode, "POMDAM_OPERATOR");
  assert.equal(result?.pomdam.id, pomdam.id);
});

test("rejects a Pomdam operator when the selected Pomdam is outside its scope", () => {
  const otherPomdam = ACTIVE_POMDAMS.find((item) => item.code === "I/BB");
  assert.ok(otherPomdam);
  assert.equal(
    resolveAuthorizedOperator(localAccess, "operator_im@puspomad.mil.id", otherPomdam.id),
    null,
  );
});

test("rejects mismatched identity, missing capability, and unconfigured sessions", () => {
  assert.equal(resolveAuthorizedOperator(localAccess, "operator_i_bb@puspomad.mil.id", pomdam.id), null);
  assert.equal(
    resolveAuthorizedOperator(
      { ...localAccess, capabilities: ["VIEW_REPORTS"] },
      "operator_im@puspomad.mil.id",
      pomdam.id,
    ),
    null,
  );
  assert.equal(
    resolveAuthorizedOperator(
      { ...localAccess, configured: false },
      "operator_im@puspomad.mil.id",
      pomdam.id,
    ),
    null,
  );
});

test("allows a Puspomad-wide operator only with the all-Pomdam role and capability", () => {
  assert.equal(isPuspomadOperatorContext(globalAccess, PUSPOMAD_OPERATOR_EMAIL), true);
  const result = resolveAuthorizedOperator(globalAccess, PUSPOMAD_OPERATOR_EMAIL, pomdam.id);
  assert.equal(result?.roleCode, "PUSPOMAD_OPERATOR");
  assert.equal(result?.pomdam.id, pomdam.id);
  assert.equal(isPuspomadOperatorContext(globalAccess, "operator_im@puspomad.mil.id"), false);
  assert.equal(
    resolveAuthorizedOperator(
      { ...globalAccess, scope: { type: "POMDAM", pomdam_ids: [] } },
      PUSPOMAD_OPERATOR_EMAIL,
      pomdam.id,
    ),
    null,
  );
});

test("restores a local operator from its single database scope", () => {
  const result = resolveRestoredOperator(localAccess, "operator_im@puspomad.mil.id", null);
  assert.equal(result?.pomdam.id, pomdam.id);
});

test("restores a Puspomad-wide operator only when a valid Pomdam selection was remembered", () => {
  assert.equal(resolveRestoredOperator(globalAccess, PUSPOMAD_OPERATOR_EMAIL, null), null);
  assert.equal(
    resolveRestoredOperator(globalAccess, PUSPOMAD_OPERATOR_EMAIL, pomdam.id)?.pomdam.id,
    pomdam.id,
  );
});
