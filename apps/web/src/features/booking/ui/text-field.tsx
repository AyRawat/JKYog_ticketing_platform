"use client";

import type { InputHTMLAttributes } from "react";
import { useBooking } from "../booking-context";
import { fieldDomId } from "../state/fields";
import { FieldMessages, useMessageId } from "./field-messages";

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "value" | "onChange" | "onBlur" | "className"
>;

interface TextFieldProps extends NativeProps {
  readonly label: string;
  /** Short help under the label, e.g. what an age is counted on. */
  readonly hint?: string;
  /** Where this field's messages live; also its element id. */
  readonly fieldKey: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Called when the family is done with the field: on leaving it, or pressing Enter. */
  readonly onCommit?: () => void;
  readonly className?: string;
}

/** A labelled text input. Label above, hint and problems linked by aria-describedby. */
export function TextField({
  label,
  hint,
  fieldKey,
  value,
  onValueChange,
  onCommit,
  className,
  ...native
}: TextFieldProps) {
  const { dispatch } = useBooking();
  const id = inputId(fieldKey);
  const hintId = hint ? `${id}-hint` : undefined;
  const messageId = useMessageId(fieldKey);
  const commit = () => {
    dispatch({ type: "fieldTouched", key: fieldKey });
    onCommit?.();
  };

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-white">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-sm text-white/65">
          {hint}
        </p>
      )}
      <input
        {...native}
        id={id}
        value={value}
        aria-invalid={messageId ? true : undefined}
        aria-describedby={[hintId, messageId].filter(Boolean).join(" ") || undefined}
        className={inputClass}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      <FieldMessages fieldKey={fieldKey} />
    </div>
  );
}

/** The id of the input for a field key, for labels and error-summary links. */
export function inputId(fieldKey: string): string {
  return `${fieldDomId(fieldKey)}-input`;
}

export const inputClass =
  "mt-1.5 block h-12 w-full rounded-lg border border-white/20 bg-white/5 px-3.5 text-base text-white " +
  "placeholder:text-white/40 transition-colors hover:border-white/35 " +
  "focus-visible:border-bright-gold focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-bright-gold aria-invalid:border-error";
