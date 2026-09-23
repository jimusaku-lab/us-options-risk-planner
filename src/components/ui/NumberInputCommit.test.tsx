import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NumberInput } from "./NumberInput";

afterEach(cleanup);

it("does not commit merely because a price input loses focus", () => {
  const commit = vi.fn();
  render(<NumberInput label="test price" value={3} onChange={() => {}} onCommit={commit} />);
  const input = screen.getByRole("spinbutton");
  fireEvent.focus(input);
  fireEvent.blur(input);
  expect(commit).not.toHaveBeenCalled();
});

it("keeps live change separate from committed observation", () => {
  const change = vi.fn();
  const commit = vi.fn();
  render(<NumberInput label="test price" value={3} onChange={change} onCommit={commit} />);
  const input = screen.getByRole("spinbutton");
  fireEvent.change(input, { target: { value: "3.25" } });
  expect(change).toHaveBeenLastCalledWith(3.25);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenLastCalledWith(3.25);
});

it("does not turn an empty committed input into an explicit zero observation", () => {
  const commit = vi.fn();
  render(<NumberInput label="test price" value={3} onChange={() => {}} onCommit={commit} />);
  const input = screen.getByRole("spinbutton");
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  expect(commit).toHaveBeenLastCalledWith(undefined);
});
