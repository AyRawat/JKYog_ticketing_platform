import type { BookingResponse } from "@ticketing/contracts";
import type { IsoDate } from "@ticketing/domain";

export interface DoorEntry {
  readonly fullName: string;
  /** The ticket they show, e.g. "Family Pass". */
  readonly ticket: string;
}

export interface DoorDay {
  readonly day: IsoDate;
  readonly people: readonly DoorEntry[];
}

export interface DoorList {
  /** Each festival day someone in the booking is admitted, in date order. */
  readonly days: readonly DoorDay[];
  /** Children under the free age: no ticket, listed so the door expects them. */
  readonly freeChildren: readonly string[];
}

/**
 * The booking as the door volunteers need it: who comes in on which day, with which ticket.
 * Ticket names come from the booking's own lines, as they were when it was made.
 */
export function doorList(booking: BookingResponse): DoorList {
  const ticketNames = new Map(booking.lines.map((line) => [line.productCode, line.productName]));
  const byDay = new Map<IsoDate, DoorEntry[]>();
  const freeChildren: string[] = [];

  for (const attendee of booking.attendees) {
    if (attendee.productCode === null) {
      freeChildren.push(attendee.fullName);
      continue;
    }
    const ticket = ticketNames.get(attendee.productCode) ?? attendee.productCode;
    for (const day of attendee.days) {
      byDay.set(day, [...(byDay.get(day) ?? []), { fullName: attendee.fullName, ticket }]);
    }
  }

  return {
    days: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, people]) => ({ day, people })),
    freeChildren,
  };
}
