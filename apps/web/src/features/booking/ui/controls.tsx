"use client";

import type { ReactNode } from "react";

// Small controls shared across the form. Native elements underneath, so keyboards and screen
// readers get the behaviour for free; styling only.

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright-gold";

interface SwitchProps {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** An on/off switch. The whole row is the hit target. */
export function Switch({ id, label, description, checked, onChange }: SwitchProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="cursor-pointer font-medium text-white">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="mt-0.5 text-sm text-white/65">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descriptionId}
        onClick={() => {
          onChange(!checked);
        }}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${focusRing} ${
          checked ? "border-primary bg-primary" : "border-white/30 bg-white/10"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

interface ChipProps {
  readonly pressed: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
  readonly label?: string;
}

/** A toggle button for picking days. `aria-pressed` tells assistive tech it's on or off. */
export function Chip({ pressed, disabled, onToggle, children, label }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${focusRing} ${
        pressed
          ? "border-primary bg-primary font-semibold text-heading"
          : "border-white/25 bg-white/5 text-white hover:border-bright-gold"
      } disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-white/35`}
    >
      {pressed && <CheckIcon />}
      {children}
    </button>
  );
}

interface StepperProps {
  readonly value: number;
  readonly min?: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  /** What is being counted, for the button labels: "Dandiya sticks for Asha". */
  readonly thing: string;
  readonly describedBy?: string | undefined;
}

/** − n + for small whole numbers. Big, separated buttons for thumbs. */
export function Stepper({ value, min = 0, max, onChange, thing, describedBy }: StepperProps) {
  const button = `grid size-11 place-items-center rounded-lg border border-white/25 bg-white/5 text-xl text-white transition-colors hover:border-bright-gold disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`;
  return (
    <div className="flex items-center gap-3" aria-describedby={describedBy}>
      <button
        type="button"
        className={button}
        disabled={value <= min}
        aria-label={`Fewer ${thing}`}
        onClick={() => {
          onChange(value - 1);
        }}
      >
        −
      </button>
      <output aria-live="polite" className="w-8 text-center text-lg font-semibold tabular-nums">
        {value}
      </output>
      <button
        type="button"
        className={button}
        disabled={value >= max}
        aria-label={`More ${thing}`}
        onClick={() => {
          onChange(value + 1);
        }}
      >
        +
      </button>
    </div>
  );
}

export function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-current">
      <path d="M6.4 11.6 2.8 8l1.1-1.1 2.5 2.5 5.7-5.7 1.1 1.1z" />
    </svg>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/20 bg-white/5 p-5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-serif text-2xl text-bright-gold sm:text-3xl">
      {children}
    </h2>
  );
}
