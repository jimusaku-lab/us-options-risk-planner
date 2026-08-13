import { useEffect, useRef, useState } from "react";

type SharedNumberInputProps = {
  label: string;
  value: number;
  suffix?: string;
  min?: number;
  step?: number;
  placeholder?: string;
  inputId?: string;
};

type NumberInputProps = {
  onChange: (value: number) => void;
  emptyAsUndefined?: false | undefined;
} & SharedNumberInputProps | {
  onChange: (value: number | undefined) => void;
  emptyAsUndefined: true;
} & SharedNumberInputProps;

function formatInputValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

export function NumberInput({ label, value, onChange, suffix, min, step, placeholder, inputId, emptyAsUndefined = false }: NumberInputProps) {
  const [draftValue, setDraftValue] = useState(() => formatInputValue(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const nextValue = formatInputValue(value);
    const isFocused = typeof document !== "undefined" && document.activeElement === inputRef.current;
    if (!isFocused) setDraftValue(nextValue);
  }, [value]);

  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <span className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white">
        <input
          ref={inputRef}
          id={inputId}
          className="numeric-input min-w-0 flex-1 border-0 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-600"
          type="number"
          value={draftValue}
          placeholder={placeholder}
          min={min}
          step={step ?? "any"}
          onChange={(event) => {
            const nextRawValue = event.target.value;
            setDraftValue(nextRawValue);
            if (nextRawValue === "") {
              if (emptyAsUndefined) (onChange as (value: number | undefined) => void)(undefined);
              else (onChange as (value: number) => void)(0);
              return;
            }
            const parsed = Number(nextRawValue);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          onBlur={() => setDraftValue(formatInputValue(value))}
        />
        {suffix ? <span className="shrink-0 px-3 text-xs text-slate-500">{suffix}</span> : null}
      </span>
    </label>
  );
}
