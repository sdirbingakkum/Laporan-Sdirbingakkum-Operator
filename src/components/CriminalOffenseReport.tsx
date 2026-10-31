import { useEffect, useMemo, useState } from "react";
import type { ActiveOperator } from "../lib/operator-auth";
import {
  countCriminalOffenseReported,
  criminalOffenseInputCode,
  getCriminalOffenseInvalidCodes,
  getCriminalOffenseTotal,
} from "../lib/criminal-offense-report";
import { supabase } from "../lib/supabase";

const DATA_CONTRACT_CODE = "TINDAK_PIDANA_POMDAM_INPUT_2026";
const OFFENSE_SOURCE_PERIOD = "AUG_2026";
const REPORT_YEAR = 2026;
const EXPECTED_OFFENSE_COUNT = 105;
const EXPECTED_PERSONNEL_CODES = ["PA", "BA", "TA", "PNS"] as const;
const PAGE_SIZE = 25;

type PeriodRow = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  report_year: number;
  report_month: number;
};

type ContractField = {
  field_code: string;
  form_input: boolean;
  calculated: boolean;
  display_order: number;
};

type OffenseField = {
  versionId: string;
  offenseId: string;
  sourceNumber: number;
  canonicalKey: string;
  label: string;
  displayOrder: number;
};

type PersonnelCategory = {
  id: string;
  code: string;
  name: string;
  display_order: number;
  active: boolean;
};

type CriminalOffenseRecord = {
  id: string;
  criminal_offense_version_id: string;
  personnel_category_id: string;
  value: number | null;
  data_status: string;
  source_cell_id: string | null;
  ingestion_method: string;
};

type SubmissionRow = {
  id: string;
  status: string;
  revision: number;
  submitted_by: string;
  submitted_at: string | null;
};

type RecordMeta = {
  locked: boolean;
  source: string;
};

