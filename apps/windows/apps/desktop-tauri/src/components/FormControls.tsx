import type React from "react";

// ── tiny reusable controls ──────────────────────────────────────────

export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const input = (
    <input
      type="checkbox"
      className="toggle"
      checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
  if (label) {
    return (
      <label className={`toggle-label ${disabled ? "toggle-label--disabled" : ""}`}>
        {input}
        <span>{label}</span>
      </label>
    );
  }
  return input;
}

/**
 * A collapsed `<select>` sizes to its widest option, which in this settings
 * sheet means one row can be three times the width of its neighbours. The
 * control is sized to the *selected* label instead — which means measuring
 * it, and a CJK glyph is roughly twice a Latin one at the same size. Getting
 * that wrong is what clipped "自适应" down to "自适".
 */
const FULL_WIDTH_GLYPH =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

/** Padding, border and chevron the pill adds around the label text. */
const SELECT_CHROME = 40;

function labelWidth(text: string): number {
  let width = 0;
  for (const glyph of text) {
    width += FULL_WIDTH_GLYPH.test(glyph) ? 12 : 6.8;
  }
  return Math.ceil(width);
}

export function Select({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  minWidth,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  minWidth?: number;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  const calculatedWidth = Math.min(
    168,
    Math.max(56, labelWidth(selectedLabel ?? "") + SELECT_CHROME),
  );
  const width = Math.max(calculatedWidth, minWidth ?? 0);

  return (
    <select
      className="select"
      style={{ width }}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      className="number-input"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return;
        const n = Number(raw);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

// ── field row ────────────────────────────────────────────────────────

export function Field({
  label,
  description,
  children,
  leading,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  leading?: boolean;
}) {
  return (
    <div className={`settings-field${leading ? " settings-field--leading" : ""}`}>
      {leading && <div className="settings-field__control">{children}</div>}
      <div className="settings-field__text">
        <span className="settings-field__label">{label}</span>
        {description && (
          <span className="settings-field__desc">{description}</span>
        )}
      </div>
      {!leading && <div className="settings-field__control">{children}</div>}
    </div>
  );
}
