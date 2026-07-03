import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import type { ChartEvidence, ChartEvidenceSource, ChartEvidenceTimeframe, EntryRationaleJournal, EntryRationaleReviewOutcome } from "@/types/domain";
import { updateJournalTimestamp } from "@/domain/entryRationaleJournal";
import { readJournalImage, saveJournalImage } from "@/lib/entryRationaleImageStore";

const technicalTagOptions = [
  "SlowKDゴールデンクロス",
  "MACDゴールデンクロス",
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

function createEvidenceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `chart-${crypto.randomUUID()}`;
  return `chart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold text-slate-700">{label}</span>
      <textarea
        className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
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

function EvidenceThumbnail({
  evidence,
  onOpen,
}: {
  evidence: ChartEvidence;
  onOpen: (ref: string) => void;
}) {
  const [thumbnail, setThumbnail] = useState<string | undefined>();
  useEffect(() => {
    let mounted = true;
    void readJournalImage(evidence.thumbnailRef ?? evidence.imageRef).then((dataUrl) => {
      if (mounted) setThumbnail(dataUrl);
    });
    return () => {
      mounted = false;
    };
  }, [evidence.thumbnailRef, evidence.imageRef]);

  return (
    <button
      type="button"
      className="overflow-hidden rounded-md border border-slate-200 bg-white text-left shadow-sm hover:border-teal-300"
      onClick={() => onOpen(evidence.imageRef)}
    >
      {thumbnail ? (
        <img src={thumbnail} alt={evidence.memo || "チャート画像"} className="h-28 w-full object-cover" />
      ) : (
        <div className="flex h-28 items-center justify-center bg-slate-100 text-xs font-semibold text-slate-500">画像保存済み</div>
      )}
      <div className="px-2 py-1.5 text-xs leading-5 text-slate-600">
        <div className="font-bold text-slate-900">{sourceLabel(evidence.source)} / {timeframeLabel(evidence.timeframe)}</div>
        <div>{evidence.capturedAt}</div>
        {evidence.memo ? <div className="line-clamp-2">{evidence.memo}</div> : null}
      </div>
    </button>
  );
}

export function EntryRationaleJournalPanel({
  journal,
  onChange,
  title = "エントリー根拠ジャーナル",
  subtitle,
  candidateReason,
  reviewMode = false,
}: {
  journal: EntryRationaleJournal;
  onChange: (journal: EntryRationaleJournal) => void;
  title?: string;
  subtitle?: string;
  candidateReason?: ReactNode;
  reviewMode?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageStatus, setImageStatus] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | undefined>();
  const [newEvidenceSource, setNewEvidenceSource] = useState<ChartEvidenceSource>("manual");
  const [newEvidenceTimeframe, setNewEvidenceTimeframe] = useState<ChartEvidenceTimeframe>("daily");
  const [newEvidenceMemo, setNewEvidenceMemo] = useState("");
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
          memo: newEvidenceMemo,
          imageRef: refs.imageRef,
          thumbnailRef: refs.thumbnailRef,
        });
      }
      updateJournal({ chartEvidence: [...journal.chartEvidence, ...evidenceItems] });
      setNewEvidenceMemo("");
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

  return (
    <section
      className="rounded-lg border border-teal-200 bg-white p-4 shadow-sm"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onPaste={handlePaste}
      tabIndex={0}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm leading-6 text-slate-600">{subtitle}</p> : null}
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800 ring-1 ring-teal-200">
          画像はブラウザ内保存
        </span>
      </div>

      {candidateReason ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
          <div className="font-bold text-slate-900">候補理由</div>
          <div className="mt-1">{candidateReason}</div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <TextField
          label="エントリー理由"
          value={journal.entryReason}
          placeholder="なぜこの銘柄・戦略・タイミングで入ると判断したか"
          onChange={(entryReason) => updateJournal({ entryReason })}
        />
        <TextField
          label="テクニカル補足メモ"
          value={journal.technicalMemo ?? ""}
          placeholder="SlowKD、MACD、移動平均線、出来高、IV/流動性など"
          onChange={(technicalMemo) => updateJournal({ technicalMemo })}
        />
        <TextField label="想定シナリオ" value={journal.expectedScenario ?? ""} onChange={(expectedScenario) => updateJournal({ expectedScenario })} />
        <TextField label="利確方針" value={journal.profitTakingPlan ?? ""} onChange={(profitTakingPlan) => updateJournal({ profitTakingPlan })} />
        <TextField label="損切り方針" value={journal.stopLossPlan ?? ""} onChange={(stopLossPlan) => updateJournal({ stopLossPlan })} />
        <TextField label="仮説が崩れる条件" value={journal.invalidationCondition ?? ""} onChange={(invalidationCondition) => updateJournal({ invalidationCondition })} />
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

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            取得元
            <select className="rounded-md border border-slate-300 bg-white px-2 py-1" value={newEvidenceSource} onChange={(event) => setNewEvidenceSource(event.target.value as ChartEvidenceSource)}>
              {sourceOptions.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            時間軸
            <select className="rounded-md border border-slate-300 bg-white px-2 py-1" value={newEvidenceTimeframe} onChange={(event) => setNewEvidenceTimeframe(event.target.value as ChartEvidenceTimeframe)}>
              {timeframeOptions.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframeLabel(timeframe)}</option>)}
            </select>
          </label>
          <div className="min-w-[220px] flex-1">
            <InputField label="画像メモ" value={newEvidenceMemo} onChange={setNewEvidenceMemo} />
          </div>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void addFiles(event.target.files ?? [])}
          />
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800"
            onClick={() => fileInputRef.current?.click()}
          >
            チャート画像を添付
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          この枠に画像を貼り付け、またはドラッグ&ドロップできます。画像本体はIndexedDBに保存し、JSONには参照だけを残します。
        </p>
        {imageStatus ? <p className="mt-2 text-xs font-semibold text-teal-800">{imageStatus}</p> : null}
        {journal.chartEvidence.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {journal.chartEvidence.map((evidence) => (
              <EvidenceThumbnail key={evidence.id} evidence={evidence} onOpen={(ref) => void openImage(ref)} />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500">
            チャート画像は未添付です。
          </p>
        )}
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
    </section>
  );
}
