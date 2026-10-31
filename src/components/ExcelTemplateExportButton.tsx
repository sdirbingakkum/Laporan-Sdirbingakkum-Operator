import { useRef, useState } from "react";
import { exportReportFromTemplate, type ReportExportKind } from "../lib/excel-template-export";

type Props = {
  kind: ReportExportKind;
  periodValue: string;
  pomdamCode: string;
  pomdamName: string;
  values: Record<string, string>;
  disabled?: boolean;
};

export default function ExcelTemplateExportButton({
  kind,
  periodValue,
  pomdamCode,
  pomdamName,
  values,
  disabled = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function handleFile(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setFeedback("");
    try {
      const result = await exportReportFromTemplate(file, {
        kind,
        periodValue,
        pomdamCode,
        pomdamName,
        values,
      });
      const exportBuffer = new ArrayBuffer(result.bytes.byteLength);
      new Uint8Array(exportBuffer).set(result.bytes);
      const blob = new Blob([exportBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback("Excel berhasil dibuat. " + result.notices.join(" "));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Tidak dapat membuat file Excel.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="excel-template-export">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="excel-template-export-input"
        aria-label="Pilih template Excel resmi"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <button
        className="excel-template-export-button"
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "MENYIAPKAN EXCEL..." : "EKSPOR EXCEL"}
      </button>
      <small>Template resmi dipilih dari perangkat; ekspor hanya untuk {pomdamCode}.</small>
      {feedback && <span className="excel-template-export-feedback" role="status">{feedback}</span>}
    </div>
  );
}
