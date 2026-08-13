import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import type { ChartEvidence, ChartEvidenceSource, ChartEvidenceTimeframe, EntryRationaleJournal, EntryRationaleReviewOutcome } from "@/types/domain";
import { updateJournalTimestamp } from "@/domain/entryRationaleJournal";
import { deleteJournalImageRefs, readJournalImage, saveJournalImage } from "@/lib/entryRationaleImageStore";

const technicalTagOptions = [
  "SlowKDゴールデンクロス",
  "MACDゴールデンクロス",
  "5日/20日線ゴールデンクロス",
  "10日/50日線ゴールデンクロス",
  "25日/50日線ゴールデンクロス",
  "移動平均線ゴールデンクロス",
  "25日/50日線接近",
  "移動平均線上向き",
  "上昇トレンド継続",
  "押し目",
  "レンジ上抜け",
  "サポート確認",
  "出来高増加",
  "決算/イベント注意",
  "IV/流動性確認",
];

const sourceOptions: ChartEvidenceSource[] = ["moomoo", "Saxo", "TradingView", "manual", "other"];
const timeframeOptions: ChartEvidenceTimeframe[] = ["daily", "weekly", "monthly", "other"];

function sourceLabel(source: ChartEvidenceSource): string {
  if (source === "moomoo") return "moomoo";
  if (source === "Saxo") return "Saxo";
  if (source === "TradingView") return "TradingView";
  if (source === "manual") return "手入力";
  return "その他";
}

function timeframeLabel(timeframe: ChartEvidenceTimeframe): string {
  if (timeframe === "daily") return "日足";
  if (timeframe === "weekly") return "週足";
  if (timeframe === "monthly") return "月足";
  return "その他";
}

function outcomeLabel(outcome: EntryRationaleReviewOutcome): string {
  if (outcome === "as_expected") return "仮説どおり";
  if (outcome === "partly_expected") return "一部想定どおり";
  if (outcome === "unexpected") return "想定外";
  return "未レビュー";
}

function entryReasonRows(value: string): number {
  if (!value.trim()) return 4;
  const lineCount = value.split(/\r?\n/).length;
  const estimatedWrappedLines = Math.ceil(value.length / 72);
  return Math.min(8, Math.max(4, lineCount, estimatedWrappedLines));
}

function createEvidenceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `chart-${crypto.randomUUID()}`;
  return `chart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deleteAriaLabel(evidence: ChartEvidence): string {
  return `チャート画像を削除: ${sourceLabel(evidence.source)} / ${timeframeLabel(evidence.timeframe)} / ${evidence.capturedAt} / ${evidence.id}`;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold text-slate-700">{label}</span>
      <textarea
        className={`rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100 ${className}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function InputField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold text-slate-700">{label}</span>
      <input
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function EvidencePreview({
  evidence,
  onOpen,
  onDelete,
  deleteEnabled,
  deleteDisabledReason,
}: {
  evidence: ChartEvidence;
  onOpen: (ref: string) => void;
  onDelete: (evidence: ChartEvidence) => void;
  deleteEnabled: boolean;
  deleteDisabledReason?: string;
}) {
  const [preview, setPreview] = useState<string | undefined>();
  useEffect(() => {
    let mounted = true;
    void readJournalImage(evidence.imageRef).then((dataUrl) => {
      if (mounted) setPreview(dataUrl);
    });
    return () => {
      mounted = false;
    };
  }, [evidence.imageRef]);

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white text-left shadow-sm">
      <button
        type="button"
        className="block w-full hover:border-teal-300"
        onClick={() => onOpen(evidence.imageRef)}
      >
        {preview ? (
          <img src={preview} alt="チャート画像" className="h-auto max-h-[320px] min-h-[180px] w-full bg-slate-100 object-contain" />
        ) : (
          <div className="flex min-h-[180px] items-center justify-center bg-slate-100 text-xs font-semibold text-slate-500">画像保存済み</div>
        )}
      </button>
      <div className="flex items-start justify-between gap-3 px-2 py-1.5 text-xs leading-5 text-slate-600">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-slate-900">{sourceLabel(evidence.source)} / {timeframeLabel(evidence.timeframe)}</div>
          <div>{evidence.capturedAt}</div>
          {!deleteEnabled && deleteDisabledReason ? <div className="mt-1 text-amber-700">{deleteDisabledReason}</div> : null}
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          aria-label={deleteAriaLabel(evidence)}
          disabled={!deleteEnabled}
          onClick={() => onDelete(evidence)}
        >
          <Trash2 size={14} aria-hidden="true" />
          削除
        </button>
      </div>
    </div>
  );
}

