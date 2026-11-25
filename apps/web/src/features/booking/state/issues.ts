import type { QuoteRequestInput } from "@ticketing/contracts";
import { fieldKey, type PersonField } from "./fields";
import { BOOKER_PERSON_ID } from "./reducer";

// The server points at problems with request paths ("attendees[1].entry.days[0]"). The form
// shows them next to the input they are about. Attendee indices go through `attendeeIds`
// because the request can leave out people whose age isn't readable yet.

export interface PathMessage {
  readonly path: string;
  readonly message: string;
}

export interface RequestShape {
  /** `attendeeIds[i]` is the person sent as `attendees[i]`. */
  readonly attendeeIds: readonly string[];
  /** The extras as sent, so `extras[k]` can be matched to a product and day. */
  readonly extras: NonNullable<QuoteRequestInput["extras"]>;
}

const ATTENDEE_FIELDS: Readonly<Record<string, PersonField>> = {
  fullName: "fullName",
  ageYears: "ageYears",
  phone: "phone",
  entry: "ticket",
  "entry.productCode": "ticket",
  "entry.days": "days",
};

const BOOKER_FIELDS: Readonly<Record<string, string>> = {
  fullName: fieldKey.booker("fullName"),
  email: fieldKey.booker("email"),
  phone: fieldKey.booker("phone"),
  ageYears: fieldKey.booker("ageYears"),
};

/** The form field a request path is about, or `fieldKey.form` when it can't be placed. */
export function fieldForPath(path: string, shape: RequestShape): string {
  const attendee = /^attendees\[(\d+)\](?:\.(.+))?$/.exec(path);
  if (attendee) {
    const personId = shape.attendeeIds[Number(attendee[1])];
    if (personId === undefined) return fieldKey.form;
    // "entry.days[2]" is about the day picker as a whole.
    const rest = (attendee[2] ?? "").replace(/\[\d+\]$/, "");
    const field = ATTENDEE_FIELDS[rest] ?? "ticket";
    // The attending booker's name and age are typed in the booker's own fields.
    if (personId === BOOKER_PERSON_ID && (field === "fullName" || field === "ageYears")) {
      return fieldKey.booker(field);
    }
    return fieldKey.person(personId, field);
  }

  if (path === "attendees") return fieldKey.people;

  const extra = /^extras\[(\d+)\]/.exec(path);
  if (extra) {
    const sent = shape.extras[Number(extra[1])];
    return sent ? fieldKey.extra(sent.productCode, sent.day ?? null) : fieldKey.form;
  }

  const booker = /^booker\.(\w+)$/.exec(path);
  const bookerField = booker?.[1] && BOOKER_FIELDS[booker[1]];
  if (bookerField) return bookerField;

  if (path === "promoCode") return fieldKey.promo;
  return fieldKey.form;
}

/** Messages grouped by the field they belong to, in the order the server sent them. */
export function messagesByField(
  messages: readonly PathMessage[],
  shape: RequestShape,
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const { path, message } of messages) {
    const key = fieldForPath(path, shape);
    const list = grouped.get(key) ?? [];
    if (!list.includes(message)) list.push(message);
    grouped.set(key, list);
  }
  return grouped;
}
