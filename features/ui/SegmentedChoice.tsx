"use client";

import { Check } from "lucide-react";
import { useContext, type KeyboardEvent } from "react";
import { QuestionLabelContext, QuestionHintContext } from "../application/QuestionContent";

/** One tab stop per choice group; arrows select without leaving the group. */
export function SegmentedChoice<Value extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: Value | "";
  options: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
  label?: string;
}) {
  const questionLabel = useContext(QuestionLabelContext);
  const hintId = useContext(QuestionHintContext);
  const selectedIndex = options.findIndex((option) => option.value === value);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || buttons.length === 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    buttons[next].click();
  }

  return (
    <div className="choice-row" role="radiogroup" aria-label={label ?? questionLabel} aria-describedby={hintId} onKeyDown={onKeyDown}>
      {options.map((option, index) => (
        <button
          className={value === option.value ? "selected" : ""}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          <span aria-hidden="true">{value === option.value ? <Check size={12} /> : null}</span>
          {option.label}
        </button>
      ))}
    </div>
  );
}
