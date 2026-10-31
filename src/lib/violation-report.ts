export type ViolationValueMap = Record<string, string>;

export type ViolationCategoryCode = "B" | "C";

export type ViolationField = {
  code: string;
  label: string;
  category: ViolationCategoryCode;
  violationId: string;
  violationVersionId: string;
};

export const VIOLATION_REQUIRED_CODES = [
  "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11",
  "C1", "C2", "C3", "C4", "C5", "C6",
] as const;

export const VIOLATION_GROUPS = [
  {
    key: "TATIB",
    title: "Pelanggaran Tata Tertib",
    category: "B",
    codes: VIOLATION_REQUIRED_CODES.filter((code) => code.startsWith("B")),
  },
  {
    key: "LALIN",
    title: "Pelanggaran Lalu Lintas",
    category: "C",
    codes: VIOLATION_REQUIRED_CODES.filter((code) => code.startsWith("C")),
  },
] as const;

export function isValidViolationValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized === "") return true;
  if (!/^\\d+$/.test(normalized)) return false;
  return Number.isSafeInteger(Number(normalized));
}

export function getViolationInvalidCodes(values: ViolationValueMap): string[] {
  return VIOLATION_REQUIRED_CODES.filter((code) => !isValidViolationValue(values[code] ?? ""));
}

export function countViolationReported(values: ViolationValueMap): number {
  return VIOLATION_REQUIRED_CODES.filter((code) => (values[code] ?? "").trim() !== "").length;
}

export function getViolationTotal(values: ViolationValueMap, codes: readonly string[]): number | null {
  let total = 0;
  for (const code of codes) {
    const rawValue = (values[code] ?? "").trim();
    if (rawValue === "" || !isValidViolationValue(rawValue)) return null;
    total += Number(rawValue);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
