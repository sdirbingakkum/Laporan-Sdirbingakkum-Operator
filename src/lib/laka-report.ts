export type LakaValueMap = Record<string, string>;

export type LakaTarget =
  | "accident"
  | "personnel"
  | "victimRank"
  | "victimOutcome"
  | "material";

export type LakaFieldBinding = {
  code: string;
  target: LakaTarget;
  dimensionCode: string;
  damageCode?: string;
};

export const LAKA_FIELD_BINDINGS: readonly LakaFieldBinding[] = [
  { code: "ACC_GANDA", target: "accident", dimensionCode: "GANDA" },
  { code: "ACC_TUNGGAL", target: "accident", dimensionCode: "TUNGGAL" },
  { code: "ACC_TABRAK_LARI", target: "accident", dimensionCode: "TABRAK_LARI" },
  { code: "PERSONNEL_PA", target: "personnel", dimensionCode: "PA" },
  { code: "PERSONNEL_BA", target: "personnel", dimensionCode: "BA" },
  { code: "PERSONNEL_TA", target: "personnel", dimensionCode: "TA" },
  { code: "PERSONNEL_PNS", target: "personnel", dimensionCode: "PNS" },
  { code: "VICTIM_RANK_PA", target: "victimRank", dimensionCode: "PA" },
  { code: "VICTIM_RANK_BA", target: "victimRank", dimensionCode: "BA" },
  { code: "VICTIM_RANK_TA", target: "victimRank", dimensionCode: "TA" },
  { code: "VICTIM_RANK_PNS", target: "victimRank", dimensionCode: "PNS" },
  { code: "VICTIM_OUTCOME_MD", target: "victimOutcome", dimensionCode: "MD" },
  { code: "VICTIM_OUTCOME_LB", target: "victimOutcome", dimensionCode: "LB" },
  { code: "VICTIM_OUTCOME_LR", target: "victimOutcome", dimensionCode: "LR" },
  { code: "MATERIAL_RANDIS_RB", target: "material", dimensionCode: "RANDIS", damageCode: "RB" },
  { code: "MATERIAL_RANDIS_RR", target: "material", dimensionCode: "RANDIS", damageCode: "RR" },
  { code: "MATERIAL_RAN_UMUM_RB", target: "material", dimensionCode: "RAN_UMUM", damageCode: "RB" },
  { code: "MATERIAL_RAN_UMUM_RR", target: "material", dimensionCode: "RAN_UMUM", damageCode: "RR" },
] as const;

export const LAKA_REQUIRED_CODES = LAKA_FIELD_BINDINGS.map((field) => field.code);

export const LAKA_REPORT_GROUPS = [
  {
    key: "ACCIDENT",
    title: "Jumlah Kecelakaan",
    totalLabel: "TOTAL KEJADIAN",
    unitLabel: "KEJADIAN",
    codes: ["ACC_GANDA", "ACC_TUNGGAL", "ACC_TABRAK_LARI"],
  },
  {
    key: "PERSONNEL",
    title: "Personel yang Terlibat",
    totalLabel: "TOTAL PERSONEL",
    unitLabel: "ORANG",
    codes: ["PERSONNEL_PA", "PERSONNEL_BA", "PERSONNEL_TA", "PERSONNEL_PNS"],
  },
  {
    key: "VICTIM_RANK",
    title: "Korban Berdasarkan Pangkat",
    totalLabel: "TOTAL KORBAN",
    unitLabel: "ORANG",
    codes: ["VICTIM_RANK_PA", "VICTIM_RANK_BA", "VICTIM_RANK_TA", "VICTIM_RANK_PNS"],
  },
  {
    key: "VICTIM_OUTCOME",
    title: "Korban Berdasarkan Akibat",
    totalLabel: "TOTAL KORBAN",
    unitLabel: "ORANG",
    codes: ["VICTIM_OUTCOME_MD", "VICTIM_OUTCOME_LB", "VICTIM_OUTCOME_LR"],
  },
  {
    key: "MATERIAL",
    title: "Kerusakan Material Kendaraan",
    totalLabel: "TOTAL KENDARAAN",
    unitLabel: "UNIT",
    codes: ["MATERIAL_RANDIS_RB", "MATERIAL_RANDIS_RR", "MATERIAL_RAN_UMUM_RB", "MATERIAL_RAN_UMUM_RR"],
  },
] as const;

export function isValidLakaValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized === "") return true;
  if (!/^\d+$/.test(normalized)) return false;
  return Number.isSafeInteger(Number(normalized));
}

export function getLakaInvalidCodes(values: LakaValueMap): string[] {
  return LAKA_REQUIRED_CODES.filter((code) => !isValidLakaValue(values[code] ?? ""));
}

export function getLakaTotal(values: LakaValueMap, codes: readonly string[]): number | null {
  let total = 0;
  for (const code of codes) {
    const rawValue = (values[code] ?? "").trim();
    if (rawValue === "" || !isValidLakaValue(rawValue)) return null;
    total += Number(rawValue);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function countLakaReported(values: LakaValueMap): number {
  return LAKA_REQUIRED_CODES.filter((code) => (values[code] ?? "").trim() !== "").length;
}
