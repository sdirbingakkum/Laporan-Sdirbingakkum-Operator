export type ReportModule = {
  code: string;
  title: string;
  description: string;
};

export const REPORT_MODULES: ReportModule[] = [
  {
    code: "GAKKUM",
    title: "Statistik Giat Gakkum",
    description: "Statistik kegiatan penegakan hukum.",
  },
  {
    code: "LAKA_LALIN",
    title: "Statistik Laka Lalin",
    description: "Statistik kecelakaan lalu lintas.",
  },
  {
    code: "PELANGGARAN",
    title: "Statistik Pelanggaran",
    description: "Rekapitulasi data pelanggaran.",
  },
  {
    code: "PROVOS",
    title: "Rekapitulasi Provos TNI AD",
    description: "Rekapitulasi personel dan pendidikan Provos.",
  },
  {
    code: "SIM_TNI",
    title: "Rekapitulasi SIM TNI",
    description: "Rekapitulasi data SIM TNI AD.",
  },
  {
    code: "TINDAK_PIDANA",
    title: "Rekap Tindak Pidana",
    description: "Rekapitulasi data tindak pidana.",
  },
];
