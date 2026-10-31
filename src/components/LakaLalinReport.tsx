import { useEffect, useMemo, useState } from "react";
import type { ActiveOperator } from "../lib/operator-auth";
import {
  LAKA_FIELD_BINDINGS,
  LAKA_REPORT_GROUPS,
  LAKA_REQUIRED_CODES,
  countLakaReported,
  getLakaInvalidCodes,
  getLakaTotal,
  type LakaFieldBinding,
  type LakaTarget,
} from "../lib/laka-report";
import { supabase } from "../lib/supabase";

const CONTRACT_CODE = "LAKA_LALIN_POMDAM_INPUT_2026";
const REPORT_YEAR = 2026;
const REPORT_TYPE_ID = "55278d29-d4ee-43bd-b1d1-b3d54fdd368a";

type DimensionRow = {
  id: string;
  code: string;
  name: string;
  display_order: number;
  active: boolean;
};

type LakaDimensions = {
  accidents: DimensionRow[];
  personnel: DimensionRow[];
  vehicles: DimensionRow[];
  damages: DimensionRow[];
  outcomes: DimensionRow[];
};

type LakaField = {
  code: string;
  label: string;
  displayOrder: number;
  target: LakaTarget;
  dimensionId: string;
  damageId: string | null;
};

type PeriodRow = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  report_year: number;
  report_month: number;
};

type LakaRecordRow = {
  id: string;
  value: number | null;
  data_status: string;
  ingestion_method: string;
  source_cell_id: string | null;
  accident_type_id?: string;
  personnel_category_id?: string;
  victim_outcome_id?: string;
  vehicle_category_id?: string;
  material_damage_type_id?: string;
};

type SubmissionRow = {
  id: string;
  status: string;
  revision: number;
  submitted_by: string;
  submitted_at: string;
};

type RecordMeta = {
  locked: boolean;
  source: string;
};

function getCurrentMonthValue(): string {
  const now = new Date();
  const month = now.getFullYear() === REPORT_YEAR ? now.getMonth() + 1 : 9;
  return REPORT_YEAR + "-" + String(month).padStart(2, "0");
}

function getMaximumMonthValue(): string {
  const now = new Date();
  if (now.getFullYear() > REPORT_YEAR) return REPORT_YEAR + "-12";
  if (now.getFullYear() < REPORT_YEAR) return REPORT_YEAR + "-01";
  return REPORT_YEAR + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

function formatMonthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function getMonthDates(value: string) {
  const [year, month] = value.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    start: year + "-" + String(month).padStart(2, "0") + "-01",
    end: year + "-" + String(month).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0"),
  };
}

function formatCount(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("id-ID").format(value);
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Terjadi kesalahan. Silakan coba lagi.";
}

function findDimensionId(binding: LakaFieldBinding, dimensions: LakaDimensions): string | null {
  let source: DimensionRow[];
  switch (binding.target) {
    case "accident":
      source = dimensions.accidents;
      break;
    case "personnel":
    case "victimRank":
      source = dimensions.personnel;
      break;
    case "victimOutcome":
      source = dimensions.outcomes;
      break;
    case "material":
      source = dimensions.vehicles;
      break;
  }
  return source.find((item) => item.code === binding.dimensionCode)?.id ?? null;
}

function findDamageId(binding: LakaFieldBinding, dimensions: LakaDimensions): string | null {
  if (binding.target !== "material" || !binding.damageCode) return null;
  return dimensions.damages.find((item) => item.code === binding.damageCode)?.id ?? null;
}

