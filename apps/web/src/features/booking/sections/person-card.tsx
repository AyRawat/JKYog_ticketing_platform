"use client";

import { useState } from "react";
import { useBooking } from "../booking-context";
import { bandForAgeText } from "../state/age-input";
import { fieldDomId, fieldKey } from "../state/fields";
import { personAgeText } from "../state/reducer";
import { findEntryProduct } from "../state/ticket-for-age";
import type { Person } from "../state/types";
import { focusRing } from "../ui/controls";
import { bandLabel, dayLabel, shortDayList } from "../ui/format";
import { TextField } from "../ui/text-field";
import { PersonExtrasFields } from "./person-extras";
import { TicketPicker } from "./ticket-picker";

interface PersonCardProps {
  readonly person: Person;
  /** 1-based, for "Person 2" before a name is typed. */
  readonly position: number;
  /** Put the cursor in the name field: for a person just added. */
  readonly focusName: boolean;
}

/** Everything about one person: who they are, their ticket and days, and their extras. */
export function PersonCard({ person, position, focusName }: PersonCardProps) {
  const { catalog, state, dispatch, messages } = useBooking();
  const [open, setOpen] = useState(true);
  const { ageRules } = catalog.event;
  const isBooker = person.kind === "booker";
  const name = (isBooker ? state.booker.fullName : person.fullName).trim();
  const firstName = name.split(/\s+/)[0] || (isBooker ? "you" : `person ${String(position)}`);
  const band = bandForAgeText(personAgeText(state, person), ageRules);
  const headingId = `${fieldDomId(fieldKey.person(person.id, "fullName"))}-heading`;
  const hasProblems = [...messages.keys()].some((key) => key.startsWith(`person:${person.id}.`));
  // A folded card with problems opens itself once they are showing, so none stay hidden.
  const expanded = open || hasProblems;

  return (
    <li
      aria-labelledby={headingId}
      className={`rounded-2xl border bg-white/5 ${hasProblems ? "border-error/70" : "border-white/20"}`}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h3 id={headingId} className="truncate font-serif text-xl text-white">
            {name || (isBooker ? "You" : `Person ${String(position)}`)}
            {isBooker && name && (
              <span className="ml-2 font-sans text-sm text-white/65">(you)</span>
            )}
          </h3>
          <p className="text-sm text-bright-gold">
            {band ? bandLabel(band, ageRules) : "Age needed"}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setOpen(!expanded);
          }}
          className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-bright-gold hover:bg-white/5 ${focusRing}`}
        >
          {expanded ? "Done" : "Edit"}
        </button>
      </div>

      {!expanded ? (
        <p className="px-5 pt-1 pb-5 text-sm text-white/65 sm:px-6">
          {collapsedSummary(person, band, catalog)}
        </p>
      ) : (
        <div className="space-y-6 p-5 sm:p-6">
          {person.kind === "booker" ? (
            <p className="text-sm text-white/65">Your name and age come from Your details above.</p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-[1fr_9rem]">
              <TextField
                label="Full name"
                fieldKey={fieldKey.person(person.id, "fullName")}
                autoComplete="off"
                // A person just added: the cursor goes straight to their name.
                autoFocus={focusName}
                value={person.fullName}
                onValueChange={(value) => {
                  dispatch({ type: "guestChanged", id: person.id, field: "fullName", value });
                }}
              />
              <TextField
                label="Age"
                hint={`On ${dayLabel(ageRules.referenceDate)}`}
                fieldKey={fieldKey.person(person.id, "ageYears")}
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                value={person.ageText}
                onValueChange={(value) => {
                  dispatch({ type: "guestChanged", id: person.id, field: "ageText", value });
                }}
                onCommit={() => {
                  dispatch({ type: "ageCommitted", id: person.id });
                }}
              />
              {band === "adult" && (
                <TextField
                  className="sm:col-span-2"
                  label="Phone (optional)"
                  hint="Helps the door team reach your group."
                  fieldKey={fieldKey.person(person.id, "phone")}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={person.phone}
                  onValueChange={(value) => {
                    dispatch({ type: "guestChanged", id: person.id, field: "phone", value });
                  }}
                />
              )}
            </div>
          )}

          {band === "infant" ? (
            <p className="rounded-xl bg-success/15 px-4 py-3 text-sm text-success-text">
              Free entry, no ticket needed. Under {ageRules.childMinAge}s come in with their family.
            </p>
          ) : (
            <>
              <TicketPicker person={person} band={band} firstName={firstName} />
              <PersonExtrasFields person={person} firstName={firstName} />
            </>
          )}

          <div className="border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => {
                dispatch(
                  isBooker
                    ? {
                        type: "bookerAttendingSet",
                        attending: false,
                        replacementId: crypto.randomUUID(),
                      }
                    : { type: "personRemoved", id: person.id },
                );
              }}
              className={`rounded-lg px-1 py-1 text-sm text-white/65 underline-offset-4 hover:text-error-text hover:underline ${focusRing}`}
            >
              {isBooker ? "I'm not coming" : `Remove ${firstName}`}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function collapsedSummary(
  person: Person,
  band: ReturnType<typeof bandForAgeText>,
  catalog: Parameters<typeof findEntryProduct>[0],
): string {
  if (band === "infant") return "Free entry, no ticket";
  if (!person.entry) return "No ticket chosen yet";
  const product = findEntryProduct(catalog, person.entry.productCode);
  if (!product) return "No ticket chosen yet";
  const days =
    product.dayScope === "whole_event"
      ? "all days"
      : shortDayList(person.entry.days) || "no days yet";
  const extras =
    Object.values(person.extras.days).reduce((n, list) => n + (list?.length ?? 0), 0) +
    Object.values(person.extras.quantities).reduce<number>((n, q) => n + (q ?? 0), 0);
  return `${product.name}, ${days}${extras > 0 ? ` · ${String(extras)} extra${extras === 1 ? "" : "s"}` : ""}`;
}