export function EntryRationaleJournalPanel({
  journal,
  onChange,
  title = "エントリー根拠",
  candidateReason,
  reviewMode = false,
  editable = true,
  editDisabledReason,
}: {
  journal: EntryRationaleJournal;
  onChange: (journal: EntryRationaleJournal) => void;
  title?: string;
  subtitle?: string;
  candidateReason?: ReactNode;
  reviewMode?: boolean;
  editable?: boolean;
  editDisabledReason?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageStatus, setImageStatus] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | undefined>();
  const [pendingDeleteEvidence, setPendingDeleteEvidence] = useState<ChartEvidence | undefined>();
  const [newEvidenceSource, setNewEvidenceSource] = useState<ChartEvidenceSource>("manual");
  const [newEvidenceTimeframe, setNewEvidenceTimeframe] = useState<ChartEvidenceTimeframe>("daily");
  const [fullImage, setFullImage] = useState<string | undefined>();

  const updateJournal = (patch: Partial<EntryRationaleJournal>) => onChange(updateJournalTimestamp({ ...journal, ...patch }));
  const updateReview = (patch: Partial<NonNullable<EntryRationaleJournal["review"]>>) =>
    updateJournal({ review: { outcome: "not_reviewed", ...(journal.review ?? {}), ...patch } });

  const toggleTag = (tag: string) => {
    const current = new Set(journal.technicalTags);
    if (current.has(tag)) current.delete(tag);
    else current.add(tag);
    updateJournal({ technicalTags: [...current] });
  };

  const addFiles = async (files: FileList | File[]) => {
    if (!editable) {
      if (editDisabledReason) setImageStatus(editDisabledReason);
      return;
    }
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setImageStatus("画像ファイルだけを添付できます。");
      return;
    }
    setImageStatus("画像をブラウザ内に保存しています。");
    try {
      const evidenceItems: ChartEvidence[] = [];
      for (const file of imageFiles) {
        const refs = await saveJournalImage(file);
        evidenceItems.push({
          id: createEvidenceId(),
          source: newEvidenceSource,
          timeframe: newEvidenceTimeframe,
          capturedAt: new Date().toISOString(),
          memo: "",
          imageRef: refs.imageRef,
          thumbnailRef: refs.thumbnailRef,
        });
      }
      updateJournal({ chartEvidence: [...journal.chartEvidence, ...evidenceItems] });
      setImageStatus(`${evidenceItems.length}件の画像を保存しました。`);
    } catch (error) {
      setImageStatus(error instanceof Error ? error.message : "画像を保存できませんでした。");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length > 0) void addFiles(files);
  };

  const openImage = async (ref: string) => {
    setSelectedImage(ref);
    setFullImage(await readJournalImage(ref));
  };

  const confirmDeleteEvidence = async () => {
    if (!pendingDeleteEvidence) return;
    const target = pendingDeleteEvidence;
    updateJournal({ chartEvidence: journal.chartEvidence.filter((evidence) => evidence.id !== target.id) });
    setPendingDeleteEvidence(undefined);
    setImageStatus("画像を1件削除しました。");
    try {
      await deleteJournalImageRefs([target.imageRef, target.thumbnailRef]);
    } catch {
      setImageStatus("画像一覧からは削除しました。ブラウザ内画像の削除は確認できませんでした。");
    }
  };

  return (
    <section
      className={title ? "rounded-lg border border-teal-200 bg-white p-3 shadow-sm" : ""}
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onPaste={handlePaste}
      tabIndex={0}
    >
      {title ? (
        <div className="mb-3">
          <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        </div>
      ) : null}

      {candidateReason ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
          <div className="font-bold text-slate-900">候補理由</div>
          <div className="mt-1">{candidateReason}</div>
        </div>
      ) : null}

      <div className={title || candidateReason ? "mt-3" : ""}>
        <TextField
          label="エントリー理由"
          value={journal.entryReason}
          placeholder="なぜこの銘柄・戦略・タイミングで入ると判断したか"
          onChange={(entryReason) => updateJournal({ entryReason })}
          rows={entryReasonRows(journal.entryReason)}
          className="text-base leading-7"
        />
      </div>

      <div className="mt-3 border-t border-slate-200 pt-2">
        <div className="text-xs font-bold text-slate-700">チャート画像</div>
        {journal.chartEvidence.length > 0 ? (
          <div className="mt-1 grid gap-2 lg:grid-cols-2">
            {journal.chartEvidence.map((evidence) => (
              <EvidencePreview
                key={evidence.id}
                evidence={evidence}
                onOpen={(ref) => void openImage(ref)}
                onDelete={setPendingDeleteEvidence}
                deleteEnabled={editable}
                deleteDisabledReason={editDisabledReason}
              />
            ))}
          </div>
        ) : (
          <p className="mt-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-2 text-xs text-slate-500">
            チャート画像は未添付です。
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            取得元
            <select className="rounded-md border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:bg-slate-100" value={newEvidenceSource} disabled={!editable} onChange={(event) => setNewEvidenceSource(event.target.value as ChartEvidenceSource)}>
              {sourceOptions.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            時間軸
            <select className="rounded-md border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:bg-slate-100" value={newEvidenceTimeframe} disabled={!editable} onChange={(event) => setNewEvidenceTimeframe(event.target.value as ChartEvidenceTimeframe)}>
              {timeframeOptions.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframeLabel(timeframe)}</option>)}
            </select>
          </label>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void addFiles(event.target.files ?? [])}
          />
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            disabled={!editable}
            onClick={() => fileInputRef.current?.click()}
          >
            画像添付
          </button>
        </div>
        {!editable && editDisabledReason ? <p className="mt-2 text-xs text-amber-700">{editDisabledReason}</p> : null}
        {imageStatus ? <p className="mt-2 text-xs font-semibold text-teal-800">{imageStatus}</p> : null}
      </div>

      <div className="mt-4">
        <div className="text-sm font-bold text-slate-800">テクニカル根拠タグ</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {technicalTagOptions.map((tag) => {
            const selected = journal.technicalTags.includes(tag);
            return (
              <button
                type="button"
                key={tag}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  selected ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600"
                }`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <TextField label="想定シナリオ" value={journal.expectedScenario ?? ""} onChange={(expectedScenario) => updateJournal({ expectedScenario })} />
        <TextField label="利確方針" value={journal.profitTakingPlan ?? ""} onChange={(profitTakingPlan) => updateJournal({ profitTakingPlan })} />
        <TextField label="損切り方針" value={journal.stopLossPlan ?? ""} onChange={(stopLossPlan) => updateJournal({ stopLossPlan })} />
      </div>

      <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3" open={reviewMode}>
        <summary className="cursor-pointer text-sm font-bold text-slate-900">決済後の振り返り</summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">仮説どおりだったか</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2"
              value={journal.review?.outcome ?? "not_reviewed"}
              onChange={(event) => updateReview({ outcome: event.target.value as EntryRationaleReviewOutcome })}
            >
              {(["not_reviewed", "as_expected", "partly_expected", "unexpected"] as EntryRationaleReviewOutcome[]).map((outcome) => (
                <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>
              ))}
            </select>
          </label>
          <InputField label="決済日" value={journal.review?.closedAt ?? ""} onChange={(closedAt) => updateReview({ closedAt })} />
          <TextField label="結果メモ" value={journal.review?.resultMemo ?? ""} onChange={(resultMemo) => updateReview({ resultMemo })} />
          <TextField label="次回への学び" value={journal.review?.lesson ?? ""} onChange={(lesson) => updateReview({ lesson })} />
        </div>
      </details>

      {selectedImage ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4" onClick={() => setSelectedImage(undefined)}>
          <div className="max-h-[90vh] max-w-5xl overflow-auto rounded-lg bg-white p-3 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-900">チャート画像</div>
              <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs font-bold" onClick={() => setSelectedImage(undefined)}>閉じる</button>
            </div>
            {fullImage ? <img src={fullImage} alt="チャート画像" className="max-h-[78vh] max-w-full rounded" /> : <p className="text-sm text-slate-600">画像を読み込めませんでした。</p>}
          </div>
        </div>
      ) : null}

      {pendingDeleteEvidence ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4" onClick={() => setPendingDeleteEvidence(undefined)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chart-image-delete-dialog-title"
            className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div id="chart-image-delete-dialog-title" className="text-base font-bold text-slate-950">このチャート画像を削除しますか</div>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div><span className="font-semibold text-slate-900">取得元:</span> {sourceLabel(pendingDeleteEvidence.source)}</div>
              <div><span className="font-semibold text-slate-900">時間軸:</span> {timeframeLabel(pendingDeleteEvidence.timeframe)}</div>
              <div><span className="font-semibold text-slate-900">取得日時:</span> {pendingDeleteEvidence.capturedAt}</div>
            </div>
            <p className="mt-3 text-sm text-slate-600">この1枚だけを削除します。他の画像、エントリー理由、タグは変更しません。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                onClick={() => setPendingDeleteEvidence(undefined)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="rounded-md border border-rose-300 bg-rose-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-rose-700"
                onClick={() => void confirmDeleteEvidence()}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
