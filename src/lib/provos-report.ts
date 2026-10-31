export type ProvosValueMap = Record<string, string>;

export const PROVOS_REQUIRED_CODES = [
  "DSPP",
  "NYATA",
  "PA",
  "BA",
  "TA",
  "SUDAH",
  "BELUM",
] as const;

export const PROVOS_GROUPS = [
  {
    key: "STRENGTH",
    title: "Kekuatan Personel",
    description: "Data kekuatan sesuai DSPP dan jumlah nyata.",
    codes: ["DSPP", "NYATA"],
  },
  {
    key: "PERSONNEL",
    title: "Jumlah Personel",
    description: "Rincian personel menurut golongan kepangkatan.",
    codes: ["PA", "BA", "TA"],
    totalLabel: "JUMLAH PERSONEL",
    totalCodes: ["PA", "BA", "TA"],
  },
  {
    key: "EDUCATION",
    title: "Pendidikan DIK/TAR",
    description: "Jumlah personel yang sudah dan belum DIK/TAR.",
    codes: ["SUDAH", "BELUM"],
    totalLabel: "JUMLAH DIK/TAR",
    totalCodes: ["SUDAH", "BELUM"],
  },
] as const;

export function isValidProvosValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized === "") return true;
  if (!/^\d+$/.test(normalized)) return false;
  return Number.isSafeInteger(Number(normalized));
}

export function getProvosInvalidCodes(values: ProvosValueMap): string[] {
  return PROVOS_REQUIRED_CODES.filter((code) => !isValidProvosValue(values[code] ?? ""));
}

export function countProvosReported(values: ProvosValueMap): number {
  return PROVOS_REQUIRED_CODES.filter((code) => (values[code] ?? "").trim() !== "").length;
}

export function getProvosTotal(
  values: ProvosValueMap,
  codes: readonly string[],
): number | null {
  let total = 0;
  for (const code of codes) {
    const rawValue = (values[code] ?? "").trim();
    if (rawValue === "" || !isValidProvosValue(rawValue)) return null;
    total += Number(rawValue);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