function findRecordForField(
  field: LakaField,
  rows: {
    accidents: LakaRecordRow[];
    personnel: LakaRecordRow[];
    victimRanks: LakaRecordRow[];
    victimOutcomes: LakaRecordRow[];
    materials: LakaRecordRow[];
  },
): LakaRecordRow | undefined {
  switch (field.target) {
    case "accident":
      return rows.accidents.find((row) => row.accident_type_id === field.dimensionId);
    case "personnel":
      return rows.personnel.find((row) => row.personnel_category_id === field.dimensionId);
    case "victimRank":
      return rows.victimRanks.find((row) => row.personnel_category_id === field.dimensionId);
    case "victimOutcome":
      return rows.victimOutcomes.find((row) => row.victim_outcome_id === field.dimensionId);
    case "material":
      return rows.materials.find((row) =>
        row.vehicle_category_id === field.dimensionId &&
        row.material_damage_type_id === field.damageId
      );
  }
}

export default function LakaLalinReport({
  operator,
  onBack,
}: {
  operator: ActiveOperator;
  onBack: () => void;
}) {
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue);
  const [fields, setFields] = useState<LakaField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [recordMeta, setRecordMeta] = useState<Record<string, RecordMeta>>({});
  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [reportTypeId, setReportTypeId] = useState(REPORT_TYPE_ID);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadReport() {
      if (!supabase) {
        setLoading(false);
        setErrorMessage("Koneksi database belum tersedia.");
        return;
      }

      setLoading(true);
      setErrorMessage("");
      setSaveMessage("");

      try {
        const [
          contractResult,
          accidentTypesResult,
          personnelCategoriesResult,
          vehicleCategoriesResult,
          damageTypesResult,
          victimOutcomesResult,
          userResult,
        ] = await Promise.all([
          supabase.from("laka_data_contracts")
            .select("id,report_type_id,status")
            .eq("code", CONTRACT_CODE)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("accident_types").select("id,code,name,display_order,active").eq("active", true).order("display_order"),
          supabase.from("personnel_categories").select("id,code,name,display_order,active").eq("active", true).order("display_order"),
          supabase.from("vehicle_categories").select("id,code,name,display_order,active").eq("active", true).order("display_order"),
          supabase.from("material_damage_types").select("id,code,name,display_order,active").eq("active", true).order("display_order"),
          supabase.from("victim_outcomes").select("id,code,name,display_order,active").eq("active", true).order("display_order"),
          supabase.auth.getUser(),
        ]);

        if (!active) return;
        if (contractResult.error) throw contractResult.error;
        if (!contractResult.data) throw new Error("Kontrak input Laka Lalin 2026 belum tersedia.");
        if (accidentTypesResult.error || !accidentTypesResult.data) throw new Error("Master jenis kecelakaan belum dapat dibaca.");
        if (personnelCategoriesResult.error || !personnelCategoriesResult.data) throw new Error("Master kategori personel belum dapat dibaca.");
        if (vehicleCategoriesResult.error || !vehicleCategoriesResult.data) throw new Error("Master kategori kendaraan belum dapat dibaca.");
        if (damageTypesResult.error || !damageTypesResult.data) throw new Error("Master jenis kerusakan belum dapat dibaca.");
        if (victimOutcomesResult.error || !victimOutcomesResult.data) throw new Error("Master akibat korban belum dapat dibaca.");
        if (userResult.error || !userResult.data.user) throw new Error("Sesi operator tidak ditemukan.");

        const dimensions: LakaDimensions = {
          accidents: accidentTypesResult.data as DimensionRow[],
          personnel: personnelCategoriesResult.data as DimensionRow[],
          vehicles: vehicleCategoriesResult.data as DimensionRow[],
          damages: damageTypesResult.data as DimensionRow[],
          outcomes: victimOutcomesResult.data as DimensionRow[],
        };

        const { data: contractFields, error: fieldsError } = await supabase
          .from("laka_data_contract_fields")
          .select("field_code,label,display_order,form_input,calculated")
          .eq("contract_id", contractResult.data.id)
          .eq("form_input", true)
          .eq("calculated", false)
          .order("display_order", { ascending: true });

        if (fieldsError || !contractFields) throw fieldsError ?? new Error("Daftar input Laka Lalin belum dapat dibaca.");

        const resolvedFields: LakaField[] = (contractFields as Array<{
          field_code: string;
          label: string;
          display_order: number;
        }>).map((field) => {
          const binding = LAKA_FIELD_BINDINGS.find((item) => item.code === field.field_code);
          if (!binding) throw new Error("Pemetaan input " + field.field_code + " belum tersedia.");
          const dimensionId = findDimensionId(binding, dimensions);
          const damageId = findDamageId(binding, dimensions);
          if (!dimensionId || (binding.target === "material" && !damageId)) {
            throw new Error("Master dimensi untuk " + field.field_code + " belum lengkap.");
          }
          return {
            code: field.field_code,
            label: field.label,
            displayOrder: field.display_order,
            target: binding.target,
            dimensionId,
            damageId,
          };
        });

        const resolvedCodes = resolvedFields.map((field) => field.code);
        if (
          resolvedFields.length !== LAKA_REQUIRED_CODES.length ||
          LAKA_REQUIRED_CODES.some((code) => !resolvedCodes.includes(code))
        ) {
          throw new Error("Struktur 18 input Laka Lalin tidak sesuai dengan kontrak data.");
        }

        const { year, month } = getMonthDates(monthValue);
        const { data: periodData, error: periodError } = await supabase
          .from("report_periods")
          .select("id,period_label,period_start,period_end,report_year,report_month")
          .eq("period_type", "MONTH")
          .eq("report_year", year)
          .eq("report_month", month)
          .maybeSingle();

        if (periodError) throw periodError;
        const selectedPeriod = (periodData as PeriodRow | null) ?? null;

        const emptyRows = {
          accidents: [] as LakaRecordRow[],
          personnel: [] as LakaRecordRow[],
          victimRanks: [] as LakaRecordRow[],
          victimOutcomes: [] as LakaRecordRow[],
          materials: [] as LakaRecordRow[],
        };
        let rows = emptyRows;
        let nextSubmission: SubmissionRow | null = null;

        if (selectedPeriod) {
          const [
            accidentsResult,
            personnelResult,
            victimRanksResult,
            victimOutcomesResult,
            materialsResult,
            submissionResult,
          ] = await Promise.all([
            supabase.from("laka_accident_records")
              .select("id,accident_type_id,value,data_status,ingestion_method,source_cell_id")
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id),
            supabase.from("laka_personnel_records")
              .select("id,personnel_category_id,value,data_status,ingestion_method,source_cell_id")
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id),
            supabase.from("laka_victim_rank_records")
              .select("id,personnel_category_id,value,data_status,ingestion_method,source_cell_id")
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id),
            supabase.from("laka_victim_outcome_records")
              .select("id,victim_outcome_id,value,data_status,ingestion_method,source_cell_id")
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id),
            supabase.from("laka_material_records")
              .select("id,vehicle_category_id,material_damage_type_id,value,data_status,ingestion_method,source_cell_id")
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id),
            supabase.from("report_submissions")
              .select("id,status,revision,submitted_by,submitted_at")
              .eq("report_type_id", contractResult.data.report_type_id)
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id)
              .maybeSingle(),
          ]);

          const recordResults = [
            accidentsResult,
            personnelResult,
            victimRanksResult,
            victimOutcomesResult,
            materialsResult,
          ];
          const recordError = recordResults.find((result) => result.error);
          if (recordError?.error) throw recordError.error;
          if (submissionResult.error) throw submissionResult.error;

          rows = {
            accidents: accidentsResult.data as LakaRecordRow[],
            personnel: personnelResult.data as LakaRecordRow[],
            victimRanks: victimRanksResult.data as LakaRecordRow[],
            victimOutcomes: victimOutcomesResult.data as LakaRecordRow[],
            materials: materialsResult.data as LakaRecordRow[],
          };
          nextSubmission = (submissionResult.data as SubmissionRow | null) ?? null;
        }

        if (!active) return;

        const nextValues: Record<string, string> = Object.fromEntries(
          resolvedFields.map((field) => [field.code, ""]),
        );
        const nextRecordMeta: Record<string, RecordMeta> = {};

        for (const field of resolvedFields) {
          const record = findRecordForField(field, rows);
          if (!record) continue;
          nextValues[field.code] = record.value === null ? "" : String(record.value);
          const locked = record.source_cell_id !== null || record.ingestion_method === "EXCEL";
          nextRecordMeta[field.code] = {
            locked,
            source: locked ? "DATA SUMBER EXCEL" : "INPUT OPERATOR",
          };
        }

        setFields(resolvedFields);
        setValues(nextValues);
        setRecordMeta(nextRecordMeta);
        setPeriod(selectedPeriod);
        setSubmission(nextSubmission);
        setReportTypeId(contractResult.data.report_type_id);
        setCurrentUserId(userResult.data.user.id);
        setLoading(false);
      } catch (error) {
        if (!active) return;
        setLoading(false);
        setErrorMessage(getErrorMessage(error));
      }
    }

    void loadReport();
    return () => {
      active = false;
    };
  }, [monthValue, operator.pomdam.id, refreshKey]);

  const monthLabel = useMemo(() => formatMonthLabel(monthValue), [monthValue]);
  const maxMonth = useMemo(getMaximumMonthValue, []);
  const reportedCount = useMemo(() => countLakaReported(values), [values]);
  const invalidCodes = useMemo(() => getLakaInvalidCodes(values), [values]);
  const accidentTotal = useMemo(
    () => getLakaTotal(values, LAKA_REPORT_GROUPS[0].codes),
    [values],
  );
  const personnelTotal = useMemo(
    () => getLakaTotal(values, LAKA_REPORT_GROUPS[1].codes),
    [values],
  );
  const victimOutcomeTotal = useMemo(
    () => getLakaTotal(values, LAKA_REPORT_GROUPS[3].codes),
    [values],
  );
  const materialTotal = useMemo(
    () => getLakaTotal(values, LAKA_REPORT_GROUPS[4].codes),
    [values],
  );
  const editableCount = fields.filter((field) => !recordMeta[field.code]?.locked).length;
  const sourceLockedCount = fields.filter((field) => recordMeta[field.code]?.locked).length;
  const submissionOwnerConflict = Boolean(submission && currentUserId && submission.submitted_by !== currentUserId);
  const currentSubmissionLabel = submission?.status === "SUBMITTED" ? "SUDAH DIKIRIM" : "BELUM DIKIRIM";
  const canSave = fields.length === LAKA_REQUIRED_CODES.length && editableCount > 0 && !submissionOwnerConflict && invalidCodes.length === 0;

  function updateValue(code: string, value: string) {
    setValues((current) => ({ ...current, [code]: value }));
    setErrorMessage("");
    setSaveMessage("");
  }

  async function handleSave() {
    if (!supabase || !canSave || saving || !reportTypeId) return;
    if (invalidCodes.length > 0) {
      setErrorMessage("Periksa kembali angka yang diisi. Gunakan bilangan bulat nol atau lebih.");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    setSaveMessage("");

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Sesi operator telah berakhir. Silakan masuk kembali.");
      if (submission && submission.submitted_by !== userData.user.id) {
        throw new Error("Laporan ini telah dikirim oleh akun lain dan tidak dapat diubah dari akun ini.");
      }

      let targetPeriod = period;
      if (!targetPeriod) {
        const dates = getMonthDates(monthValue);
        const label = formatMonthLabel(monthValue);
        const { data: insertedPeriod, error: insertPeriodError } = await supabase
          .from("report_periods")
          .insert({
            period_type: "MONTH",
            period_start: dates.start,
            period_end: dates.end,
            report_year: dates.year,
            fiscal_year: dates.year,
            report_month: dates.month,
            period_label: label,
            source_label: label,
          })
          .select("id,period_label,period_start,period_end,report_year,report_month")
          .single();

        if (insertPeriodError) {
          if (insertPeriodError.code !== "23505") throw insertPeriodError;
          const { data: existingPeriod, error: findPeriodError } = await supabase
            .from("report_periods")
            .select("id,period_label,period_start,period_end,report_year,report_month")
            .eq("period_type", "MONTH")
            .eq("report_year", dates.year)
            .eq("report_month", dates.month)
            .maybeSingle();
          if (findPeriodError || !existingPeriod) throw findPeriodError ?? insertPeriodError;
          targetPeriod = existingPeriod as PeriodRow;
        } else {
          targetPeriod = insertedPeriod as PeriodRow;
        }
      }

      if (!targetPeriod) throw new Error("Periode laporan tidak dapat disiapkan.");

      const rowsToSave = fields
        .filter((field) => !recordMeta[field.code]?.locked)
        .map((field) => {
          const rawValue = (values[field.code] ?? "").trim();
          const isReported = rawValue !== "";
          const common = {
            period_id: targetPeriod!.id,
            pomdam_id: operator.pomdam.id,
            value: isReported ? Number(rawValue) : null,
            data_status: isReported ? "VALID" : "NOT_REPORTED",
            source_cell_id: null,
            ingestion_method: "FORM",
            source_value_strategy: "DIRECT",
          };
          switch (field.target) {
            case "accident":
              return { ...common, target: "accident" as const, accident_type_id: field.dimensionId };
            case "personnel":
              return { ...common, target: "personnel" as const, personnel_category_id: field.dimensionId };
            case "victimRank":
              return { ...common, target: "victimRank" as const, personnel_category_id: field.dimensionId };
            case "victimOutcome":
              return { ...common, target: "victimOutcome" as const, victim_outcome_id: field.dimensionId };
            case "material":
              return {
                ...common,
                target: "material" as const,
                vehicle_category_id: field.dimensionId,
                material_damage_type_id: field.damageId,
              };
          }
        });

      const accidentRows = rowsToSave.filter((row) => row.target === "accident").map(({ target: _target, ...row }) => row);
      const personnelRows = rowsToSave.filter((row) => row.target === "personnel").map(({ target: _target, ...row }) => row);
      const victimRankRows = rowsToSave.filter((row) => row.target === "victimRank").map(({ target: _target, ...row }) => row);
      const victimOutcomeRows = rowsToSave.filter((row) => row.target === "victimOutcome").map(({ target: _target, ...row }) => row);
      const materialRows = rowsToSave.filter((row) => row.target === "material").map(({ target: _target, ...row }) => row);

      if (accidentRows.length > 0) {
        const { error } = await supabase.from("laka_accident_records")
          .upsert(accidentRows, { onConflict: "period_id,pomdam_id,accident_type_id" });
        if (error) throw error;
      }
      if (personnelRows.length > 0) {
        const { error } = await supabase.from("laka_personnel_records")
          .upsert(personnelRows, { onConflict: "period_id,pomdam_id,personnel_category_id" });
        if (error) throw error;
      }
      if (victimRankRows.length > 0) {
        const { error } = await supabase.from("laka_victim_rank_records")
          .upsert(victimRankRows, { onConflict: "period_id,pomdam_id,personnel_category_id" });
        if (error) throw error;
      }
      if (victimOutcomeRows.length > 0) {
        const { error } = await supabase.from("laka_victim_outcome_records")
          .upsert(victimOutcomeRows, { onConflict: "period_id,pomdam_id,victim_outcome_id" });
        if (error) throw error;
      }
      if (materialRows.length > 0) {
        const { error } = await supabase.from("laka_material_records")
          .upsert(materialRows, { onConflict: "period_id,pomdam_id,vehicle_category_id,material_damage_type_id" });
        if (error) throw error;
      }

      const submittedAt = new Date().toISOString();
      if (submission) {
        const { error: updateSubmissionError } = await supabase
          .from("report_submissions")
          .update({
            status: "SUBMITTED",
            revision: submission.revision + 1,
            submitted_at: submittedAt,
            updated_at: submittedAt,
          })
          .eq("id", submission.id);
        if (updateSubmissionError) {
          setSaveMessage("Data Laka Lalin tersimpan, tetapi status pengiriman belum berhasil diperbarui.");
          setRefreshKey((value) => value + 1);
          return;
        }
      } else {
        const { error: insertSubmissionError } = await supabase
          .from("report_submissions")
          .insert({
            report_type_id: reportTypeId,
            period_id: targetPeriod.id,
            pomdam_id: operator.pomdam.id,
            submitted_by: userData.user.id,
            status: "SUBMITTED",
            revision: 1,
            submitted_at: submittedAt,
          });
        if (insertSubmissionError) {
          setSaveMessage("Data Laka Lalin tersimpan, tetapi status pengiriman belum berhasil dicatat.");
          setRefreshKey((value) => value + 1);
          return;
        }
      }

      setSaveMessage("Laporan Laka Lalin " + monthLabel + " berhasil disimpan dan dikirim.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="gakkum-report">
      <button
        className="back-link"
        type="button"
        onClick={showForm ? () => setShowForm(false) : onBack}
      >
        <span aria-hidden="true">←</span> {showForm ? "Kembali ke ringkasan" : "Kembali ke dashboard"}
      </button>

      <div className="gakkum-heading">
        <div>
          <p className="eyebrow">LAPORAN 02 · LAKA LALIN</p>
          <h1>Statistik Laka Lalin</h1>
          <p>{showForm ? "Isi jumlah kecelakaan, personel, korban, dan kerusakan material Pomdam." : "Pantau laporan kecelakaan lalu lintas dan buka formulir pengisian Pomdam."}</p>
        </div>
        <div className="gakkum-heading-actions">
          <div className="gakkum-status">
            <span className="gakkum-status-dot" />
            {currentSubmissionLabel}
          </div>
          {!showForm && (
            <button
              className="gakkum-primary-action"
              type="button"
              onClick={() => setShowForm(true)}
              disabled={loading || fields.length === 0}
            >
              {loading
                ? "MEMUAT FORM..."
                : fields.length === 0
                  ? "FORM BELUM TERSEDIA"
                  : editableCount > 0 && !submissionOwnerConflict
                    ? "ISI LAPORAN"
                    : "LIHAT LAPORAN"}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>

      <div className="gakkum-period-panel">
        <div className="gakkum-unit">
          <span>POMDAM</span>
          <strong>{operator.pomdam.displayName}</strong>
          <small>{operator.pomdam.code}</small>
        </div>
        <label className="gakkum-month-field">
          <span>PERIODE LAPORAN</span>
          <input
            type="month"
            value={monthValue}
            min={REPORT_YEAR + "-01"}
            max={maxMonth}
            onChange={(event) => setMonthValue(event.target.value)}
            disabled={loading || saving}
          />
        </label>
      </div>

      <div className="laka-summary-grid">
        <article className="gakkum-summary-card gakkum-summary-primary">
          <span>JUMLAH KECELAKAAN</span>
          <strong>{formatCount(accidentTotal)}</strong>
          <small>Ganda, tunggal, dan tabrak lari</small>
        </article>
        <article className="gakkum-summary-card">
          <span>PERSONEL TERLIBAT</span>
          <strong>{formatCount(personnelTotal)}</strong>
          <small>PA, BA, TA, dan PNS</small>
        </article>
        <article className="gakkum-summary-card">
          <span>KORBAN</span>
          <strong>{formatCount(victimOutcomeTotal)}</strong>
          <small>Meninggal, luka berat, dan luka ringan</small>
        </article>
        <article className="gakkum-summary-card">
          <span>KERUSAKAN MATERIAL</span>
          <strong>{formatCount(materialTotal)}</strong>
          <small>Kendaraan dinas dan kendaraan umum</small>
        </article>
      </div>

      <div className="gakkum-notice">
        <strong>{reportedCount} dari 18 input terlapor.</strong>
        <span>Nilai nol dihitung sebagai laporan; kolom kosong tetap berstatus belum dilaporkan.</span>
      </div>

      {sourceLockedCount > 0 && (
        <div className="gakkum-notice gakkum-notice-info">
          <strong>Data sumber Excel terkunci.</strong>
          <span>{sourceLockedCount} input berasal dari impor Excel dan ditampilkan apa adanya agar jejak sumber tidak berubah.</span>
        </div>
      )}

      {submissionOwnerConflict && (
        <div className="gakkum-notice gakkum-notice-warning">
          <strong>Laporan dikirim oleh akun lain.</strong>
          <span>Data dapat dilihat, tetapi perubahan harus dilakukan oleh akun pengirim atau dibuka kembali oleh pengelola.</span>
        </div>
      )}

      {errorMessage && <div className="gakkum-feedback gakkum-feedback-error" role="alert">{errorMessage}</div>}
      {saveMessage && <div className="gakkum-feedback gakkum-feedback-success" role="status">{saveMessage}</div>}

      {loading ? (
        <div className="gakkum-loading">Memuat data Laka Lalin...</div>
      ) : showForm ? (
        <>
          <div className="gakkum-section-heading">
            <div>
              <p className="eyebrow">RINCIAN DATA</p>
              <h2>Data kecelakaan lalu lintas Pomdam</h2>
            </div>
            <span>ANGKA LAPORAN</span>
          </div>

          <div className="gakkum-groups">
            {LAKA_REPORT_GROUPS.map((group, groupIndex) => {
              const groupFields = group.codes
                .map((code) => fields.find((field) => field.code === code))
                .filter((field): field is LakaField => Boolean(field));
              return (
                <article className="gakkum-group-card" key={group.key}>
                  <div className="gakkum-group-heading">
                    <div className="gakkum-group-number">{String(groupIndex + 1).padStart(2, "0")}</div>
                    <h3>{group.title}</h3>
                    <div className="gakkum-group-total">
                      <span>{group.totalLabel}</span>
                      <strong>{formatCount(getLakaTotal(values, group.codes))}</strong>
                    </div>
                  </div>
                  <div className="gakkum-field-list">
                    {groupFields.map((field) => (
                      <div className="gakkum-field-row" key={field.code}>
                        <span className="gakkum-field-index">{String(field.displayOrder).padStart(2, "0")}</span>
                        <div className="gakkum-field-copy">
                          <label htmlFor={"laka-" + field.code}>{field.label}</label>
                          <small>
                            {recordMeta[field.code]?.locked
                              ? "DATA SUMBER EXCEL"
                              : (values[field.code] ?? "").trim() === ""
                                ? "Belum dilaporkan"
                                : "Input operator"}
                          </small>
                        </div>
                        <div className="gakkum-input-wrap">
                          <input
                            id={"laka-" + field.code}
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            value={values[field.code] ?? ""}
                            placeholder="—"
                            disabled={saving || recordMeta[field.code]?.locked || submissionOwnerConflict}
                            aria-label={field.label}
                            onChange={(event) => updateValue(field.code, event.target.value)}
                          />
                          <span>{group.unitLabel}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="gakkum-form-footer">
            <div>
              <strong>{reportedCount} dari 18 input memiliki angka.</strong>
              <small>Kolom kosong disimpan sebagai NOT_REPORTED, bukan nol. Total per kelompok dihitung otomatis.</small>
              {invalidCodes.length > 0 && <small className="gakkum-inline-error">{invalidCodes.length} input harus berupa bilangan bulat nol atau lebih.</small>}
            </div>
            <button type="button" onClick={handleSave} disabled={!canSave || saving || loading}>
              {saving ? "MENYIMPAN..." : submission ? "SIMPAN PERUBAHAN" : "SIMPAN & KIRIM LAPORAN"}
            </button>
          </div>
        </>
      ) : (
        <div className="gakkum-overview-note">
          <strong>Ringkasan laporan siap.</strong>
          <span>Pilih tombol {editableCount > 0 && !submissionOwnerConflict ? "ISI LAPORAN" : "LIHAT LAPORAN"} untuk membuka rincian Laka Lalin periode {monthLabel}.</span>
        </div>
      )}
    </section>
  );
}