function getCurrentMonthValue(): string {
  const now = new Date();
  const month = now.getFullYear() === REPORT_YEAR ? now.getMonth() + 1 : 1;
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

function formatCount(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("id-ID").format(value);
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Terjadi kesalahan. Silakan coba lagi.";
}

function recordKey(versionId: string, personnelId: string): string {
  return versionId + ":" + personnelId;
}

function buildFormCode(field: OffenseField, personnel: PersonnelCategory): string {
  return criminalOffenseInputCode(field.versionId, personnel.id);
}

export default function CriminalOffenseReport({
  operator,
  onBack,
}: {
  operator: ActiveOperator;
  onBack: () => void;
}) {
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue);
  const [fields, setFields] = useState<OffenseField[]>([]);
  const [personnel, setPersonnel] = useState<PersonnelCategory[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [recordMeta, setRecordMeta] = useState<Record<string, RecordMeta>>({});
  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [reportTypeId, setReportTypeId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [page, setPage] = useState(1);

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
          versionResult,
          offenseResult,
          personnelResult,
          periodResult,
          userResult,
        ] = await Promise.all([
          supabase.from("criminal_offense_data_contracts")
            .select("id,report_type_id,status,code")
            .eq("code", DATA_CONTRACT_CODE)
            .eq("status", "ACTIVE")
            .maybeSingle(),
          supabase.from("criminal_offense_versions")
            .select("id,offense_id,source_number,source_label,source_period,valid_from,valid_to,display_order")
            .eq("source_period", OFFENSE_SOURCE_PERIOD)
            .order("display_order", { ascending: true }),
          supabase.from("criminal_offenses")
            .select("id,canonical_key,canonical_name,active")
            .eq("active", true),
          supabase.from("personnel_categories")
            .select("id,code,name,display_order,active")
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
        if (contractResult.error || !contractResult.data) {
          throw new Error("Kontrak input Tindak Pidana 2026 belum tersedia atau tidak aktif.");
        }
        if (versionResult.error || !versionResult.data) {
          throw new Error("Taksonomi Tindak Pidana 2026 gagal dimuat.");
        }
        if (offenseResult.error || !offenseResult.data) {
          throw new Error("Master Tindak Pidana gagal dimuat.");
        }
        if (personnelResult.error || !personnelResult.data) {
          throw new Error("Master golongan personel gagal dimuat.");
        }
        if (periodResult.error) throw periodResult.error;
        if (userResult.error || !userResult.data.user) {
          throw new Error("Sesi operator tidak dapat diverifikasi. Silakan masuk kembali.");
        }

        const { data: contractFields, error: contractFieldsError } = await supabase
          .from("criminal_offense_data_contract_fields")
          .select("field_code,form_input,calculated,display_order")
          .eq("contract_id", contractResult.data.id)
          .order("display_order", { ascending: true });
        if (contractFieldsError || !contractFields) {
          throw new Error("Field kontrak Tindak Pidana gagal dibaca.");
        }

        const inputFieldCodes = new Set(
          (contractFields as ContractField[])
            .filter((field) => field.form_input && !field.calculated)
            .map((field) => field.field_code.trim().toUpperCase()),
        );
        const requiredInputFields = [
          "PERIOD_ID",
          "POMDAM_ID",
          "CRIMINAL_OFFENSE_VERSION_ID",
          "PERSONNEL_CATEGORY_ID",
          "VALUE",
        ];
        if (requiredInputFields.some((code) => !inputFieldCodes.has(code))) {
          throw new Error("Kontrak input Tindak Pidana tidak memuat seluruh dimensi wajib.");
        }

        const offenses = offenseResult.data as Array<{
          id: string;
          canonical_key: string;
          canonical_name: string;
          active: boolean;
        }>;
        const offenseById = new Map(offenses.map((offense) => [offense.id, offense]));
        const versions = (versionResult.data as Array<{
          id: string;
          offense_id: string;
          source_number: number;
          source_label: string;
          source_period: string;
          valid_from: string | null;
          valid_to: string | null;
          display_order: number;
        }>)
          .filter((version) => version.valid_to === null && offenseById.has(version.offense_id))
          .sort((a, b) => a.display_order - b.display_order);

        if (versions.length !== EXPECTED_OFFENSE_COUNT) {
          throw new Error(
            "Taksonomi Tindak Pidana harus memuat tepat 105 kategori aktif. Ditemukan " +
              versions.length + " kategori.",
          );
        }
        if (new Set(versions.map((version) => version.id)).size !== EXPECTED_OFFENSE_COUNT) {
          throw new Error("Taksonomi Tindak Pidana memuat versi kategori yang duplikat.");
        }

        const resolvedPersonnel = personnelResult.data as PersonnelCategory[];
        const personnelByCode = new Map(
          resolvedPersonnel.map((item) => [item.code.trim().toUpperCase(), item]),
        );
        if (
          resolvedPersonnel.length !== EXPECTED_PERSONNEL_CODES.length ||
          EXPECTED_PERSONNEL_CODES.some((code) => !personnelByCode.has(code))
        ) {
          throw new Error("Master personel harus berisi PA, BA, TA, dan PNS.");
        }
        const orderedPersonnel = EXPECTED_PERSONNEL_CODES.map((code) => personnelByCode.get(code)!);

        const resolvedFields: OffenseField[] = versions.map((version) => {
          const offense = offenseById.get(version.offense_id)!;
          return {
            versionId: version.id,
            offenseId: version.offense_id,
            sourceNumber: version.source_number,
            canonicalKey: offense.canonical_key,
            label: version.source_label || offense.canonical_name,
            displayOrder: version.display_order,
          };
        });

        const selectedPeriod = (periodResult.data as PeriodRow | null) ?? null;
        const nextValues: Record<string, string> = {};
        const nextMeta: Record<string, RecordMeta> = {};
        let resolvedSubmission: SubmissionRow | null = null;

        if (selectedPeriod) {
          const [recordsResult, submissionResult] = await Promise.all([
            supabase.from("criminal_offense_records")
              .select("id,criminal_offense_version_id,personnel_category_id,value,data_status,source_cell_id,ingestion_method")
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id),
            supabase.from("report_submissions")
              .select("id,status,revision,submitted_by,submitted_at")
              .eq("report_type_id", contractResult.data.report_type_id)
              .eq("period_id", selectedPeriod.id)
              .eq("pomdam_id", operator.pomdam.id)
              .maybeSingle(),
          ]);
          if (recordsResult.error) throw recordsResult.error;
          if (submissionResult.error) throw submissionResult.error;

          const records = (recordsResult.data ?? []) as CriminalOffenseRecord[];
          const recordsByKey = new Map(
            records.map((record) => [
              recordKey(record.criminal_offense_version_id, record.personnel_category_id),
              record,
            ]),
          );

          for (const field of resolvedFields) {
            for (const rank of orderedPersonnel) {
              const code = buildFormCode(field, rank);
              const record = recordsByKey.get(recordKey(field.versionId, rank.id));
              nextValues[code] =
                record?.data_status === "VALID" && record.value !== null
                  ? String(record.value)
                  : "";
              if (record) {
                nextMeta[code] = {
                  locked: record.source_cell_id !== null,
                  source: record.source_cell_id !== null ? "SUMBER EXCEL" : "INPUT OPERATOR",
                };
              }
            }
          }
          resolvedSubmission = (submissionResult.data as SubmissionRow | null) ?? null;
        } else {
          for (const field of resolvedFields) {
            for (const rank of orderedPersonnel) {
              nextValues[buildFormCode(field, rank)] = "";
            }
          }
        }

        if (!active) return;
        setFields(resolvedFields);
        setPersonnel(orderedPersonnel);
        setValues(nextValues);
        setRecordMeta(nextMeta);
        setPeriod(selectedPeriod);
        setSubmission(resolvedSubmission);
        setReportTypeId(contractResult.data.report_type_id);
        setCurrentUserId(userResult.data.user.id);
        setPage(1);
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
    () => fields.flatMap((field) => personnel.map((rank) => buildFormCode(field, rank))),
    [fields, personnel],
  );
  const reportedCount = useMemo(
    () => countCriminalOffenseReported(values, formCodes),
    [values, formCodes],
  );
  const invalidCodes = useMemo(
    () => getCriminalOffenseInvalidCodes(values, formCodes),
    [values, formCodes],
  );
  const overallTotal = useMemo(
    () => getCriminalOffenseTotal(values, formCodes),
    [values, formCodes],
  );
  const personnelTotals = useMemo(
    () => personnel.map((rank) => ({
      ...rank,
      total: getCriminalOffenseTotal(
        values,
        fields.map((field) => buildFormCode(field, rank)),
      ),
    })),
    [fields, personnel, values],
  );
  const sourceLockedCount = formCodes.filter((code) => recordMeta[code]?.locked).length;
  const editableCount = formCodes.length - sourceLockedCount;
  const submissionOwnerConflict = Boolean(
    submission && currentUserId && submission.submitted_by !== currentUserId,
  );
  const canSave =
    fields.length === EXPECTED_OFFENSE_COUNT &&
    personnel.length === EXPECTED_PERSONNEL_CODES.length &&
    editableCount > 0 &&
    !submissionOwnerConflict &&
    invalidCodes.length === 0 &&
    reportedCount > 0;
  const monthLabel = useMemo(() => formatMonthLabel(monthValue), [monthValue]);
  const maxMonth = useMemo(getMaximumMonthValue, []);

  const filteredFields = useMemo(() => {
    const query = searchValue.trim().toLocaleLowerCase("id-ID");
    if (!query) return fields;
    return fields.filter((field) =>
      field.label.toLocaleLowerCase("id-ID").includes(query) ||
      field.canonicalKey.toLocaleLowerCase("id-ID").includes(query) ||
      String(field.sourceNumber).includes(query),
    );
  }, [fields, searchValue]);
  const totalPages = Math.max(1, Math.ceil(filteredFields.length / PAGE_SIZE));
  const visibleFields = filteredFields.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const firstVisible = filteredFields.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(page * PAGE_SIZE, filteredFields.length);
  const currentSubmissionLabel =
    submission?.status === "SUBMITTED"
      ? "SUDAH DIKIRIM"
      : submission?.status === "REOPENED"
        ? "DIBUKA KEMBALI"
        : period
          ? "DATA TERSEDIA"
          : "BELUM DIISI";

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
      if (submission && submission.submitted_by !== currentUserId) {
        throw new Error("Laporan ini dikirim oleh akun lain dan tidak dapat diubah dari akun ini.");
      }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error("Sesi operator telah berakhir. Silakan masuk kembali.");
      }
      if (submission && submission.submitted_by !== userData.user.id) {
        throw new Error("Laporan ini dikirim oleh akun lain dan tidak dapat diubah dari akun ini.");
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
          if (findPeriodError || !existingPeriod) {
            throw findPeriodError ?? insertPeriodError;
          }
          targetPeriod = existingPeriod as PeriodRow;
        } else {
          targetPeriod = insertedPeriod as PeriodRow;
        }
      }
      if (!targetPeriod) throw new Error("Periode laporan tidak dapat disiapkan.");

      const { data: existingFacts, error: readError } = await supabase
        .from("criminal_offense_records")
        .select("id,criminal_offense_version_id,personnel_category_id,source_cell_id")
        .eq("period_id", targetPeriod.id)
        .eq("pomdam_id", operator.pomdam.id);
      if (readError) throw readError;

      const existingByKey = new Map(
        ((existingFacts ?? []) as Array<{
          id: string;
          criminal_offense_version_id: string;
          personnel_category_id: string;
          source_cell_id: string | null;
        }>).map((record) => [
          recordKey(record.criminal_offense_version_id, record.personnel_category_id),
          record,
        ]),
      );

      const rowsToSave = fields.flatMap((field) =>
        personnel.flatMap((rank) => {
          const code = buildFormCode(field, rank);
          if (recordMeta[code]?.locked) return [];
          const existing = existingByKey.get(recordKey(field.versionId, rank.id));
          if (existing?.source_cell_id) return [];

          const rawValue = (values[code] ?? "").trim();
          const reported = rawValue !== "";
          return [{
            period_id: targetPeriod!.id,
            pomdam_id: operator.pomdam.id,
            criminal_offense_version_id: field.versionId,
            personnel_category_id: rank.id,
            value: reported ? Number(rawValue) : null,
            data_status: reported ? "VALID" : "NOT_REPORTED",
            source_cell_id: null,
            ingestion_method: "FORM",
            source_value_strategy: "DIRECT",
            notes: "Input melalui form Operator",
          }];
        }),
      );

      if (rowsToSave.length === 0) {
        throw new Error("Tidak ada kolom yang dapat disimpan. Data sumber Excel tetap terkunci.");
      }

      const { error: saveError } = await supabase
        .from("criminal_offense_records")
        .upsert(rowsToSave, {
          onConflict: "period_id,pomdam_id,criminal_offense_version_id,personnel_category_id",
        });
      if (saveError) throw saveError;

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

      setSaveMessage("Laporan Tindak Pidana " + monthLabel + " berhasil disimpan dan dikirim.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="gakkum-report criminal-offense-report">
      <button className="back-link" type="button" onClick={showForm ? () => setShowForm(false) : onBack}>
        <span aria-hidden="true">←</span> {showForm ? "Kembali ke ringkasan" : "Kembali ke dashboard"}
      </button>

      <div className="gakkum-heading">
        <div>
          <p className="eyebrow">LAPORAN 06 · REKAP TINDAK PIDANA</p>
          <h1>Rekap Tindak Pidana</h1>
          <p>
            {showForm
              ? "Input jumlah tindak pidana menurut 105 jenis dan empat golongan personel."
              : "Pantau data tindak pidana Pomdam dan buka formulir pengisiannya."}
          </p>
        </div>
        <div className="gakkum-heading-actions">
          <div className="gakkum-status"><span className="gakkum-status-dot" />{currentSubmissionLabel}</div>
          {!showForm && (
            <button
              className="gakkum-primary-action"
              type="button"
              onClick={() => setShowForm(true)}
              disabled={loading || fields.length !== EXPECTED_OFFENSE_COUNT || editableCount === 0 && !sourceLockedCount}
            >
              {loading
                ? "MEMUAT FORM..."
                : sourceLockedCount > 0 && editableCount === 0
                  ? "LIHAT LAPORAN"
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
            onChange={(event) => {
              setMonthValue(event.target.value);
              setSearchValue("");
              setPage(1);
              setShowForm(false);
            }}
            disabled={loading || saving}
          />
        </label>
      </div>

      <div className="offense-summary-grid">
        <article className="gakkum-summary-card gakkum-summary-primary">
          <span>TOTAL TINDAK PIDANA</span>
          <strong>{formatCount(overallTotal)}</strong>
          <small>{reportedCount} dari {formCodes.length} angka telah dilaporkan</small>
        </article>
        {personnelTotals.map((rank) => (
          <article className="gakkum-summary-card" key={rank.code}>
            <span>TOTAL {rank.code}</span>
            <strong>{formatCount(rank.total)}</strong>
            <small>{rank.name}</small>
          </article>
        ))}
      </div>

      <div className="gakkum-notice">
        <strong>{fields.length} jenis × {personnel.length} golongan = {formCodes.length} input.</strong>
        <span>Nol adalah angka laporan yang sah; kolom kosong berarti belum dilaporkan. Total hanya muncul setelah seluruh angka pada bagian terkait terisi.</span>
      </div>
      {period === null && (
        <div className="gakkum-notice">
          <strong>Periode belum memiliki catatan.</strong>
          <span>Data baru akan disiapkan saat laporan periode ini disimpan.</span>
        </div>
      )}
      {sourceLockedCount > 0 && (
        <div className="gakkum-notice">
          <strong>Data impor Excel terlindungi.</strong>
          <span>{sourceLockedCount} angka dari workbook sumber dikunci dan tidak dapat ditimpa dari form operator.</span>
        </div>
      )}
      {submissionOwnerConflict && (
        <div className="gakkum-notice gakkum-notice-warning">
          <strong>Laporan dikirim oleh akun lain.</strong>
          <span>Data hanya dapat dilihat dari akun ini. Pengubahan harus dilakukan oleh pemilik laporan atau pengelola setelah laporan dibuka kembali.</span>
        </div>
      )}
      {errorMessage && <div className="gakkum-feedback gakkum-feedback-error" role="alert">{errorMessage}</div>}
      {saveMessage && <div className="gakkum-feedback gakkum-feedback-success" role="status">{saveMessage}</div>}

      {loading ? (
        <div className="gakkum-loading">Memuat data Tindak Pidana...</div>
      ) : showForm ? (
        <>
          <div className="gakkum-section-heading">
            <div>
              <p className="eyebrow">RINCIAN DATA</p>
              <h2>Jumlah tindak pidana menurut jenis dan golongan personel</h2>
            </div>
            <span>105 JENIS · 4 GOLONGAN</span>
          </div>

          <div className="offense-toolbar">
            <label className="offense-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={searchValue}
                placeholder="Cari jenis tindak pidana..."
                aria-label="Cari jenis tindak pidana"
                onChange={(event) => {
                  setSearchValue(event.target.value);
                  setPage(1);
                }}
                disabled={saving}
              />
            </label>
            <span className="offense-page-count">
              {filteredFields.length === 0
                ? "Tidak ada jenis ditemukan"
                : "Menampilkan " + firstVisible + "–" + lastVisible + " dari " + filteredFields.length}
            </span>
          </div>

          <div className="offense-table-card">
            <div className="offense-table-scroll">
              <table className="offense-table">
                <thead>
                  <tr>
                    <th scope="col" className="offense-number-column">NO.</th>
                    <th scope="col" className="offense-name-column">JENIS TINDAK PIDANA</th>
                    {personnel.map((rank) => (
                      <th scope="col" className="offense-personnel-column" key={rank.id}>
                        <span>{rank.code}</span>
                        <small>{rank.name}</small>
                      </th>
                    ))}
                    <th scope="col" className="offense-total-column">JML</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFields.map((field) => {
                    const rowCodes = personnel.map((rank) => buildFormCode(field, rank));
                    const rowTotal = getCriminalOffenseTotal(values, rowCodes);
                    return (
                      <tr key={field.versionId}>
                        <td className="offense-number">{String(field.sourceNumber).padStart(3, "0")}</td>
                        <td className="offense-name">
                          <strong>{field.label}</strong>
                          <small>{field.canonicalKey}</small>
                        </td>
                        {personnel.map((rank) => {
                          const code = buildFormCode(field, rank);
                          const locked = Boolean(recordMeta[code]?.locked);
                          return (
                            <td className="offense-value-cell" key={rank.id}>
                              <input
                                className={locked ? "offense-value-input offense-value-locked" : "offense-value-input"}
                                type="number"
                                inputMode="numeric"
                                min="0"
                                step="1"
                                value={values[code] ?? ""}
                                placeholder="—"
                                aria-label={field.label + " - " + rank.name}
                                title={locked ? "Nilai dari sumber Excel dikunci" : ""}
                                disabled={saving || locked || submissionOwnerConflict}
                                onChange={(event) => updateValue(code, event.target.value)}
                              />
                            </td>
                          );
                        })}
                        <td className="offense-row-total">{formatCount(rowTotal)}</td>
                      </tr>
                    );
                  })}
                  {visibleFields.length === 0 && (
                    <tr><td colSpan={personnel.length + 3} className="offense-empty">Tidak ada jenis tindak pidana yang cocok dengan pencarian.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="offense-pagination">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || saving}>
              SEBELUMNYA
            </button>
            <span>HALAMAN {page} / {totalPages}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || saving}>
              BERIKUTNYA
            </button>
          </div>

          <div className="gakkum-form-footer">
            <div>
              <strong>{reportedCount} dari {formCodes.length} input memiliki angka.</strong>
              <small>Setiap jenis dicatat menurut PA, BA, TA, dan PNS. Total dihitung otomatis.</small>
              {invalidCodes.length > 0 && (
                <small className="gakkum-inline-error">{invalidCodes.length} input harus berupa bilangan bulat nol atau lebih.</small>
              )}
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
