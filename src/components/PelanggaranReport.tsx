import { useEffect, useMemo, useState } from "react";
import type { ActiveOperator } from "../lib/operator-auth";
import {
  VIOLATION_GROUPS,
  VIOLATION_REQUIRED_CODES,
  countViolationReported,
  getViolationInvalidCodes,
  getViolationTotal,
  type ViolationCategoryCode,
  type ViolationField,
} from "../lib/violation-report";
import { supabase } from "../lib/supabase";

const CONTRACT_CODE = "PELANGGARAN_POMDAM_INPUT_2026";
const REPORT_YEAR = 2026;
const FALLBACK_REPORT_TYPE_ID = "ea0eef69-303c-4777-8706-ec16240696e2";

type ViolationDimensionRow = {
  id: string;
  code: string;
  name: string;
  category?: string;
  active?: boolean;
};

type ViolationVersionRow = {
  id: string;
  violation_id: string;
  source_code: string;
  source_label: string;
  source_period: string;
  valid_from: string | null;
  valid_to: string | null;
  display_order: number;
};

type PeriodRow = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  report_year: number;
  report_month: number;
};

type ViolationRecordRow = {
  id: string;
  violation_id: string;
  violation_version_id: string;
  personnel_category_id: string;
  value: number | null;
  data_status: string;
  source_cell_id: string | null;
  notes: string | null;
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

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

export default function PelanggaranReport({
  operator,
  onBack,
}: {
  operator: ActiveOperator;
  onBack: () => void;
}) {
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue);
  const [fields, setFields] = useState<ViolationField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [recordMeta, setRecordMeta] = useState<Record<string, RecordMeta>>({});
  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [reportTypeId, setReportTypeId] = useState(FALLBACK_REPORT_TYPE_ID);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [personnelByCode, setPersonnelByCode] = useState<Map<string, ViolationDimensionRow>>(new Map());
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
          violationsResult,
          versionsResult,
          personnelResult,
          periodResult,
          userResult,
        ] = await Promise.all([
          supabase.from("violation_data_contracts")
            .select("id,report_type_id,status")
            .eq("code", CONTRACT_CODE)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("violations")
            .select("id,canonical_code,canonical_name,category,active")
            .eq("active", true),
          supabase.from("violation_versions")
            .select("id,violation_id,source_code,source_label,source_period,valid_from,valid_to,display_order")
            .eq("source_period", "CURRENT_2026")
            .order("display_order", { ascending: true }),
          supabase.from("personnel_categories")
            .select("id,code,name,active")
            .eq("active", true)
            .order("display_order", { ascending: true }),
          supabase.from("report_periods")
            .select("id,period_label,period_start,period_end,report_year,report_month")
            .eq("period_type", "MONTH")
            .eq("report_year", Number(monthValue.split("-")[0]))
            .eq("report_month", Number(monthValue.split("-")[1]))
            .maybeSingle(),
          supabase.auth.getUser(),
        ]);

        if (!active) return;
        if (contractResult.error || !contractResult.data) throw new Error("Kontrak input Pelanggaran 2026 belum tersedia.");
        if (violationsResult.error || !violationsResult.data) throw new Error("Master jenis pelanggaran belum dapat dibaca.");
        if (versionsResult.error || !versionsResult.data) throw new Error("Versi taksonomi pelanggaran 2026 belum dapat dibaca.");
        if (personnelResult.error || !personnelResult.data) throw new Error("Master pangkat/golongan belum dapat dibaca.");
        if (periodResult.error) throw periodResult.error;
        if (userResult.error || !userResult.data.user) throw new Error("Sesi operator tidak ditemukan.");

        const violations = violationsResult.data as Array<ViolationDimensionRow & { canonical_code: string; canonical_name: string; category: string }>;
        const versions = versionsResult.data as ViolationVersionRow[];
        const personnel = personnelResult.data as ViolationDimensionRow[];

        const { data: contractFields, error: contractFieldsError } = await supabase
          .from("violation_data_contract_fields")
          .select("field_code,label,form_input,calculated,display_order")
          .eq("contract_id", contractResult.data.id)
          .order("display_order", { ascending: true });
        if (contractFieldsError || !contractFields) throw new Error("Field kontrak Pelanggaran tidak dapat dibaca.");

        const contractFieldCodes = new Set(
          (contractFields as Array<{ field_code: string; form_input: boolean; calculated: boolean }>)
            .filter((field) => field.form_input && !field.calculated)
            .map((field) => field.field_code),
        );
        const requiredContractFields = ["period_id", "pomdam_id", "violation_id", "personnel_category_id", "value"];
        if (requiredContractFields.some((code) => !contractFieldCodes.has(code))) {
          throw new Error("Kontrak input Pelanggaran tidak memuat seluruh dimensi dan nilai yang wajib.");
        }

        const currentVersions = versions.filter((version) =>
          version.source_code &&
          version.source_period === "CURRENT_2026" &&
          version.valid_from === "2026-01-01" &&
          version.valid_to === null
        );

        const resolvedFields: ViolationField[] = currentVersions.map((version) => {
          const violation = violations.find((item) => item.id === version.violation_id);
          if (!violation) throw new Error("Master pelanggaran untuk kode " + version.source_code + " tidak ditemukan.");
          const category = normalizeCode(violation.category);
          if (category !== "B" && category !== "C") {
            throw new Error("Kategori pelanggaran untuk kode " + version.source_code + " tidak valid.");
          }
          return {
            code: normalizeCode(version.source_code),
            label: version.source_label,
            category: category as ViolationCategoryCode,
            violationId: version.violation_id,
            violationVersionId: version.id,
          };
        }).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));

        const resolvedCodes = resolvedFields.map((field) => field.code);
        if (
          resolvedFields.length !== VIOLATION_REQUIRED_CODES.length ||
          VIOLATION_REQUIRED_CODES.some((code) => !resolvedCodes.includes(code))
        ) {
          throw new Error("Versi taksonomi aktif tidak sama dengan 17 jenis pelanggaran kontrak 2026.");
        }

        const categoryCounts = {
          B: resolvedFields.filter((field) => field.category === "B").length,
          C: resolvedFields.filter((field) => field.category === "C").length,
        };
        if (categoryCounts.B !== 11 || categoryCounts.C !== 6) {
          throw new Error("Distribusi kategori pelanggaran harus 11 Tatib dan 6 Lalin.");
        }

        const personnelByCode = new Map(
          personnel.map((item) => [normalizeCode(item.code), item]),
        );
        const expectedPersonnel = ["PA", "BA", "TA", "PNS"];
        if (expectedPersonnel.some((code) => !personnelByCode.has(code))) {
          throw new Error("Master pangkat/golongan harus mencakup PA, BA, TA, dan PNS.");
        }

        const selectedPeriod = (periodResult.data as PeriodRow | null) ?? null;
        const allValues: Record<string, string> = {};
        const allMeta: Record<string, RecordMeta> = {};

        if (selectedPeriod) {
          const [{ data: recordRows, error: recordError }, { data: submissionRow, error: submissionError }] = await Promise.all([
            supabase.from("violation_records")
              .select("id,violation_id,violation_version_id,personnel_category_id,value,data_status,source_cell_id,notes")
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id),
            supabase.from("report_submissions")
              .select("id,status,revision,submitted_by,submitted_at")
              .eq("report_type_id", contractResult.data.report_type_id)
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id)
              .maybeSingle(),
          ]);
          if (recordError) throw recordError;
          if (submissionError) throw submissionError;

          for (const field of resolvedFields) {
            for (const rankCode of expectedPersonnel) {
              const controlCode = field.code + "_" + rankCode;
              const record = (recordRows as ViolationRecordRow[] | null)?.find((row) =>
                row.violation_version_id === field.violationVersionId &&
                row.violation_id === field.violationId &&
                row.personnel_category_id === personnelByCode.get(rankCode)?.id
              );
              allValues[controlCode] = record?.value === null || record?.value === undefined ||
                record?.data_status === "NOT_REPORTED"
                ? ""
                : String(record.value);
              if (record) {
                allMeta[controlCode] = {
                  locked: record.source_cell_id !== null,
                  source: record.source_cell_id !== null ? "DATA SUMBER EXCEL" : "INPUT OPERATOR",
                };
              }
            }
          }

          setSubmission((submissionRow as SubmissionRow | null) ?? null);
        } else {
          for (const field of resolvedFields) {
            for (const rankCode of expectedPersonnel) {
              allValues[field.code + "_" + rankCode] = "";
            }
          }
          setSubmission(null);
        }

        if (!active) return;
        setFields(resolvedFields);
        setValues(allValues);
        setRecordMeta(allMeta);
        setPeriod(selectedPeriod);
        setReportTypeId(contractResult.data.report_type_id);
        setCurrentUserId(userResult.data.user.id);
        setPersonnelByCode(personnelByCode);
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

  const formCodes = useMemo(
    () => fields.flatMap((field) => ["PA", "BA", "TA", "PNS"].map((rank) => field.code + "_" + rank)),
    [fields],
  );
  const reportedCount = useMemo(() => countViolationReported(values), [values]);
  const invalidCodes = useMemo(() => getViolationInvalidCodes(values), [values]);
  const tatibCodes = formCodes.filter((code) => code.startsWith("B"));
  const lalinCodes = formCodes.filter((code) => code.startsWith("C"));
  const tatibTotal = useMemo(() => getViolationTotal(values, tatibCodes), [values, tatibCodes]);
  const lalinTotal = useMemo(() => getViolationTotal(values, lalinCodes), [values, lalinCodes]);
  const overallTotal = useMemo(() => getViolationTotal(values, formCodes), [values, formCodes]);
  const sourceLockedCount = formCodes.filter((code) => recordMeta[code]?.locked).length;
  const editableCount = formCodes.length - sourceLockedCount;
  const submissionOwnerConflict = Boolean(submission && currentUserId && submission.submitted_by !== currentUserId);
  const canSave = fields.length === VIOLATION_REQUIRED_CODES.length &&
    editableCount > 0 && !submissionOwnerConflict && invalidCodes.length === 0;
  const monthLabel = useMemo(() => formatMonthLabel(monthValue), [monthValue]);
  const maxMonth = useMemo(getMaximumMonthValue, []);
  const currentSubmissionLabel = submission?.status === "SUBMITTED"
    ? "SUDAH DIKIRIM"
    : submission?.status === "REOPENED"
      ? "DIBUKA KEMBALI"
      : period ? "DATA TERSEDIA" : "BELUM DIISI";

  function updateValue(code: string, value: string) {
    setValues((current) => ({ ...current, [code]: value }));
    setErrorMessage("");
    setSaveMessage("");
  }

  async function handleSave() {
    if (!supabase || !canSave || saving || !period) return;
    setSaving(true);
    setErrorMessage("");
    setSaveMessage("");
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Sesi operator telah berakhir. Silakan masuk kembali.");
      if (submission && submission.submitted_by !== userData.user.id) {
        throw new Error("Laporan ini telah dikirim oleh akun lain dan tidak dapat diubah dari akun ini.");
      }

      const now = new Date().toISOString();
      const categoryToSave = fields.flatMap((field) =>
        ["PA", "BA", "TA", "PNS"].flatMap((rankCode) => {
          const controlCode = field.code + "_" + rankCode;
          if (recordMeta[controlCode]?.locked) return [];
          const rawValue = (values[controlCode] ?? "").trim();
          const reported = rawValue !== "";
          const rank = personnelByCode.get(rankCode)!;
          return [{
            period_id: period.id,
            pomdam_id: operator.pomdam.id,
            violation_id: field.violationId,
            violation_version_id: field.violationVersionId,
            personnel_category_id: rank.id,
            value: reported ? Number(rawValue) : null,
            data_status: reported ? "VALID" : "NOT_REPORTED",
            source_cell_id: null,
            notes: "Input melalui form Operator",
          }];
        })
      );

      if (categoryToSave.length === 0) throw new Error("Tidak ada kolom yang dapat disimpan.");
      // Use the canonical unique key while preventing edits to any Excel row.
      const { error: readError, data: existingFacts } = await supabase
        .from("violation_records")
        .select("id,violation_id,violation_version_id,personnel_category_id,source_cell_id")
        .eq("period_id", period.id)
        .eq("pomdam_id", operator.pomdam.id);
      if (readError) throw readError;

      const existingByKey = new Map(
        (existingFacts as Array<{
          id: string;
          violation_id: string;
          violation_version_id: string;
          personnel_category_id: string;
          source_cell_id: string | null;
        }>).map((row) => [
          row.violation_id + ":" + row.personnel_category_id,
          row,
        ]),
      );

      const inserts: typeof categoryToSave = [];
      const updates: Array<typeof categoryToSave[number] & { id: string }> = [];
      for (const row of categoryToSave) {
        const key = row.violation_id + ":" + row.personnel_category_id;
        const existing = existingByKey.get(key);
        if (existing?.source_cell_id) {
          throw new Error("Upaya simpan dihentikan: ditemukan data Excel yang tidak boleh ditimpa (" + key + ").");
        }
        if (existing && existing.violation_version_id !== row.violation_version_id) {
          throw new Error("Versi taksonomi pada data tersimpan berbeda. Data tidak ditimpa otomatis.");
        }
        if (existing) {
          updates.push({ ...row, id: existing.id });
        } else {
          inserts.push(row);
        }
      }

      if (inserts.length > 0) {
        const { error } = await supabase.from("violation_records").insert(inserts);
        if (error) throw error;
      }
      for (const row of updates) {
        const { id, ...payload } = row;
        const { error } = await supabase.from("violation_records")
          .update(payload)
          .eq("id", id)
          .is("source_cell_id", null);
        if (error) throw error;
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
          period_id: period.id,
          pomdam_id: operator.pomdam.id,
          submitted_by: userData.user.id,
          status: "SUBMITTED",
          revision: 1,
          submitted_at: submittedAt,
          updated_at: now,
        });
        if (error) throw error;
      }

      setSaveMessage("Laporan Pelanggaran " + monthLabel + " berhasil disimpan dan dikirim.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="gakkum-report">
      <button className="back-link" type="button" onClick={showForm ? () => setShowForm(false) : onBack}>
        <span aria-hidden="true">←</span> {showForm ? "Kembali ke ringkasan" : "Kembali ke dashboard"}
      </button>

      <div className="gakkum-heading">
        <div>
          <p className="eyebrow">LAPORAN 03 · STATISTIK PELANGGARAN</p>
          <h1>Statistik Pelanggaran</h1>
          <p>{showForm ? "Isi jumlah pelanggaran menurut jenis dan pangkat/golongan personel." : "Pantau laporan pelanggaran Pomdam dan buka formulir pengisiannya."}</p>
        </div>
        <div className="gakkum-heading-actions">
          <div className="gakkum-status"><span className="gakkum-status-dot" />{currentSubmissionLabel}</div>
          {!showForm && (
            <button className="gakkum-primary-action" type="button" onClick={() => setShowForm(true)} disabled={loading || fields.length === 0}>
              {loading ? "MEMUAT FORM..." : fields.length === 0 ? "FORM BELUM TERSEDIA" : editableCount > 0 && !submissionOwnerConflict ? "ISI LAPORAN" : "LIHAT LAPORAN"}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>

      <div className="gakkum-period-panel">
        <div className="gakkum-unit"><span>POMDAM</span><strong>{operator.pomdam.displayName}</strong><small>{operator.pomdam.code}</small></div>
        <label className="gakkum-month-field">
          <span>PERIODE LAPORAN</span>
          <input type="month" value={monthValue} min={REPORT_YEAR + "-01"} max={maxMonth} onChange={(event) => setMonthValue(event.target.value)} disabled={loading || saving} />
        </label>
      </div>

      <div className="gakkum-summary-grid">
        <article className="gakkum-summary-card gakkum-summary-primary">
          <span>TOTAL PELANGGARAN</span>
          <strong>{formatCount(overallTotal)}</strong>
          <small>Akumulasi 17 jenis × 4 pangkat/golongan</small>
        </article>
        <article className="gakkum-summary-card">
          <span>TATA TERTIB</span><strong>{formatCount(tatibTotal)}</strong><small>11 jenis pelanggaran kategori B</small>
        </article>
        <article className="gakkum-summary-card">
          <span>LALU LINTAS</span><strong>{formatCount(lalinTotal)}</strong><small>6 jenis pelanggaran kategori C</small>
        </article>
      </div>

      <div className="gakkum-notice">
        <strong>{reportedCount} dari 68 input memiliki angka.</strong>
        <span>Angka nol tetap dihitung sebagai laporan; kolom kosong adalah belum dilaporkan.</span>
      </div>
      {sourceLockedCount > 0 && (
        <div className="gakkum-notice gakkum-notice-info">
          <strong>Data sumber Excel terkunci.</strong>
          <span>{sourceLockedCount} input berasal dari workbook impor dan tidak dapat ditimpa oleh operator.</span>
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
        <div className="gakkum-loading">Memuat data Pelanggaran...</div>
      ) : showForm ? (
        <>
          <div className="gakkum-section-heading">
            <div><p className="eyebrow">RINCIAN DATA</p><h2>Jumlah pelanggaran menurut jenis dan pangkat</h2></div>
            <span>JUMLAH PERSONEL / KASUS</span>
          </div>
          <div className="gakkum-groups">
            {VIOLATION_GROUPS.map((group, groupIndex) => {
              const groupFields = group.codes
                .map((code) => fields.find((field) => field.code === code))
                .filter((field): field is ViolationField => Boolean(field));
              const codes = groupFields.flatMap((field) => ["PA", "BA", "TA", "PNS"].map((rank) => field.code + "_" + rank));
              return (
                <article className="gakkum-group-card" key={group.key}>
                  <div className="gakkum-group-heading">
                    <div className="gakkum-group-number">{String(groupIndex + 1).padStart(2, "0")}</div>
                    <h3>{group.title}</h3>
                    <div className="gakkum-group-total">
                      <span>TOTAL {group.key === "TATIB" ? "TATIB" : "LALIN"}</span>
                      <strong>{formatCount(getViolationTotal(values, codes))}</strong>
                    </div>
                  </div>
                  <div className="gakkum-field-list">
                    <div className="violation-rank-heading">
                      <span>JENIS PELANGGARAN</span>
                      <div><span>PA</span><span>BA</span><span>TA</span><span>PNS</span></div>
                    </div>
                    {groupFields.map((field) => (
                      <div className="violation-field-row" key={field.code}>
                        <div className="violation-field-label">
                          <strong>{field.code}</strong>
                          <span>{field.label.replace(new RegExp("^" + field.code + "\\s*"), "")}</span>
                        </div>
                        <div className="violation-rank-inputs">
                          {["PA", "BA", "TA", "PNS"].map((rank) => {
                            const controlCode = field.code + "_" + rank;
                            return (
                              <input
                                key={controlCode}
                                aria-label={field.code + " " + rank}
                                type="number"
                                inputMode="numeric"
                                min="0"
                                step="1"
                                value={values[controlCode] ?? ""}
                                placeholder="—"
                                disabled={saving || recordMeta[controlCode]?.locked || submissionOwnerConflict}
                                onChange={(event) => updateValue(controlCode, event.target.value)}
                              />
                            );
                          })}
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
              <strong>{reportedCount} dari 68 input memiliki angka.</strong>
              <small>Setiap jenis pelanggaran dicatat menurut PA, BA, TA, dan PNS. Total dihitung otomatis.</small>
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
          <span>Pilih tombol {editableCount > 0 && !submissionOwnerConflict ? "ISI LAPORAN" : "LIHAT LAPORAN"} untuk membuka rincian Pelanggaran periode {monthLabel}.</span>
        </div>
      )}
    </section>
  );
}
