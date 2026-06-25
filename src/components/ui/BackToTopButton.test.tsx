import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackToTopButton } from "./BackToTopButton";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  vi.restoreAllMocks();
});

describe("BackToTopButton", () => {
  it("stays hidden near the top and appears after scrolling", () => {
    render(<BackToTopButton threshold={100} />);

    expect(screen.queryByRole("button", { name: "上に戻る" })).not.toBeInTheDocument();

    Object.defineProperty(window, "scrollY", { value: 101, configurable: true });
    fireEvent.scroll(window);

    expect(screen.getByRole("button", { name: "上に戻る" })).toBeInTheDocument();
  });

  it("scrolls the requested target into view", () => {
    const scrollIntoView = vi.fn();
    const target = document.createElement("div");
    target.id = "performance-view-top";
    target.scrollIntoView = scrollIntoView;
    document.body.appendChild(target);

    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    render(<BackToTopButton targetId="performance-view-top" threshold={100} />);

    fireEvent.click(screen.getByRole("button", { name: "上に戻る" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
