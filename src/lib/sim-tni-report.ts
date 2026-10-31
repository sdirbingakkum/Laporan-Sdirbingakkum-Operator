export type SimTniValueMap = Record<string, string>;

export const SIM_TNI_ACTIVITY_CODES = [
  "NEW",
  "RENEWAL",
  "TRANSFER",
  "LOST",
  "REVOKED",
] as const;

export const SIM_TNI_TYPE_CODES = [
  "A",
  "BI",
  "BII",
  "BII_KHUSUS",
  "C",
] as const;

export const SIM_TNI_INPUT_CODES = SIM_TNI_ACTIVITY_CODES.flatMap((activity) =>
  SIM_TNI_TYPE_CODES.map((simType) => activity + "_" + simType),
);

export function simTniInputCode(activityCode: string, simTypeCode: string): string {
  return activityCode + "_" + simTypeCode;
}

export function isValidSimTniValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized === "") return true;
  if (!/^\d+$/.test(normalized)) return false;
  return Number.isSafeInteger(Number(normalized));
}

export function getSimTniInvalidCodes(values: SimTniValueMap): string[] {
  return SIM_TNI_INPUT_CODES.filter((code) => !isValidSimTniValue(values[code] ?? ""));
}

export function countSimTniReported(values: SimTniValueMap): number {
  return SIM_TNI_INPUT_CODES.filter((code) => (values[code] ?? "").trim() !== "").length;
}

export function getSimTniTotal(
  values: SimTniValueMap,
  codes: readonly string[] = SIM_TNI_INPUT_CODES,
): number | null {
  let total = 0;
  for (const code of codes) {
    const raw = (values[code] ?? "").trim();
    if (raw === "" || !isValidSimTniValue(raw)) return null;
    total += Number(raw);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function getSimTniActivityTotal(
  values: SimTniValueMap,
  activityCode: string,
): number | null {
  return getSimTniTotal(
    values,
    SIM_TNI_TYPE_CODES.map((simType) => simTniInputCode(activityCode, simType)),
  );
}

export function getSimTniTypeTotal(
  values: SimTniValueMap,
  simTypeCode: string,
): number | null {
  return getSimTniTotal(
    values,
    SIM_TNI_ACTIVITY_CODES.map((activity) => simTniInputCode(activity, simTypeCode)),
  );
}
