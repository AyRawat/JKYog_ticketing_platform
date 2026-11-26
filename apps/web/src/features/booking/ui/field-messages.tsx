"use client";

import { useBooking } from "../booking-context";
import { fieldDomId } from "../state/fields";

/** The id an input should list in `aria-describedby`, if its field has messages showing. */
export function useMessageId(fieldKey: string): string | undefined {
  const { messages } = useBooking();
  return messages.has(fieldKey) ? fieldDomId(fieldKey) : undefined;
}

/** The problems with one field, linked to it by id. Renders nothing when there are none. */
export function FieldMessages({ fieldKey }: { readonly fieldKey: string }) {
  const { messages } = useBooking();
  const list = messages.get(fieldKey);
  if (!list?.length) return null;
  return (
    <ul id={fieldDomId(fieldKey)} className="mt-2 space-y-1 text-sm text-error-text">
      {list.map((message) => (
        <li key={message} className="flex gap-2">
          <ErrorIcon />
          <span>{message}</span>
        </li>
      ))}
    </ul>
  );
}

export function ErrorIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-0.5 size-4 shrink-0 fill-current text-error"
    >
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.5h1.5v4.5h-1.5V4.5Zm0 6h1.5V12h-1.5v-1.5Z" />
    </svg>
  );
}
