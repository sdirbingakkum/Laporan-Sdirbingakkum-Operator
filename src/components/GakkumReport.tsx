import { useEffect, useMemo, useState } from "react";
import type { ActiveOperator } from "../lib/operator-auth";
import {
  GAKKUM_ACTIVITY_GROUPS,
  GAKKUM_REQUIRED_CODES,
  getGakkumInvalidCodes,
  getGakkumTotal,
} from "../lib/gakkum-report";
import { supabase } from "../lib/supabase";

const CONTRACT_CODE = "GAKKUM_POMDAM_INPUT_2026";
const REPORT_YEAR = 2026;

type GakkumField = {
  code: string;
  label: string;
  versionId: string;
  displayOrder: number;
};

type PeriodRow = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  report_year: number;
  report_month: number;
};

type RecordRow = {
  id: string;
  activity_version_id: string;
  value: number | null;
  data_status: string;
  ingestion_method: string;
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

function formatMonthLabel(value: string): string {
  const parts = value.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function getMonthDates(value: string) {
  const parts = value.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    start: year + "-" + String(month).padStart(2, "0") + "-01",
    end: year + "-" + String(month).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0"),
  };
}

function emptyValues(fields: GakkumField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.code, ""]));
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

export default function GakkumReport({
  operator,
  onBack,
}: {
  operator: ActiveOperator;
  onBack: () => void;
}) {
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue);
  const [fields, setFields] = useState<GakkumField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [recordMeta, setRecordMeta] = useState<Record<string, RecordMeta>>({});
  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
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
          contractFieldsResult,
          activitiesResult,
          versionsResult,
          userResult,
        ] = await Promise.all([
          supabase.from("gakkum_data_contracts")
            .select("id,report_type_id,status")
            .eq("code", CONTRACT_CODE)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("gakkum_data_contracts")
            .select("id")
            .eq("code", CONTRACT_CODE)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("gakkum_activities")
            .select("id,code,canonical_name")
            .eq("active", true),
          supabase.from("gakkum_activity_versions")
            .select("id,activity_id,source_label,level,display_order,parent_version_id")
            .eq("taxonomy_version", "CURRENT_2026"),
          supabase.auth.getUser(),
        ]);

        if (!active) return;
        if (contractResult.error || !contractResult.data) throw new Error("Kontrak laporan Gakkum 2026 belum tersedia.");
        if (contractFieldsResult.error || !contractFieldsResult.data) throw new Error("Kontrak input Gakkum belum dapat dibaca.");
        if (activitiesResult.error || !activitiesResult.data) throw new Error("Daftar kegiatan Gakkum belum dapat dibaca.");
        if (versionsResult.error || !versionsResult.data) throw new Error("Taksonomi kegiatan Gakkum belum dapat dibaca.");
        if (userResult.error || !userResult.data.user) throw new Error("Sesi operator tidak ditemukan.");

        const contractId = contractFieldsResult.data.id;
        const { data: contractFields, error: fieldsError } = await supabase
          .from("gakkum_data_contract_fields")
          .select("field_code,label,display_order,form_input,calculated")
          .eq("contract_id", contractId)
          .eq("form_input", true)
          .eq("calculated", false)
          .order("display_order", { ascending: true });

        if (fieldsError || !contractFields) throw new Error("Daftar isian Gakkum belum dapat dibaca.");

        const activityRows = activitiesResult.data as Array<{ id: string; code: string; canonical_name: string }>;
        const versionRows = versionsResult.data as Array<{
          id: string;
          activity_id: string;
          source_label: string;
          level: number;
          display_order: number;
          parent_version_id: string | null;
        }>;

        const resolvedFields: GakkumField[] = (contractFields as Array<{
          field_code: string;
          label: string;
          display_order: number;
        }>).map((field) => {
          const activity = activityRows.find((item) => item.code === field.field_code);
          const version = activity
            ? versionRows.find((item) => item.activity_id === activity.id)
            : undefined;
          if (!activity || !version) throw new Error("Pemetaan kegiatan " + field.field_code + " belum lengkap.");
          return {
            code: field.field_code,
            label: field.label || activity.canonical_name,
            versionId: version.id,
            displayOrder: field.display_order,
          };
        });

        const resolvedCodes = resolvedFields.map((field) => field.code);
        if (
          resolvedFields.length !== GAKKUM_REQUIRED_CODES.length ||
          GAKKUM_REQUIRED_CODES.some((code) => !resolvedCodes.includes(code))
        ) {
          throw new Error("Struktur 14 kegiatan Gakkum tidak sesuai dengan kontrak data.");
        }

        const { year, month } = getMonthDates(monthValue);
        const { data: periodData, error: periodError } = await supabase
          .from("report_periods")
          .select("id,period_label,period_start,period_end,report_year,report_month")
          .eq("period_type", "MONTH")
          .eq("report_year", year)
          .eq("report_month", month)
          .maybeSingle();

        if (!active) return;
        if (periodError) throw periodError;

        setFields(resolvedFields);
        setCurrentUserId(userResult.data.user.id);

        if (!periodData) {
          setPeriod(null);
          setValues(emptyValues(resolvedFields));
          setRecordMeta({});
          setSubmission(null);
          setLoading(false);
          return;
        }

        const selectedPeriod = periodData as PeriodRow;
        const versionIds = resolvedFields.map((field) => field.versionId);

        const [recordsResult, submissionResult] = await Promise.all([
          supabase.from("gakkum_records")
            .select("id,activity_version_id,value,data_status,ingestion_method,source_cell_id")
            .eq("period_id", selectedPeriod.id)
            .eq("pomdam_id", operator.pomdam.id)
            .in("activity_version_id", versionIds),
          supabase.from("report_submissions")
            .select("id,status,revision,submitted_by,submitted_at")
            .eq("report_type_id", contractResult.data.report_type_id)
            .eq("period_id", selectedPeriod.id)
            .eq("pomdam_id", operator.pomdam.id)
            .maybeSingle(),
        ]);

        if (!active) return;
        if (recordsResult.error) throw recordsResult.error;
        if (submissionResult.error) throw submissionResult.error;

        const recordRows = (recordsResult.data ?? []) as RecordRow[];
        const nextValues = emptyValues(resolvedFields);
        const nextMeta: Record<string, RecordMeta> = {};

        for (const record of recordRows) {
          const field = resolvedFields.find((item) => item.versionId === record.activity_version_id);
          if (!field) continue;
          nextValues[field.code] = record.value === null || record.data_status === "NOT_REPORTED"
            ? ""
            : String(record.value);
          nextMeta[field.code] = {
            locked: record.source_cell_id !== null || record.ingestion_method === "EXCEL",
            source: record.ingestion_method,
          };
        }

        setPeriod(selectedPeriod);
        setValues(nextValues);
        setRecordMeta(nextMeta);
        setSubmission((submissionResult.data as SubmissionRow | null) ?? null);
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

  const fieldsByCode = useMemo(
    () => new Map(fields.map((field) => [field.code, field])),
    [fields],
  );

  const groupedFields = useMemo(
    () => GAKKUM_ACTIVITY_GROUPS.map((group) => ({
      ...group,
      fields: group.codes.flatMap((code) => {
        const field = fieldsByCode.get(code);
        return field ? [field] : [];
      }),
    })).filter((group) => group.fields.length > 0),
    [fieldsByCode],
  );

  const invalidCodes = useMemo(() => getGakkumInvalidCodes(values), [values]);
  const reportedCount = GAKKUM_REQUIRED_CODES.filter((code) => (values[code] ?? "").trim() !== "").length;
  const grandTotal = getGakkumTotal(values, GAKKUM_REQUIRED_CODES);
  const sourceLockedCount = fields.filter((field) => recordMeta[field.code]?.locked).length;
  const submissionOwnerConflict = Boolean(
    submission && currentUserId && submission.submitted_by !== currentUserId,
  );
  const editableCount = fields.length - sourceLockedCount;
  const canSave = editableCount > 0 && !submissionOwnerConflict && invalidCodes.length === 0;
  const monthLabel = useMemo(() => formatMonthLabel(monthValue), [monthValue]);
  const maxMonth = getMaximumMonthValue();
  const currentSubmissionLabel = submission?.status === "SUBMITTED"
    ? "SUDAH DIKIRIM"
    : submission?.status === "REOPENED"
      ? "DIBUKA KEMBALI"
      : period
        ? "DATA TERSEDIA"
        : "BELUM DIISI";

  function updateValue(code: string, value: string) {
    setValues((current) => ({ ...current, [code]: value }));
    setSaveMessage("");
  }

  async function handleSave() {
    if (!supabase || !canSave || saving) return;
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
          return {
            period_id: targetPeriod!.id,
            pomdam_id: operator.pomdam.id,
            activity_version_id: field.versionId,
            value: isReported ? Number(rawValue) : null,
            data_status: isReported ? "VALID" : "NOT_REPORTED",
            source_cell_id: null,
            ingestion_method: "FORM",
            source_value_strategy: "DIRECT",
          };
        });

      if (rowsToSave.length === 0) throw new Error("Tidak ada kolom yang dapat disimpan.");
      const { error: recordsError } = await supabase
        .from("gakkum_records")
        .upsert(rowsToSave, { onConflict: "period_id,pomdam_id,activity_version_id" });
      if (recordsError) throw recordsError;

      const submittedAt = new Date().toISOString();
      const submissionPayload = {
        status: "SUBMITTED",
        submitted_at: submittedAt,
        updated_at: submittedAt,
      };

      if (submission) {
        const { error: updateSubmissionError } = await supabase
          .from("report_submissions")
          .update({
            ...submissionPayload,
            revision: submission.revision + 1,
          })
          .eq("id", submission.id);
        if (updateSubmissionError) {
          setSaveMessage("Data kegiatan tersimpan, tetapi status pengiriman belum berhasil diperbarui.");
          setRefreshKey((value) => value + 1);
          return;
        }
      } else {
        const { error: insertSubmissionError } = await supabase
          .from("report_submissions")
          .insert({
            report_type_id: "48695751-545b-41cf-b7c3-2e366a0689dc",
            period_id: targetPeriod.id,
            pomdam_id: operator.pomdam.id,
            submitted_by: userData.user.id,
            status: "SUBMITTED",
            revision: 1,
            submitted_at: submittedAt,
          });
        if (insertSubmissionError) {
          setSaveMessage("Data kegiatan tersimpan, tetapi status pengiriman belum berhasil dicatat.");
          setRefreshKey((value) => value + 1);
          return;
        }
      }

      setSaveMessage("Laporan " + monthLabel + " berhasil disimpan dan dikirim.");
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
          <p className="eyebrow">LAPORAN 01 · GIAT GAKKUM</p>
          <h1>Statistik Giat Gakkum</h1>
          <p>{showForm ? "Isi jumlah kegiatan penegakan hukum Pomdam untuk periode yang dipilih." : "Pantau status laporan dan buka formulir pengisian kegiatan Pomdam."}</p>
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

      <div className="gakkum-summary-grid">
        <article className="gakkum-summary-card gakkum-summary-primary">
          <span>TOTAL KEGIATAN</span>
          <strong>{formatCount(grandTotal)}</strong>
          <small>{grandTotal === null ? "Lengkapi seluruh 14 isian untuk menghitung total" : "Akumulasi 14 kegiatan dasar"}</small>
        </article>
        <article className="gakkum-summary-card">
          <span>ISIAN TERLAPOR</span>
          <strong>{reportedCount}<small> / 14</small></strong>
          <small>Kolom dengan nilai angka, termasuk nol</small>
        </article>
        <article className="gakkum-summary-card">
          <span>PERIODE</span>
          <strong className="gakkum-period-value">{monthLabel}</strong>
          <small>{period ? "Periode sudah tersedia di database" : "Periode dibuat saat laporan disimpan"}</small>
        </article>
      </div>

      {sourceLockedCount > 0 && (
        <div className="gakkum-notice gakkum-notice-info">
          <strong>Data sumber Excel terkunci.</strong>
          <span>{sourceLockedCount} isian berasal dari file sumber dan ditampilkan apa adanya agar jejak data tidak berubah.</span>
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
        <div className="gakkum-loading">Memuat data Gakkum...</div>
      ) : showForm ? (
        <>
          <div className="gakkum-section-heading">
            <div>
              <p className="eyebrow">RINCIAN KEGIATAN</p>
              <h2>Data kegiatan Pomdam</h2>
            </div>
            <span>ANGKA KEGIATAN</span>
          </div>

          <div className="gakkum-groups">
            {groupedFields.map((group, groupIndex) => (
              <article className="gakkum-group-card" key={group.key}>
                <div className="gakkum-group-heading">
                  <div className="gakkum-group-number">{String(groupIndex + 1).padStart(2, "0")}</div>
                  <h3>{group.title}</h3>
                  {group.codes.length > 1 && (
                    <div className="gakkum-group-total">
                      <span>{group.totalLabel}</span>
                      <strong>{formatCount(getGakkumTotal(values, group.codes))}</strong>
                    </div>
                  )}
                </div>
                <div className="gakkum-field-list">
                  {group.fields.map((field) => (
                    <div key={field.code}>
                      {field.code === "PENANGKAPAN" && (
                        <div className="gakkum-subgroup-label">UPAYA PAKSA</div>
                      )}
                      <div className="gakkum-field-row">
                        <span className="gakkum-field-index">{String(field.displayOrder).padStart(2, "0")}</span>
                        <div className="gakkum-field-copy">
                          <label htmlFor={"gakkum-" + field.code}>{field.label}</label>
                          <small>
                            {recordMeta[field.code]?.locked
                              ? "DATA SUMBER"
                              : (values[field.code] ?? "").trim() === ""
                                ? "Belum dilaporkan"
                                : "Input operator"}
                          </small>
                        </div>
                        <div className="gakkum-input-wrap">
                          <input
                            id={"gakkum-" + field.code}
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
                          <span>KEGIATAN</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="gakkum-total-panel">
            <div>
              <span>JUMLAH KESELURUHAN</span>
              <small>Hasil penjumlahan 14 kegiatan dasar. Subtotal tidak diinput manual.</small>
            </div>
            <strong>{formatCount(grandTotal)}</strong>
          </div>

          <div className="gakkum-form-footer">
            <div>
              <strong>{reportedCount} dari 14 isian memiliki angka.</strong>
              <small>Kolom kosong akan disimpan sebagai belum dilaporkan, bukan nol.</small>
              {invalidCodes.length > 0 && <small className="gakkum-inline-error">{invalidCodes.length} isian harus berupa bilangan bulat nol atau lebih.</small>}
            </div>
            <button type="button" onClick={handleSave} disabled={!canSave || saving || loading}>
              {saving ? "MENYIMPAN..." : submission ? "SIMPAN PERUBAHAN" : "SIMPAN & KIRIM LAPORAN"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
