import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryRationaleJournal } from "@/types/domain";
import { EntryRationaleJournalPanel } from "./EntryRationaleJournalPanel";
import { deleteJournalImageRefs, readJournalImage } from "@/lib/entryRationaleImageStore";

vi.mock("@/lib/entryRationaleImageStore", () => ({
  readJournalImage: vi.fn(async (ref: string | undefined) => (ref ? `data:image/png;base64,${ref}` : undefined)),
  saveJournalImage: vi.fn(),
  deleteJournalImageRefs: vi.fn(async () => undefined),
}));

function buildJournal(overrides?: Partial<EntryRationaleJournal>): EntryRationaleJournal {
  return {
    id: "journal-1",
    symbol: "ALFA",
    strategy: "long_call",
    status: "entered",
    createdAt: "2026-08-12T08:00:00.000Z",
    updatedAt: "2026-08-12T08:00:00.000Z",
    entryReason: "押し目からの反発を想定",
    technicalTags: ["押し目"],
    expectedScenario: "反発継続",
    profitTakingPlan: "段階利確",
    stopLossPlan: "前安値割れ",
    chartEvidence: [
      {
        id: "chart-1",
        source: "TradingView",
        timeframe: "daily",
        capturedAt: "2026-08-12T09:00:00.000Z",
        memo: "",
        imageRef: "image-ref-1",
        thumbnailRef: "thumb-ref-1",
      },
      {
        id: "chart-2",
        source: "TradingView",
        timeframe: "daily",
        capturedAt: "2026-08-12T09:00:00.000Z",
        memo: "",
        imageRef: "image-ref-2",
        thumbnailRef: "thumb-ref-2",
      },
    ],
    review: { outcome: "not_reviewed" },
    ...overrides,
  };
}

describe("EntryRationaleJournalPanel image deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("deletes only the confirmed image by ChartEvidence.id and keeps other fields unchanged", async () => {
    const onChange = vi.fn();
    render(<EntryRationaleJournalPanel title="" journal={buildJournal()} onChange={onChange} />);

    const deleteButtons = screen.getAllByRole("button", { name: /チャート画像を削除:/ });
    expect(deleteButtons).toHaveLength(2);

    fireEvent.click(deleteButtons[1]);
    expect(screen.getByRole("dialog")).toHaveTextContent("TradingView");
    expect(screen.getByRole("dialog")).toHaveTextContent("日足");
    expect(screen.getByRole("dialog")).toHaveTextContent("2026-08-12T09:00:00.000Z");

    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    const updated = onChange.mock.calls.at(-1)?.[0] as EntryRationaleJournal;
    expect(updated.chartEvidence.map((item) => item.id)).toEqual(["chart-1"]);
    expect(updated.entryReason).toBe("押し目からの反発を想定");
    expect(updated.technicalTags).toEqual(["押し目"]);
    expect(updated.expectedScenario).toBe("反発継続");
    expect(updated.profitTakingPlan).toBe("段階利確");
    expect(updated.stopLossPlan).toBe("前安値割れ");
    expect(updated.updatedAt).not.toBe("2026-08-12T08:00:00.000Z");
    expect(deleteJournalImageRefs).toHaveBeenCalledWith(["image-ref-2", "thumb-ref-2"]);
  });

  it("does not delete anything when the dialog is cancelled", () => {
    const onChange = vi.fn();
    render(<EntryRationaleJournalPanel title="" journal={buildJournal()} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole("button", { name: /チャート画像を削除:/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(deleteJournalImageRefs).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns to the empty state after deleting the last remaining image", () => {
    const onChange = vi.fn();
    const singleImageJournal = buildJournal({
      chartEvidence: [buildJournal().chartEvidence[0]],
    });
    render(
      <EntryRationaleJournalPanel
        title=""
        journal={singleImageJournal}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /チャート画像を削除:/ }));
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    const updated = onChange.mock.calls.at(-1)?.[0] as EntryRationaleJournal;
    expect(updated.chartEvidence).toEqual([]);

    render(<EntryRationaleJournalPanel title="" journal={updated} onChange={vi.fn()} />);
    expect(screen.getAllByText("チャート画像は未添付です。").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "画像添付" }).length).toBeGreaterThan(0);
  });

  it("keeps the deleted image removed after JSON serialize/deserialize reload", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EntryRationaleJournalPanel title="" journal={buildJournal()} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole("button", { name: /チャート画像を削除:/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    const updated = onChange.mock.calls.at(-1)?.[0] as EntryRationaleJournal;
    const reloaded = JSON.parse(JSON.stringify(updated)) as EntryRationaleJournal;
    rerender(<EntryRationaleJournalPanel title="" journal={reloaded} onChange={vi.fn()} />);

    expect(screen.getAllByRole("button", { name: /チャート画像を削除:/ })).toHaveLength(1);
    expect(readJournalImage).toHaveBeenCalledWith("image-ref-2");
    expect(
      screen.queryByRole("button", {
        name: "チャート画像を削除: TradingView / 日足 / 2026-08-12T09:00:00.000Z / chart-1",
      }),
    ).not.toBeInTheDocument();
  });

  it("exposes a clear aria-label for each delete button", () => {
    render(<EntryRationaleJournalPanel title="" journal={buildJournal()} onChange={vi.fn()} />);

    expect(
      screen.getByRole("button", {
        name: "チャート画像を削除: TradingView / 日足 / 2026-08-12T09:00:00.000Z / chart-1",
      }),
    ).toBeInTheDocument();
  });

  it("shows delete as disabled with a reason when editing is not allowed", () => {
    render(
      <EntryRationaleJournalPanel
        title=""
        journal={buildJournal()}
        onChange={vi.fn()}
        editable={false}
        editDisabledReason="確認済みのため画像は編集できません。"
      />,
    );

    expect(screen.getAllByRole("button", { name: /チャート画像を削除:/ })[0]).toBeDisabled();
    expect(screen.getAllByText("確認済みのため画像は編集できません。").length).toBeGreaterThan(0);
  });
});
