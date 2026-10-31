import { useEffect, useMemo, useState } from "react";
import type { ActiveOperator } from "../lib/operator-auth";
import {
  SIM_TNI_ACTIVITY_CODES,
  SIM_TNI_INPUT_CODES,
  SIM_TNI_TYPE_CODES,
  countSimTniReported,
  getSimTniActivityTotal,
  getSimTniInvalidCodes,
  getSimTniTotal,
  getSimTniTypeTotal,
  simTniInputCode,
} from "../lib/sim-tni-report";
import { supabase } from "../lib/supabase";
import ExcelTemplateExportButton from "./ExcelTemplateExportButton";
import "./SimTniReport.css";

const DATA_CONTRACT_CODE = "SIM_TNI_POMDAM_INPUT_2026";
const REPORT_CONTRACT_CODE = "SIM_TNI_POMDAM_LAMPIRAN6_2026";
const REPORT_YEAR = 2026;

type DimensionRow = {
  id: string;
  code: string;
  display_name: string;
  source_label: string | null;
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

type SimActivityRecord = {
  id: string;
  sim_activity_type_id: string;
  sim_type_id: string;
  value: number | null;
  data_status: string;
  source_cell_id: string | null;
  ingestion_method?: string;
};

type SimSummaryRecord = {
  id: string;
  sim_type_id: string;
  value: number | null;
  data_status: string;
  source_cell_id: string | null;
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

function formatMonthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("id-ID").format(value);
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Terjadi kesalahan. Silakan coba lagi.";
}

function isMissingDetailStorage(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" ||
    error.code === "PGRST205" ||
    /sim_activity_records.*(does not exist|not find|schema cache)/i.test(error.message ?? "");
}

function buildEmptyValues(): Record<string, string> {
  return Object.fromEntries(SIM_TNI_ACTIVITY_CODES.flatMap((activity) =>
    SIM_TNI_TYPE_CODES.map((simType) => [simTniInputCode(activity, simType), ""]),
  ));
}

function getSummaryValue(
  summaryRows: SimSummaryRecord[],
  simTypeId: string,
): number | null {
  const row = summaryRows.find((item) => item.sim_type_id === simTypeId);
  if (!row || row.data_status !== "VALID" || row.value === null) return null;
  return Number(row.value);
}

export default function SimTniReport({
  operator,
  onBack,
}: {
  operator: ActiveOperator;
  onBack: () => void;
}) {
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue);
  const [activities, setActivities] = useState<DimensionRow[]>([]);
  const [simTypes, setSimTypes] = useState<DimensionRow[]>([]);
  const [activityRecords, setActivityRecords] = useState<SimActivityRecord[]>([]);
  const [summaryRows, setSummaryRows] = useState<SimSummaryRecord[]>([]);
  const [values, setValues] = useState<Record<string, string>>(buildEmptyValues);
  const [recordMeta, setRecordMeta] = useState<Record<string, RecordMeta>>({});
  const [period, setPeriod] = useState<ReportPeriod | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [reportTypeId, setReportTypeId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [detailStorageReady, setDetailStorageReady] = useState(false);
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
          reportContractResult,
          contractFieldsResult,
          activityResult,
          simTypeResult,
          periodResult,
          userResult,
        ] = await Promise.all([
          supabase.from("sim_data_contracts")
            .select("id,report_type_id,status,code")
            .eq("code", DATA_CONTRACT_CODE)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("sim_report_contracts")
            .select("id,report_type_id,data_contract_id,status,code")
            .eq("code", REPORT_CONTRACT_CODE)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("sim_data_contract_fields")
            .select("field_code,form_input")
            .order("display_order", { ascending: true }),
          supabase.from("sim_activity_types")
            .select("id,code,display_name,source_label,display_order,active")
            .eq("active", true)
            .order("display_order", { ascending: true }),
          supabase.from("sim_types")
            .select("id,code,display_name,source_label,display_order,active")
            .eq("active", true)
            .order("display_order", { ascending: true }),
          supabase.from("report_periods")
            .select("id,period_label,period_start,period_end,report_year,report_month")
            .eq("period_type", "MONTH")
            .eq("report_year", Number(monthValue.slice(0, 4)))
            .eq("report_month", Number(monthValue.slice(5, 7)))
            .maybeSingle(),
          supabase.auth.getUser(),
        ]);

        if (!active) return;
        if (contractResult.error || !contractResult.data) {
          throw new Error("Kontrak input SIM TNI 2026 belum tersedia atau tidak aktif.");
        }
        if (reportContractResult.error || !reportContractResult.data) {
          throw new Error("Kontrak laporan SIM TNI belum tersedia atau tidak aktif.");
        }
        if (reportContractResult.data.data_contract_id !== contractResult.data.id) {
          throw new Error("Kontrak laporan SIM TNI tidak terhubung ke kontrak input aktif.");
        }
        if (contractFieldsResult.error || !contractFieldsResult.data) {
          throw new Error("Field kontrak SIM TNI gagal dimuat.");
        }
        if (activityResult.error || !activityResult.data) {
          throw new Error("Master kegiatan SIM TNI gagal dimuat.");
        }
        if (simTypeResult.error || !simTypeResult.data) {
          throw new Error("Master golongan SIM gagal dimuat.");
        }
        if (periodResult.error) throw periodResult.error;
        if (userResult.error || !userResult.data.user) {
          throw new Error("Sesi operator tidak dapat diverifikasi. Silakan masuk kembali.");
        }

        const requiredInputs = [
          "period_id",
          "pomdam_id",
          "sim_activity_type_id",
          "sim_type_id",
          "value",
        ];
        const inputCodes = new Set(
          contractFieldsResult.data
            .filter((item) => item.form_input)
            .map((item) => item.field_code),
        );
        if (requiredInputs.some((code) => !inputCodes.has(code))) {
          throw new Error("Field input kontrak SIM TNI belum lengkap.");
        }

        const resolvedActivities = activityResult.data as DimensionRow[];
        const resolvedTypes = simTypeResult.data as DimensionRow[];
        if (
          resolvedActivities.length !== SIM_TNI_ACTIVITY_CODES.length ||
          SIM_TNI_ACTIVITY_CODES.some((code) => !resolvedActivities.some((item) => item.code === code)) ||
          resolvedTypes.length !== SIM_TNI_TYPE_CODES.length ||
          SIM_TNI_TYPE_CODES.some((code) => !resolvedTypes.some((item) => item.code === code))
        ) {
          throw new Error("Master kegiatan atau golongan SIM tidak sesuai dengan kontrak 5×5.");
        }

        const selectedPeriod = (periodResult.data as ReportPeriod | null) ?? null;
        let resolvedDetailReady = false;
        let detailRows: SimActivityRecord[] = [];
        let summaryData: SimSummaryRecord[] = [];
        let resolvedSubmission: SubmissionRow | null = null;

        const detailProbe = await supabase.from("sim_activity_records")
          .select("id")
          .limit(1);
        if (!detailProbe.error) {
          resolvedDetailReady = true;
        } else if (!isMissingDetailStorage(detailProbe.error)) {
          throw detailProbe.error;
        }

        if (selectedPeriod) {
          const [summaryResult, detailsResult, submissionResult] = await Promise.all([
            supabase.from("sim_records")
              .select("id,sim_type_id,value,data_status,source_cell_id")
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id),
            resolvedDetailReady
              ? supabase.from("sim_activity_records")
                  .select("id,sim_activity_type_id,sim_type_id,value,data_status,source_cell_id,ingestion_method")
                  .eq("period_id", selectedPeriod.id)
                  .eq("pomdam_id", operator.pomdam.id)
              : Promise.resolve({ data: [], error: null }),
            supabase.from("report_submissions")
              .select("id,status,revision,submitted_by,submitted_at")
              .eq("report_type_id", reportContractResult.data.report_type_id)
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id)
              .maybeSingle(),
          ]);
          if (summaryResult.error) throw summaryResult.error;
          if (detailsResult.error) {
            if (isMissingDetailStorage(detailsResult.error)) {
              resolvedDetailReady = false;
            } else {
              throw detailsResult.error;
            }
          }
          if (submissionResult.error) throw submissionResult.error;

          summaryData = (summaryResult.data ?? []) as SimSummaryRecord[];
          detailRows = (detailsResult.data ?? []) as SimActivityRecord[];
          resolvedSubmission = (submissionResult.data as SubmissionRow | null) ?? null;
        }

        const nextValues = buildEmptyValues();
        const nextMeta: Record<string, RecordMeta> = {};
        for (const activity of resolvedActivities) {
          for (const simType of resolvedTypes) {
            const controlCode = simTniInputCode(activity.code, simType.code);
            const record = detailRows.find(
              (row) =>
                row.sim_activity_type_id === activity.id &&
                row.sim_type_id === simType.id,
            );
            if (!record) continue;
            nextValues[controlCode] =
              record.value === null || record.value === undefined || record.data_status === "NOT_REPORTED"
                ? ""
                : String(record.value);
            nextMeta[controlCode] = {
              locked: record.source_cell_id !== null,
              source: record.source_cell_id !== null
                ? "DATA SUMBER EXCEL"
                : record.ingestion_method === "FORM"
                  ? "INPUT OPERATOR"
                  : "DATA TERSIMPAN",
            };
          }
        }

        if (!active) return;
        setActivities(resolvedActivities);
        setSimTypes(resolvedTypes);
        setActivityRecords(detailRows);
        setSummaryRows(summaryData);
        setValues(nextValues);
        setRecordMeta(nextMeta);
        setPeriod(selectedPeriod);
        setSubmission(resolvedSubmission);
        setReportTypeId(reportContractResult.data.report_type_id);
        setCurrentUserId(userResult.data.user.id);
        setDetailStorageReady(resolvedDetailReady);
        setLoading(false);
      } catch (error) {
        if (!active) return;
        setActivities([]);
        setSimTypes([]);
        setActivityRecords([]);
        setSummaryRows([]);
        setValues(buildEmptyValues());
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

  const invalidCodes = useMemo(() => getSimTniInvalidCodes(values), [values]);
  const reportedCount = useMemo(() => countSimTniReported(values), [values]);
  const fieldCount = SIM_TNI_INPUT_CODES.length;
  const sourceLockedCount = useMemo(
    () => Object.values(recordMeta).filter((meta) => meta.locked).length,
    [recordMeta],
  );
  const editableCount = fieldCount - sourceLockedCount;
  const submissionOwnerConflict = Boolean(
    submission && currentUserId && submission.submitted_by !== currentUserId,
  );
  const hasLegacySummaryOnly =
    activityRecords.length === 0 &&
    summaryRows.some((row) => row.source_cell_id !== null);
  const currentSubmissionLabel = submission?.status === "SUBMITTED"
    ? "SUDAH DIKIRIM"
    : submission?.status === "REOPENED"
      ? "DIBUKA KEMBALI"
      : period
        ? "DATA TERSEDIA"
        : "BELUM DIISI";

  const inputShapeReady =
    activities.length === SIM_TNI_ACTIVITY_CODES.length &&
    simTypes.length === SIM_TNI_TYPE_CODES.length;
  const canSave =
    Boolean(supabase) &&
    detailStorageReady &&
    !hasLegacySummaryOnly &&
    !loading &&
    !saving &&
    inputShapeReady &&
    reportedCount === fieldCount &&
    invalidCodes.length === 0 &&
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
        const label = monthLabel;
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

      const facts = activities.flatMap((activity) =>
        simTypes.map((simType) => ({
          activity_code: activity.code,
          sim_type_code: simType.code,
          value: Number(values[simTniInputCode(activity.code, simType.code)]),
        })),
      );
      const { error: saveError } = await supabase.rpc("submit_sim_tni_pomdam_report", {
        p_period_id: targetPeriod.id,
        p_pomdam_id: operator.pomdam.id,
        p_facts: facts,
      });
      if (saveError) {
        if (
          saveError.code === "PGRST202" ||
          /submit_sim_tni_pomdam_report/i.test(saveError.message)
        ) {
          throw new Error("Jalur simpan detail 5×5 SIM TNI belum tersedia di Supabase. Ringkasan impor tetap aman; laporan belum dikirim.");
        }
        throw saveError;
      }

      setSaveMessage("Laporan SIM TNI " + monthLabel + " berhasil disimpan dan dikirim.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const summaryByType = useMemo(
    () => new Map(simTypes.map((item) => [
      item.code,
      getSummaryValue(summaryRows, item.id),
    ])),
    [simTypes, summaryRows],
  );
  const detailTotal = useMemo(() => getSimTniTotal(values), [values]);
  const summaryTotal = summaryRows.length > 0
    ? summaryRows.reduce((total, row) =>
        total + (row.data_status === "VALID" && row.value !== null ? Number(row.value) : 0), 0)
    : null;
  const headlineTotal = summaryTotal ?? detailTotal;
  const typeLabels = new Map(simTypes.map((item) => [item.code, item.source_label || item.display_name]));

  return (
    <section className="gakkum-report sim-tni-report">
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
          <p className="eyebrow">LAPORAN 05 · REKAPITULASI SIM TNI</p>
          <h1>Rekapitulasi SIM TNI</h1>
          <p>
            {showForm
              ? "Isi jumlah SIM menurut kegiatan penerbitan dan golongan SIM."
              : "Pantau jumlah SIM dan buka formulir rinci penyelenggaraan SIM TNI."}
          </p>
        </div>
        <div className="gakkum-heading-actions">
          <div className="gakkum-status">
            <span className="gakkum-status-dot" />
            {currentSubmissionLabel}
          </div>
          {inputShapeReady && (
            <ExcelTemplateExportButton
              kind="SIM_TNI"
              periodValue={monthValue}
              pomdamCode={operator.pomdam.code}
              pomdamName={operator.pomdam.displayName}
              values={Object.fromEntries(SIM_TNI_TYPE_CODES.map((typeCode) => {
                const detailValue = countSimTniReported(values) === SIM_TNI_INPUT_CODES.length
                  ? getSimTniTypeTotal(values, typeCode)
                  : null;
                const summaryValue = summaryByType.get(typeCode);
                const value = detailValue ?? summaryValue;
                return [typeCode, value === null || value === undefined ? "" : String(value)];
              }))}
              disabled={loading || saving}
            />
          )}
          {!showForm && (
            <button
              className="gakkum-primary-action"
              type="button"
              onClick={() => setShowForm(true)}
              disabled={loading || !inputShapeReady}
            >
              {loading
                ? "MEMUAT FORM..."
                : !inputShapeReady
                  ? "FORM BELUM TERSEDIA"
                  : hasLegacySummaryOnly
                    ? "LIHAT RINGKASAN IMPOR"
                    : "ISI LAPORAN"}
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

      <div className="gakkum-summary-grid sim-tni-summary-grid">
        <article className="gakkum-summary-card gakkum-summary-primary">
          <span>TOTAL SIM</span>
          <strong>{formatCount(headlineTotal)}</strong>
          <small>Akumulasi lima golongan SIM pada periode terpilih</small>
        </article>
        {SIM_TNI_TYPE_CODES.map((code) => (
          <article className="gakkum-summary-card" key={code}>
            <span>{typeLabels.get(code) ?? code.replace("_", " ")}</span>
            <strong>{formatCount(summaryByType.get(code) ?? null)}</strong>
            <small>{code === "BII_KHUSUS" ? "B II SUS" : "Golongan SIM"}</small>
          </article>
        ))}
      </div>

      <div className="gakkum-notice">
        <strong>{reportedCount} dari 25 input memiliki angka.</strong>
        <span>Setiap nilai adalah jumlah SIM yang diterbitkan/diproses untuk satu kegiatan dan satu golongan. Nilai nol harus diisi eksplisit.</span>
      </div>

      {!detailStorageReady && (
        <div className="gakkum-notice gakkum-notice-warning">
          <strong>Backend input rinci belum diaktifkan.</strong>
          <span>
            Database saat ini hanya menyediakan ringkasan per golongan. Form 5×5 belum dapat disimpan karena tabel fakta aktivitas dan RPC transaksi belum tersedia; penyimpanan dinonaktifkan agar rincian aktivitas tidak hilang.
          </span>
        </div>
      )}

      {hasLegacySummaryOnly && (
        <div className="gakkum-notice gakkum-notice-info">
          <strong>Periode ini hanya memiliki ringkasan impor.</strong>
          <span>
            Angka lama sudah tersimpan per golongan dan dikunci oleh sumber Excel. Rincian lima kegiatan tidak akan direka ulang dari total tersebut.
          </span>
        </div>
      )}

      {sourceLockedCount > 0 && (
        <div className="gakkum-notice gakkum-notice-info">
          <strong>Fakta sumber Excel terkunci.</strong>
          <span>{sourceLockedCount} dari 25 fakta berasal dari data sumber dan tidak dapat ditimpa Operator.</span>
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
        <div className="gakkum-loading">Memuat data SIM TNI...</div>
      ) : showForm ? (
        <>
          <div className="gakkum-section-heading">
            <div>
              <p className="eyebrow">RINCIAN 5 × 5</p>
              <h2>Penyelenggaraan SIM TNI menurut kegiatan</h2>
            </div>
            <span>JUMLAH SIM</span>
          </div>

          <div className="sim-tni-activity-list">
            {activities.map((activity, index) => {
              const activityCodes = simTypes.map((simType) =>
                simTniInputCode(activity.code, simType.code),
              );
              const activityTotal = getSimTniActivityTotal(values, activity.code);
              return (
                <article className="sim-tni-activity-card" key={activity.code}>
                  <div className="sim-tni-activity-heading">
                    <div className="sim-tni-activity-number">{String(index + 1).padStart(2, "0")}</div>
                    <div className="sim-tni-activity-copy">
                      <h3>{activity.display_name}</h3>
                      <small>{activity.source_label}</small>
                    </div>
                    <div className="sim-tni-activity-total">
                      <span>TOTAL KEGIATAN</span>
                      <strong>{formatCount(activityTotal)}</strong>
                    </div>
                  </div>
                  <div className="sim-tni-type-head">
                    {simTypes.map((simType) => (
                      <span key={simType.code}>{simType.source_label || simType.display_name}</span>
                    ))}
                  </div>
                  <div className="sim-tni-input-grid">
                    {simTypes.map((simType) => {
                      const controlCode = simTniInputCode(activity.code, simType.code);
                      const meta = recordMeta[controlCode];
                      return (
                        <label className="sim-tni-input-control" key={controlCode}>
                          <span className="sim-tni-input-label">{simType.display_name}</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            value={values[controlCode] ?? ""}
                            placeholder="—"
                            disabled={
                              saving ||
                              !detailStorageReady ||
                              hasLegacySummaryOnly ||
                              Boolean(meta?.locked) ||
                              submissionOwnerConflict
                            }
                            onChange={(event) => updateValue(controlCode, event.target.value)}
                          />
                        </label>
                      );
                    })}
                  </div>
                  <input
                    className="sim-tni-a11y-total"
                    aria-hidden="true"
                    tabIndex={-1}
                    value={activityCodes.length}
                    readOnly
                  />
                </article>
              );
            })}
          </div>

          <div className="sim-tni-derived-panel">
            <div className="sim-tni-derived-heading">
              <div>
                <p className="eyebrow">REKAP OTOMATIS</p>
                <h2>Total per golongan SIM</h2>
              </div>
              <strong>{formatCount(detailTotal)}</strong>
            </div>
            <div className="sim-tni-derived-grid">
              {simTypes.map((simType) => (
                <div className="sim-tni-derived-card" key={simType.code}>
                  <span>{simType.source_label || simType.display_name}</span>
                  <strong>{formatCount(getSimTniTypeTotal(values, simType.code))}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="gakkum-form-footer">
            <div>
              <strong>{reportedCount} dari 25 input memiliki angka.</strong>
              <small>Semua 25 nilai harus diisi, termasuk nol yang dilaporkan. Total dihitung otomatis dari lima kegiatan.</small>
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
        <div className="gakkum-overview-note sim-tni-overview-note">
          <strong>Ringkasan SIM TNI siap.</strong>
          <span>
            Pilih tombol {hasLegacySummaryOnly ? "LIHAT RINGKASAN IMPOR" : "ISI LAPORAN"} untuk membuka periode {monthLabel}.
          </span>
        </div>
      )}
    </section>
  );
}
