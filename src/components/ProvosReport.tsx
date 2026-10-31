import { useEffect, useMemo, useState } from "react";
import type { ActiveOperator } from "../lib/operator-auth";
import {
  PROVOS_GROUPS,
  PROVOS_REQUIRED_CODES,
  countProvosReported,
  getProvosInvalidCodes,
  getProvosTotal,
  isValidProvosValue,
} from "../lib/provos-report";
import { supabase } from "../lib/supabase";
import "./ProvosReport.css";

const CONTRACT_CODE = "PROVOS_POMDAM_INPUT_2026";
const REPORT_YEAR = 2026;

type DimensionRow = {
  id: string;
  code: string;
  name: string;
  display_order?: number;
  active?: boolean;
};

type ScopeRow = {
  personnel_category_id: string;
  display_order: number;
  active: boolean;
};

type ReportPeriod = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  report_year: number;
  report_month: number;
};

type ProvosField = {
  code: string;
  label: string;
  domain: "strength" | "personnel" | "education";
  dimensionId: string;
  displayOrder: number;
};

type StoredRecord = {
  id: string;
  value: number | null;
  data_status: string;
  source_cell_id: string | null;
  ingestion_method?: string;
  strength_measure_id?: string;
  personnel_category_id?: string;
  education_status_id?: string;
  [key: string]: unknown;
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

type DomainConfig = {
  domain: ProvosField["domain"];
  table: string;
  dimensionColumn: "strength_measure_id" | "personnel_category_id" | "education_status_id";
};

const DOMAIN_CONFIGS: DomainConfig[] = [
  { domain: "strength", table: "provos_strength_records", dimensionColumn: "strength_measure_id" },
  { domain: "personnel", table: "provos_personnel_records", dimensionColumn: "personnel_category_id" },
  { domain: "education", table: "provos_education_records", dimensionColumn: "education_status_id" },
];

function getCurrentMonthValue(): string {
  const now = new Date();
  const month = now.getFullYear() === REPORT_YEAR ? now.getMonth() + 1 : 8;
  return REPORT_YEAR + "-" + String(month).padStart(2, "0");
}

function getMaximumMonthValue(): string {
  const now = new Date();
  if (now.getFullYear() > REPORT_YEAR) return REPORT_YEAR + "-12";
  if (now.getFullYear() < REPORT_YEAR) return REPORT_YEAR + "-01";
  return REPORT_YEAR + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

function getMonthDates(value: string) {
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const lastDay = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    start: year + "-" + String(month).padStart(2, "0") + "-01",
    end: year + "-" + String(month).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0"),
  };
}

function formatMonthLabel(value: string): string {
  const parts = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(
    new Date(parts[0], parts[1] - 1, 1),
  );
}

function formatCount(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("id-ID").format(value);
}

function getNumericValue(value: string | undefined): number | null {
  const raw = (value ?? "").trim();
  if (raw === "" || !isValidProvosValue(raw)) return null;
  return Number(raw);
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Terjadi kesalahan. Silakan coba lagi.";
}

function buildFields(
  reportFields: Array<{ metric_code: string | null; semantic_role: string; display_order: number }>,
  personnel: DimensionRow[],
  strength: DimensionRow[],
  education: DimensionRow[],
  scope: ScopeRow[],
): ProvosField[] {
  const personnelById = new Map(personnel.filter((item) => item.active).map((item) => [item.id, item]));
  const personnelScope = scope
    .filter((item) => item.active && personnelById.has(item.personnel_category_id))
    .sort((a, b) => a.display_order - b.display_order)
    .map((item) => personnelById.get(item.personnel_category_id)!);
  const dimensions = new Map<string, DimensionRow>();
  for (const item of [...strength, ...personnelScope, ...education]) {
    if (item.active) dimensions.set(item.code.toUpperCase(), item);
  }

  const atomicFields = reportFields
    .filter((field) => field.semantic_role.toUpperCase() === "ATOMIC" && field.metric_code)
    .sort((a, b) => a.display_order - b.display_order);

  const fields = atomicFields.map((reportField) => {
    const code = String(reportField.metric_code).trim().toUpperCase();
    const dimension = dimensions.get(code);
    if (!dimension) throw new Error("Master dimensi Provos untuk " + code + " belum tersedia.");

    let domain: ProvosField["domain"];
    if (code === "DSPP" || code === "NYATA") domain = "strength";
    else if (code === "PA" || code === "BA" || code === "TA") domain = "personnel";
    else if (code === "SUDAH" || code === "BELUM") domain = "education";
    else throw new Error("Dimensi Provos tidak dikenal: " + code);

    const label = code === "SUDAH"
      ? "SUDAH DIK/TAR"
      : code === "BELUM"
        ? "BELUM DIK/TAR"
        : dimension.name;

    return {
      code,
      label,
      domain,
      dimensionId: dimension.id,
      displayOrder: reportField.display_order,
    };
  });

  const codes = fields.map((field) => field.code);
  if (
    codes.length !== PROVOS_REQUIRED_CODES.length ||
    PROVOS_REQUIRED_CODES.some((code) => !codes.includes(code)) ||
    new Set(codes).size !== codes.length
  ) {
    throw new Error("Kontrak laporan Provos tidak sesuai dengan 7 input kanonis yang diharapkan.");
  }
  return fields;
}

function rowsToFormState(
  fields: ProvosField[],
  rowsByDomain: Record<ProvosField["domain"], StoredRecord[]>,
) {
  const values: Record<string, string> = Object.fromEntries(fields.map((field) => [field.code, ""]));
  const meta: Record<string, RecordMeta> = {};

  for (const field of fields) {
    const config = DOMAIN_CONFIGS.find((item) => item.domain === field.domain)!;
    const row = rowsByDomain[field.domain].find(
      (item) => item[config.dimensionColumn] === field.dimensionId,
    );
    if (!row) continue;

    values[field.code] =
      row.value === null || row.value === undefined || row.data_status === "NOT_REPORTED"
        ? ""
        : String(row.value);
    meta[field.code] = {
      locked: row.source_cell_id !== null,
      source: row.source_cell_id !== null
        ? "DATA SUMBER EXCEL"
        : row.ingestion_method === "FORM"
          ? "INPUT OPERATOR"
          : "DATA TERSIMPAN",
    };
  }

  return { values, meta };
}

export default function ProvosReport({
  operator,
  onBack,
}: {
  operator: ActiveOperator;
  onBack: () => void;
}) {
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue);
  const [fields, setFields] = useState<ProvosField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [recordMeta, setRecordMeta] = useState<Record<string, RecordMeta>>({});
  const [period, setPeriod] = useState<ReportPeriod | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [reportTypeId, setReportTypeId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  const maxMonth = getMaximumMonthValue();
  const monthLabel = formatMonthLabel(monthValue);

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
          periodResult,
          userResult,
          personnelResult,
          scopeResult,
          strengthResult,
          educationResult,
        ] = await Promise.all([
          supabase.from("provos_data_contracts")
            .select("id,report_type_id,status,code")
            .eq("code", CONTRACT_CODE)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("report_periods")
            .select("id,period_label,period_start,period_end,report_year,report_month")
            .eq("period_type", "MONTH")
            .eq("report_year", Number(monthValue.slice(0, 4)))
            .eq("report_month", Number(monthValue.slice(5, 7)))
            .maybeSingle(),
          supabase.auth.getUser(),
          supabase.from("personnel_categories")
            .select("id,code,name,display_order,active")
            .eq("active", true)
            .order("display_order", { ascending: true }),
          supabase.from("provos_personnel_scope")
            .select("personnel_category_id,display_order,active")
            .eq("active", true)
            .order("display_order", { ascending: true }),
          supabase.from("provos_strength_measures")
            .select("id,code,name,display_order,active")
            .eq("active", true)
            .order("display_order", { ascending: true }),
          supabase.from("education_statuses")
            .select("id,code,name,display_order,active")
            .eq("active", true)
            .order("display_order", { ascending: true }),
        ]);

        if (!active) return;
        if (contractResult.error || !contractResult.data) {
          throw new Error("Kontrak input Provos 2026 belum tersedia atau tidak aktif.");
        }
        if (periodResult.error) throw periodResult.error;
        if (userResult.error || !userResult.data.user) {
          throw new Error("Sesi operator tidak dapat diverifikasi. Silakan masuk kembali.");
        }
        if (personnelResult.error || !personnelResult.data) throw new Error("Master personel gagal dimuat.");
        if (scopeResult.error || !scopeResult.data) throw new Error("Cakupan kategori personel Provos gagal dimuat.");
        if (strengthResult.error || !strengthResult.data) throw new Error("Master DSPP/NYATA gagal dimuat.");
        if (educationResult.error || !educationResult.data) throw new Error("Master status DIK/TAR gagal dimuat.");

        const dataContract = contractResult.data;
        const [reportContractResult, contractFieldsResult] = await Promise.all([
          supabase.from("provos_report_contracts")
            .select("id,report_type_id,data_contract_id,status,code")
            .eq("data_contract_id", dataContract.id)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("provos_data_contract_fields")
            .select("field_code,form_input")
            .eq("contract_id", dataContract.id),
        ]);
        if (!active) return;
        if (reportContractResult.error || !reportContractResult.data) {
          throw new Error("Kontrak rekapitulasi Provos aktif belum tersedia.");
        }
        if (contractFieldsResult.error || !contractFieldsResult.data) {
          throw new Error("Field kontrak Provos gagal dimuat.");
        }
        const requiredContractInputs = [
          "period_id",
          "pomdam_id",
          "personnel_category_id",
          "strength_measure_id",
          "education_status_id",
          "value",
          "data_status",
        ];
        const inputCodes = new Set(
          contractFieldsResult.data.filter((item) => item.form_input).map((item) => item.field_code),
        );
        if (requiredContractInputs.some((code) => !inputCodes.has(code))) {
          throw new Error("Field input kontrak Provos belum lengkap.");
        }

        const reportFieldsResult = await supabase.from("provos_report_contract_fields")
          .select("metric_code,semantic_role,display_order")
          .eq("report_contract_id", reportContractResult.data.id)
          .order("display_order", { ascending: true });
        if (reportFieldsResult.error || !reportFieldsResult.data) {
          throw new Error("Pemetaan field laporan Provos gagal dimuat.");
        }

        const resolvedFields = buildFields(
          reportFieldsResult.data,
          personnelResult.data as DimensionRow[],
          strengthResult.data as DimensionRow[],
          educationResult.data as DimensionRow[],
          scopeResult.data as ScopeRow[],
        );

        const selectedPeriod = (periodResult.data as ReportPeriod | null) ?? null;
        const [strengthRowsResult, personnelRowsResult, educationRowsResult, submissionResult] =
          selectedPeriod
            ? await Promise.all([
                supabase.from("provos_strength_records")
                  .select("id,strength_measure_id,value,data_status,source_cell_id,ingestion_method")
                  .eq("period_id", selectedPeriod.id)
                  .eq("pomdam_id", operator.pomdam.id),
                supabase.from("provos_personnel_records")
                  .select("id,personnel_category_id,value,data_status,source_cell_id,ingestion_method")
                  .eq("period_id", selectedPeriod.id)
                  .eq("pomdam_id", operator.pomdam.id),
                supabase.from("provos_education_records")
                  .select("id,education_status_id,value,data_status,source_cell_id,ingestion_method")
                  .eq("period_id", selectedPeriod.id)
                  .eq("pomdam_id", operator.pomdam.id),
                supabase.from("report_submissions")
                  .select("id,status,revision,submitted_by,submitted_at")
                  .eq("report_type_id", reportContractResult.data.report_type_id)
                  .eq("period_id", selectedPeriod.id)
                  .eq("pomdam_id", operator.pomdam.id)
                  .maybeSingle(),
              ])
            : [
                { data: [], error: null },
                { data: [], error: null },
                { data: [], error: null },
                { data: null, error: null },
              ];

        if (!active) return;
        if (strengthRowsResult.error) throw strengthRowsResult.error;
        if (personnelRowsResult.error) throw personnelRowsResult.error;
        if (educationRowsResult.error) throw educationRowsResult.error;
        if (submissionResult.error) throw submissionResult.error;

        const rowsByDomain = {
          strength: (strengthRowsResult.data ?? []) as StoredRecord[],
          personnel: (personnelRowsResult.data ?? []) as StoredRecord[],
          education: (educationRowsResult.data ?? []) as StoredRecord[],
        };
        const formState = rowsToFormState(resolvedFields, rowsByDomain);

        setFields(resolvedFields);
        setValues(formState.values);
        setRecordMeta(formState.meta);
        setPeriod(selectedPeriod);
        setSubmission((submissionResult.data as SubmissionRow | null) ?? null);
        setReportTypeId(reportContractResult.data.report_type_id);
        setCurrentUserId(userResult.data.user.id);
        setLoading(false);
      } catch (error) {
        if (!active) return;
        setFields([]);
        setValues({});
        setRecordMeta({});
        setErrorMessage(getErrorMessage(error));
        setLoading(false);
      }
    }

    void loadReport();
    return () => {
      active = false;
    };
  }, [monthValue, operator.pomdam.id, refreshKey]);

  const invalidCodes = useMemo(() => getProvosInvalidCodes(values), [values]);
  const reportedCount = useMemo(() => countProvosReported(values), [values]);
  const personnelTotal = useMemo(() => getProvosTotal(values, ["PA", "BA", "TA"]), [values]);
  const educationTotal = useMemo(() => getProvosTotal(values, ["SUDAH", "BELUM"]), [values]);
  const sourceLockedCount = useMemo(
    () => fields.filter((field) => recordMeta[field.code]?.locked).length,
    [fields, recordMeta],
  );
  const editableCount = fields.length - sourceLockedCount;
  const submissionOwnerConflict = Boolean(
    submission && currentUserId && submission.submitted_by !== currentUserId,
  );
  const currentSubmissionLabel = submission?.status === "SUBMITTED"
    ? "SUDAH DIKIRIM"
    : submission?.status === "REOPENED"
      ? "DIBUKA KEMBALI"
      : period
        ? "DATA TERSEDIA"
        : "BELUM DIISI";
  const canSave =
    Boolean(supabase) &&
    !loading &&
    !saving &&
    fields.length === PROVOS_REQUIRED_CODES.length &&
    invalidCodes.length === 0 &&
    reportedCount > 0 &&
    editableCount > 0 &&
    !submissionOwnerConflict;

  function updateValue(code: string, value: string) {
    setValues((current) => ({ ...current, [code]: value }));
    setErrorMessage("");
    setSaveMessage("");
  }

  async function handleSave() {
    if (!supabase || !canSave || saving || !reportTypeId) return;
    setSaving(true);
    setErrorMessage("");
    setSaveMessage("");

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error("Sesi operator telah berakhir. Silakan masuk kembali.");
      }
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
          targetPeriod = existingPeriod as ReportPeriod;
        } else {
          targetPeriod = insertedPeriod as ReportPeriod;
        }
      }
      if (!targetPeriod) throw new Error("Periode laporan tidak dapat disiapkan.");

      for (const config of DOMAIN_CONFIGS) {
        const domainFields = fields.filter((field) => field.domain === config.domain);
        const { data: existingData, error: existingError } = await supabase
          .from(config.table)
          .select("id,value,data_status,source_cell_id,ingestion_method," + config.dimensionColumn)
          .eq("period_id", targetPeriod.id)
          .eq("pomdam_id", operator.pomdam.id);
        if (existingError) throw existingError;

        const existingByDimension = new Map<string, StoredRecord>();
        for (const row of (existingData ?? []) as unknown as StoredRecord[]) {
          const dimensionId = String(row[config.dimensionColumn] ?? "");
          if (dimensionId) existingByDimension.set(dimensionId, row);
        }

        const inserts: Record<string, unknown>[] = [];
        const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];

        for (const field of domainFields) {
          const existing = existingByDimension.get(field.dimensionId);
          if (existing?.source_cell_id) continue;

          const rawValue = (values[field.code] ?? "").trim();
          const reported = rawValue !== "";
          const payload: Record<string, unknown> = {
            period_id: targetPeriod.id,
            pomdam_id: operator.pomdam.id,
            value: reported ? Number(rawValue) : null,
            data_status: reported ? "VALID" : "NOT_REPORTED",
            source_cell_id: null,
            ingestion_method: "FORM",
            source_value_strategy: "DIRECT",
            notes: "Input melalui form Operator",
          };
          payload[config.dimensionColumn] = field.dimensionId;

          if (existing) {
            updates.push({ id: existing.id, payload });
          } else {
            inserts.push(payload);
          }
        }

        if (inserts.length > 0) {
          const { error } = await supabase.from(config.table).insert(inserts);
          if (error) throw error;
        }

        for (const update of updates) {
          const { data, error } = await supabase
            .from(config.table)
            .update(update.payload)
            .eq("id", update.id)
            .is("source_cell_id", null)
            .select("id")
            .maybeSingle();
          if (error) throw error;
          if (!data) {
            throw new Error("Data " + config.domain + " berubah saat disimpan. Muat ulang dan periksa sumber datanya.");
          }
        }
      }

      const submittedAt = new Date().toISOString();
      if (submission) {
        const { error } = await supabase.from("report_submissions").update({
          status: "SUBMITTED",
          revision: submission.revision + 1,
          submitted_at: submittedAt,
          updated_at: submittedAt,
        }).eq("id", submission.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("report_submissions").insert({
          report_type_id: reportTypeId,
          period_id: targetPeriod.id,
          pomdam_id: operator.pomdam.id,
          submitted_by: userData.user.id,
          status: "SUBMITTED",
          revision: 1,
          submitted_at: submittedAt,
          updated_at: submittedAt,
        });
        if (error) throw error;
      }

      setSaveMessage("Laporan Provos " + monthLabel + " berhasil disimpan dan dikirim.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function summaryValue(code: string): number | null {
    return getNumericValue(values[code]);
  }

  return (
    <section className="gakkum-report provos-report">
      <button
        className="back-link"
        type="button"
        onClick={showForm ? () => setShowForm(false) : onBack}
      >
        <span aria-hidden="true">←</span>
        {showForm ? "Kembali ke ringkasan" : "Kembali ke dashboard"}
      </button>

      <div className="gakkum-heading">
        <div>
          <p className="eyebrow">LAPORAN 04 · REKAPITULASI PROVOS TNI AD</p>
          <h1>Rekapitulasi Provos TNI AD</h1>
          <p>
            {showForm
              ? "Isi data kekuatan, personel, dan pendidikan DIK/TAR untuk Pomdam."
              : "Pantau rekapitulasi Provos dan buka formulir pengisian periode laporan."}
          </p>
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
              disabled={loading || fields.length !== PROVOS_REQUIRED_CODES.length}
            >
              {loading
                ? "MEMUAT FORM..."
                : fields.length !== PROVOS_REQUIRED_CODES.length
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

      <div className="gakkum-summary-grid provos-summary-grid">
        <article className="gakkum-summary-card">
          <span>DSPP</span>
          <strong>{formatCount(summaryValue("DSPP"))}</strong>
          <small>Daftar susunan personel</small>
        </article>
        <article className="gakkum-summary-card">
          <span>NYATA</span>
          <strong>{formatCount(summaryValue("NYATA"))}</strong>
          <small>Kekuatan personel nyata</small>
        </article>
        <article className="gakkum-summary-card gakkum-summary-primary">
          <span>JUMLAH PERSONEL</span>
          <strong>{formatCount(personnelTotal)}</strong>
          <small>PA + BA + TA · dihitung otomatis</small>
        </article>
        <article className="gakkum-summary-card">
          <span>JUMLAH DIK/TAR</span>
          <strong>{formatCount(educationTotal)}</strong>
          <small>SUDAH + BELUM · dihitung otomatis</small>
        </article>
      </div>

      <div className="gakkum-notice">
        <strong>{reportedCount} dari 7 input memiliki angka.</strong>
        <span>Angka nol adalah nilai sah. Kolom kosong berarti belum dilaporkan dan tidak diubah menjadi nol.</span>
      </div>
      {sourceLockedCount > 0 && (
        <div className="gakkum-notice gakkum-notice-info">
          <strong>Data sumber Excel terkunci.</strong>
          <span>
            {sourceLockedCount} dari 7 input berasal dari workbook impor dan tidak dapat ditimpa operator.
          </span>
        </div>
      )}
      {submissionOwnerConflict && (
        <div className="gakkum-notice gakkum-notice-warning">
          <strong>Laporan dikirim oleh akun lain.</strong>
          <span>Data hanya dapat dilihat dari akun ini; perubahan dilakukan oleh pengirim atau setelah dibuka pengelola.</span>
        </div>
      )}
      {errorMessage && <div className="gakkum-feedback gakkum-feedback-error" role="alert">{errorMessage}</div>}
      {saveMessage && <div className="gakkum-feedback gakkum-feedback-success" role="status">{saveMessage}</div>}

      {loading ? (
        <div className="gakkum-loading">Memuat data Provos...</div>
      ) : showForm ? (
        <>
          <div className="gakkum-section-heading">
            <div>
              <p className="eyebrow">RINCIAN DATA</p>
              <h2>Masukkan data Provos per kategori</h2>
            </div>
            <span>ANGKA PERSONEL</span>
          </div>

          <div className="provos-groups">
            {PROVOS_GROUPS.map((group, groupIndex) => {
              const groupFields = group.codes
                .map((code) => fields.find((field) => field.code === code))
                .filter((field): field is ProvosField => Boolean(field));
              const total = "totalCodes" in group
                ? getProvosTotal(values, group.totalCodes)
                : null;

              return (
                <article className="provos-group-card" key={group.key}>
                  <div className="provos-group-heading">
                    <div className="provos-group-number">{String(groupIndex + 1).padStart(2, "0")}</div>
                    <div className="provos-group-title">
                      <h3>{group.title}</h3>
                      <p>{group.description}</p>
                    </div>
                    {"totalLabel" in group && (
                      <div className="provos-derived">
                        <span>{group.totalLabel}</span>
                        <strong>{formatCount(total)}</strong>
                      </div>
                    )}
                  </div>
                  <div className="provos-input-list">
                    {groupFields.map((field) => {
                      const meta = recordMeta[field.code];
                      return (
                        <div className="provos-input-row" key={field.code}>
                          <div className="provos-input-copy">
                            <strong>{field.label}</strong>
                            <small>
                              {meta ? meta.source : "BELUM ADA INPUT"}
                              {meta?.locked ? " · TERKUNCI" : ""}
                            </small>
                          </div>
                          <label className="provos-input-control">
                            <span className="sr-only">{field.label}</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              step="1"
                              value={values[field.code] ?? ""}
                              placeholder="—"
                              disabled={saving || meta?.locked || submissionOwnerConflict}
                              onChange={(event) => updateValue(field.code, event.target.value)}
                            />
                            <em>ORANG</em>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="gakkum-form-footer">
            <div>
              <strong>{reportedCount} dari 7 input memiliki angka.</strong>
              <small>Jumlah personel dan jumlah DIK/TAR dihitung otomatis dari rincian kategorinya.</small>
              {invalidCodes.length > 0 && (
                <small className="gakkum-inline-error">
                  {invalidCodes.length} input harus berupa bilangan bulat nol atau lebih.
                </small>
              )}
            </div>
            <button type="button" onClick={handleSave} disabled={!canSave || saving || loading}>
              {saving ? "MENYIMPAN..." : submission ? "SIMPAN PERUBAHAN" : "SIMPAN & KIRIM LAPORAN"}
            </button>
          </div>
        </>
      ) : (
        <div className="gakkum-overview-note provos-overview-note">
          <strong>Ringkasan laporan siap.</strong>
          <span>
            Pilih tombol {editableCount > 0 && !submissionOwnerConflict ? "ISI LAPORAN" : "LIHAT LAPORAN"} untuk membuka rincian Provos periode {monthLabel}.
          </span>
        </div>
      )}
    </section>
  );
}
