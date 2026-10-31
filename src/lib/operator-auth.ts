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
  username: string;
  roleCode: "POMDAM_OPERATOR";
};

export function operatorUsername(code: string): string {
  const slug = code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `operator_${slug}`;
}

export function operatorEmail(code: string): string {
  return `${operatorUsername(code)}@puspomad.mil.id`;
}

export function pomdamFromOperatorUsername(value: string): Pomdam | null {
  const normalized = value.trim().toLowerCase().replace(/@puspomad\.mil\.id$/, "");
  return ACTIVE_POMDAMS.find((pomdam) => operatorUsername(pomdam.code) === normalized) ?? null;
}

function hasReportManagementAccess(access: AccessContext): boolean {
  return Boolean(
    access.authenticated &&
    access.configured &&
    access.capabilities?.includes("MANAGE_REPORT_DATA"),
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
    access.role?.code !== "POMDAM_OPERATOR" ||
    access.scope?.type !== "POMDAM"
  ) {
    return null;
  }

  const allowedPomdamIds = new Set(access.scope.pomdam_ids ?? []);
  const username = operatorUsername(pomdam.code);

  if (!allowedPomdamIds.has(pomdam.id) || operatorEmail(pomdam.code) !== normalizedEmail) {
    return null;
  }

  return {
    pomdam,
    email: normalizedEmail,
    username,
    roleCode: "POMDAM_OPERATOR",
  };
}

export function resolveRestoredOperator(
  access: AccessContext,
  email: string | null | undefined,
): ActiveOperator | null {
  if (
    access.role?.code !== "POMDAM_OPERATOR" ||
    access.scope?.type !== "POMDAM"
  ) {
    return null;
  }

  const pomdamIds = [...new Set(access.scope.pomdam_ids ?? [])];
  if (pomdamIds.length !== 1) return null;

  return resolveAuthorizedOperator(access, email, pomdamIds[0]);
}
