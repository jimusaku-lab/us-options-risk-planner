type NumberInputProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
  placeholder?: string;
};

export function NumberInput({ label, value, onChange, suffix, min, step, placeholder }: NumberInputProps) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <span className="flex items-center overflow-hidden rounded-md border border-slate-300 bg-white">
        <input
          className="numeric-input min-w-0 flex-1 border-0 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-600"
          type="number"
          value={Number.isFinite(value) ? value : ""}
          placeholder={placeholder}
          min={min}
          step={step ?? "any"}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <span className="shrink-0 px-3 text-xs text-slate-500">{suffix}</span> : null}
      </span>
    </label>
  );
}
