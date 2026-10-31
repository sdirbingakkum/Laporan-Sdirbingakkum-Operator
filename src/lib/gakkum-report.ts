export type GakkumValueMap = Record<string, string>;

export const GAKKUM_ACTIVITY_GROUPS = [
  {
    key: "PATROLI",
    title: "Patroli",
    totalLabel: "JUMLAH PATROLI",
    codes: ["PATROLI_BERKENDARAAN", "PATROLI_KOMBINASI"],
  },
  {
    key: "RAZIA",
    title: "Razia",
    totalLabel: "JUMLAH RAZIA",
    codes: [
      "RAZIA_KENDARAAN_BERMOTOR",
      "RAZIA_DITEMPAT_TERLARANG_ANGGOTA_TNI",
      "RAZIA_DIDALAM_KERETA_API",
      "RAZIA_DITEMPAT_LAIN",
    ],
  },
  {
    key: "SIM_TNI",
    title: "Penyelenggaraan SIM TNI AD",
    totalLabel: null,
    codes: ["PENYELENGGARAAN_SIM_TNI_AD"],
  },
  {
    key: "PROVOS",
    title: "Pembinaan Provos Angkatan Darat",
    totalLabel: null,
    codes: ["PEMBINAAN_PROVOS_ANGKATAN_DARAT"],
  },
  {
    key: "LAIN_LAIN",
    title: "Lain-lain",
    totalLabel: "JUMLAH LAIN-LAIN",
    codes: [
      "MENDATANGI_TKP",
      "BAN_POM_UTK_KAM_UMUM",
      "WAS_PERBATASAN",
      "PENANGKAPAN",
      "PENGGELEDAHAN",
      "PENYEGELAN",
    ],
  },
] as const;

export const GAKKUM_REQUIRED_CODES = GAKKUM_ACTIVITY_GROUPS.flatMap((group) => [...group.codes]);

export function isValidGakkumValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized === "") return true;
  if (!/^\d+$/.test(normalized)) return false;
  return Number.isSafeInteger(Number(normalized));
}

export function getGakkumInvalidCodes(values: GakkumValueMap): string[] {
  return GAKKUM_REQUIRED_CODES.filter((code) => !isValidGakkumValue(values[code] ?? ""));
}

export function getGakkumTotal(values: GakkumValueMap, codes: readonly string[]): number | null {
  let total = 0;
  for (const code of codes) {
    const rawValue = (values[code] ?? "").trim();
    if (rawValue === "" || !isValidGakkumValue(rawValue)) return null;
    total += Number(rawValue);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function countGakkumReported(values: GakkumValueMap): number {
  return GAKKUM_REQUIRED_CODES.filter((code) => (values[code] ?? "").trim() !== "").length;
}
