import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_POMDAMS } from "../src/data/pomdams.ts";
import {
  operatorEmail,
  operatorUsername,
  pomdamFromOperatorUsername,
  resolveAuthorizedOperator,
  resolveRestoredOperator,
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

test("creates the requested username from the Pomdam code", () => {
  assert.equal(operatorUsername("IM"), "operator_im");
  assert.equal(operatorUsername("I/BB"), "operator_i_bb");
  assert.equal(operatorEmail("IM"), "operator_im@puspomad.mil.id");
});

test("resolves a username to the matching Pomdam, including the email alias", () => {
  assert.equal(pomdamFromOperatorUsername("operator_im")?.id, pomdam.id);
  assert.equal(pomdamFromOperatorUsername(" OPERATOR_IM ")?.id, pomdam.id);
  assert.equal(pomdamFromOperatorUsername("operator_im@puspomad.mil.id")?.id, pomdam.id);
  assert.equal(pomdamFromOperatorUsername("operator_unknown"), null);
});

test("accepts a local operator only for its own Pomdam and required capability", () => {
  const result = resolveAuthorizedOperator(
    localAccess,
    "operator_im@puspomad.mil.id",
    pomdam.id,
  );
  assert.equal(result?.roleCode, "POMDAM_OPERATOR");
  assert.equal(result?.username, "operator_im");
  assert.equal(result?.pomdam.id, pomdam.id);
});

test("rejects a local operator for a different Pomdam", () => {
  const otherPomdam = ACTIVE_POMDAMS.find((item) => item.code === "I/BB");
  assert.ok(otherPomdam);
  assert.equal(
    resolveAuthorizedOperator(localAccess, "operator_im@puspomad.mil.id", otherPomdam.id),
    null,
  );
});

test("rejects incorrect identity, missing capability, or unconfigured access", () => {
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

test("rejects commander and global Puspomad roles from the operator portal", () => {
  assert.equal(
    resolveAuthorizedOperator(
      {
        ...localAccess,
        role: { code: "PUSPOMAD_OPERATOR" },
        scope: { type: "ALL_POMDAM", pomdam_ids: [] },
      },
      "operator@puspomad.mil.id",
      pomdam.id,
    ),
    null,
  );
  assert.equal(
    resolveAuthorizedOperator(
      { ...localAccess, role: { code: "POMDAM_COMMANDER" } },
      "danpomdam_im@puspomad.mil.id",
      pomdam.id,
    ),
    null,
  );
});

test("restores only an operator session with exactly one Pomdam scope", () => {
  const result = resolveRestoredOperator(localAccess, "operator_im@puspomad.mil.id");
  assert.equal(result?.pomdam.id, pomdam.id);
  assert.equal(
    resolveRestoredOperator(
      { ...localAccess, scope: { type: "POMDAM", pomdam_ids: [pomdam.id, pomdam.id] } },
      "operator_im@puspomad.mil.id",
    ),
    result,
  );
  assert.equal(
    resolveRestoredOperator(
      { ...localAccess, scope: { type: "ALL_POMDAM", pomdam_ids: [] } },
      "operator_im@puspomad.mil.id",
    ),
    null,
  );
});
