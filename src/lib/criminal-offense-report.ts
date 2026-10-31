export type CriminalOffenseValueMap = Record<string, string>;

export function criminalOffenseInputCode(
  versionId: string,
  personnelCategoryId: string,
): string {
  return versionId + ":" + personnelCategoryId;
}

export function isValidCriminalOffenseValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized === "") return true;
  if (!/^[0-9]+$/.test(normalized)) return false;
  return Number.isSafeInteger(Number(normalized));
}

export function countCriminalOffenseReported(
  values: CriminalOffenseValueMap,
  codes: readonly string[],
): number {
  return codes.filter((code) => (values[code] ?? "").trim() !== "").length;
}

export function getCriminalOffenseInvalidCodes(
  values: CriminalOffenseValueMap,
  codes: readonly string[],
): string[] {
  return codes.filter((code) => !isValidCriminalOffenseValue(values[code] ?? ""));
}

/**
 * Returns a total only when every input in the requested slice is reported.
 * A literal zero is reported; an empty cell is NOT_REPORTED.
 */
export function getCriminalOffenseTotal(
  values: CriminalOffenseValueMap,
  codes: readonly string[],
): number | null {
  let total = 0;
  for (const code of codes) {
    const raw = (values[code] ?? "").trim();
    if (raw === "" || !isValidCriminalOffenseValue(raw)) return null;
    total += Number(raw);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
