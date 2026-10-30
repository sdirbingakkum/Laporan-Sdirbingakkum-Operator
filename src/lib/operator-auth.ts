import { ACTIVE_POMDAMS, type Pomdam } from "../data/pomdams.ts";

export type AccessContext = {
  authenticated?: boolean;
  configured?: boolean;
  role?: { code?: string; display_name?: string } | null;
  scope?: { type?: string; pomdam_ids?: string[] };
  capabilities?: string[];
};

export type ActiveOperator = {
  pomdam: Pomdam;
  email: string;
  roleCode: "POMDAM_OPERATOR" | "PUSPOMAD_OPERATOR";
};

export const PUSPOMAD_OPERATOR_EMAIL = "operator@puspomad.mil.id";
export const SELECTED_POMDAM_STORAGE_KEY = "laporan-sdirbingakkum.operator-pomdam";

function hasReportManagementAccess(access: AccessContext): boolean {
  return Boolean(
    access.authenticated &&
    access.configured &&
    access.capabilities?.includes("MANAGE_REPORT_DATA"),
  );
}

export function operatorEmail(code: string): string {
  const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `operator_${slug}@puspomad.mil.id`;
}

export function operatorLoginEmails(code: string): string[] {
  return [operatorEmail(code), PUSPOMAD_OPERATOR_EMAIL];
}

export function isPuspomadOperatorContext(
  access: AccessContext,
  email: string | null | undefined,
): boolean {
  return Boolean(
    hasReportManagementAccess(access) &&
    access.role?.code === "PUSPOMAD_OPERATOR" &&
    access.scope?.type === "ALL_POMDAM" &&
    email?.trim().toLowerCase() === PUSPOMAD_OPERATOR_EMAIL,
  );
}

export function resolveAuthorizedOperator(
  access: AccessContext,
  email: string | null | undefined,
  expectedPomdamId: string,
): ActiveOperator | null {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail || !hasReportManagementAccess(access)) return null;

  const pomdam = ACTIVE_POMDAMS.find((item) => item.id === expectedPomdamId);
  if (!pomdam) return null;

  if (
    access.role?.code === "POMDAM_OPERATOR" &&
    access.scope?.type === "POMDAM"
  ) {
    const allowedPomdamIds = new Set(access.scope.pomdam_ids ?? []);
    if (
      !allowedPomdamIds.has(pomdam.id) ||
      operatorEmail(pomdam.code) !== normalizedEmail
    ) {
      return null;
    }

    return { pomdam, email: normalizedEmail, roleCode: "POMDAM_OPERATOR" };
  }

  if (isPuspomadOperatorContext(access, normalizedEmail)) {
    return { pomdam, email: normalizedEmail, roleCode: "PUSPOMAD_OPERATOR" };
  }

  return null;
}

export function resolveRestoredOperator(
  access: AccessContext,
  email: string | null | undefined,
  rememberedPomdamId: string | null,
): ActiveOperator | null {
  if (
    access.role?.code === "POMDAM_OPERATOR" &&
    access.scope?.type === "POMDAM"
  ) {
    const ids = [...new Set(access.scope.pomdam_ids ?? [])];
    if (ids.length !== 1) return null;
    return resolveAuthorizedOperator(access, email, ids[0]);
  }

  if (isPuspomadOperatorContext(access, email) && rememberedPomdamId) {
    return resolveAuthorizedOperator(access, email, rememberedPomdamId);
  }

  return null;
}
