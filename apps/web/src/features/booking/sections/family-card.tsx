"use client";

import { useState } from "react";
import { useBooking } from "../booking-context";
import { bandForAgeText } from "../state/age-input";
import { fieldDomId, fieldGroupId, fieldKey } from "../state/fields";
import { familyMembers, personAgeText } from "../state/reducer";
import { findEntryProduct } from "../state/ticket-for-age";
import type { Person } from "../state/types";
import { Chip, CloseButton, focusRing, WaitFor } from "../ui/controls";
import { FieldMessages, useMessageId } from "../ui/field-messages";
import { bandLabel, formatPrice, shortDayLabel, whoIs } from "../ui/format";
import { TextField } from "../ui/text-field";
import { PersonExtrasFields } from "./person-extras";

interface FamilyCardProps {
  readonly familyId: string;
  /** Opens a separate ticket for a member who is also coming on other days. */
  readonly onPersonAdded: (id: string) => void;
}

/**
 * One shared pass for a whole family: the days are chosen once, and each place is just a name
 * and an age. Members are still separate attendees underneath, each holding the pass.
 */
export function FamilyCard({ familyId, onPersonAdded }: FamilyCardProps) {
  const { catalog, state, dispatch, messages } = useBooking();
  const members = familyMembers(state, familyId);
  const entry = members[0]?.entry;
  const product = entry ? findEntryProduct(catalog, entry.productCode) : undefined;
  if (!product || !entry) return null;

  const headingId = `family-${familyId}-heading`;
  // The pass's own problems (wrong mix of ages, missing days) come back on its holders' ticket
  // and days; they belong to the family card as a whole.
  const ticketKeys = members.flatMap((m) => [
    fieldKey.person(m.id, "ticket"),
    fieldKey.person(m.id, "days"),
  ]);
  const familyMessages = [...new Set(ticketKeys.flatMap((key) => messages.get(key) ?? []))];
  const hasProblems = [...messages.keys()].some((key) =>
    members.some((m) => key.startsWith(`person:${m.id}.`)),
  );
  const adults = members.filter((m) => m.family?.role === "adult");
  const children = members.filter((m) => m.family?.role === "child");
  const daysGroupId = fieldGroupId(fieldKey.person(members[0]?.id ?? familyId, "days"));

  return (
    <li
      aria-labelledby={headingId}
      className={`rounded-2xl border bg-white/5 ${hasProblems ? "border-error/70" : "border-gold/60"}`}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div>
          <h3 id={headingId} className="font-serif text-xl text-white">
            {product.name}
          </h3>
          <p className="text-sm text-white/65">
            {product.admits.adults} adults + {product.admits.children} children, together on the
            same days
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <p className="font-semibold text-bright-gold tabular-nums">
            {formatPrice(product.unitPriceCents)}
            <span className="font-normal"> / day</span>
          </p>
          <CloseButton
            label={`Remove the ${product.name}. Anyone you've named stays as a separate card.`}
            onClick={() => {
              dispatch({ type: "familySplit", familyId });
            }}
          />
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <fieldset id={daysGroupId}>
          <legend className="text-sm font-medium text-white">
            Which days is the family coming?
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {catalog.event.days
              .filter((day) => product.availableDays.includes(day.date))
              .map((day) => (
                <Chip
                  key={day.date}
                  pressed={entry.days.includes(day.date)}
                  disabled={!day.bookable}
                  onToggle={() => {
                    dispatch({ type: "familyDayToggled", familyId, day: day.date });
                    for (const m of members) {
                      dispatch({ type: "fieldTouched", key: fieldKey.person(m.id, "days") });
                    }
                  }}
                >
                  {shortDayLabel(day.date)}
                </Chip>
              ))}
          </div>
          {familyMessages.length > 0 && (
            <ul
              id={`family-${familyId}-messages`}
              className="mt-2 space-y-1 text-sm text-error-text"
            >
              {familyMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </fieldset>

        <WaitFor waiting={entry.days.length === 0} note="Pick the family's days first.">
          <div className="space-y-6">
            <PlaceGroup
              title={`Adults (${String(catalog.event.ageRules.adultMinAge)}+)`}
              members={adults}
              onPersonAdded={onPersonAdded}
            />
            <PlaceGroup
              title={`Children (${String(catalog.event.ageRules.childMinAge)}–${String(catalog.event.ageRules.adultMinAge - 1)})`}
              members={children}
              onPersonAdded={onPersonAdded}
            />
          </div>
        </WaitFor>

        <div className="border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "familySplit", familyId });
            }}
            className={`rounded-lg px-1 py-1 text-sm text-white/65 underline-offset-4 hover:text-white hover:underline ${focusRing}`}
          >
            Switch to separate tickets
          </button>
        </div>
      </div>
    </li>
  );
}

function PlaceGroup({
  title,
  members,
  onPersonAdded,
}: {
  title: string;
  members: readonly Person[];
  onPersonAdded: (id: string) => void;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wider text-white/65 uppercase">{title}</h4>
      <ol className="mt-2 space-y-3">
        {members.map((member) => (
          <FamilyPlaceRow key={member.id} member={member} onPersonAdded={onPersonAdded} />
        ))}
      </ol>
    </div>
  );
}

function FamilyPlaceRow({
  member,
  onPersonAdded,
}: {
  member: Person;
  onPersonAdded: (id: string) => void;
}) {
  const { catalog, state, dispatch, messages } = useBooking();
  const [open, setOpen] = useState(false);
  const { ageRules } = catalog.event;
  const isBooker = member.kind === "booker";
  const name = (isBooker ? state.booker.fullName : member.fullName).trim();
  const ageText = personAgeText(state, member);
  const band = bandForAgeText(ageText, ageRules);
  const firstName =
    name.split(/\s+/)[0] || (member.family?.role === "child" ? "this child" : "this adult");
  const ageKey = fieldKey.person(member.id, "ageYears");
  const bookerAgeMessageId = useMessageId(ageKey);
  const showsPhone = !isBooker && band === "adult";
  const detailsId = `${fieldDomId(fieldKey.person(member.id, "fullName"))}-details`;
  // Problems with this person's extras open their details, so none stay hidden.
  const extraKeys = [
    ...Object.entries(member.extras.days).flatMap(([code, days]) =>
      (days ?? []).map((day) => fieldKey.extra(code, day)),
    ),
    ...Object.keys(member.extras.quantities).map((code) => fieldKey.extra(code, null)),
  ];
  const expanded = open || extraKeys.some((key) => messages.has(key));

  return (
    <li className="rounded-xl border border-white/15 bg-white/[0.03] p-4">
      {isBooker ? (
        <div aria-describedby={bookerAgeMessageId}>
          <p className="text-white">
            {name || "You"} <span className="text-sm text-white/65">(you)</span>
          </p>
          <p className="text-sm text-white/65">
            {band ? bandLabel(band, ageRules) : "Add your age in Your details"} · from Your details
          </p>
          <FieldMessages fieldKey={ageKey} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <TextField
            label="Full name"
            fieldKey={fieldKey.person(member.id, "fullName")}
            autoComplete="off"
            value={member.fullName}
            onValueChange={(value) => {
              dispatch({ type: "guestChanged", id: member.id, field: "fullName", value });
            }}
          />
          <TextField
            label="Age"
            fieldKey={ageKey}
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            value={member.ageText}
            onValueChange={(value) => {
              dispatch({ type: "guestChanged", id: member.id, field: "ageText", value });
            }}
            onCommit={() => {
              dispatch({ type: "ageCommitted", id: member.id });
            }}
          />
        </div>
      )}

      {band !== "infant" && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => {
            setOpen(!expanded);
          }}
          className={`mt-3 rounded-lg px-1 py-1 text-sm font-medium text-bright-gold ${focusRing}`}
        >
          {expanded ? "▾" : "▸"} {showsPhone ? "Phone & extras" : "Extras"} for {firstName}
        </button>
      )}

      {expanded && band !== "infant" && (
        <div id={detailsId} className="mt-3 space-y-5">
          {member.kind === "guest" && band === "adult" && (
            <TextField
              label="Phone (optional)"
              hint="Helps the door team reach your group."
              fieldKey={fieldKey.person(member.id, "phone")}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={member.phone}
              onValueChange={(value) => {
                dispatch({ type: "guestChanged", id: member.id, field: "phone", value });
              }}
            />
          )}
          <PersonExtrasFields person={member} who={whoIs(firstName)} />
          <p className="text-sm text-white/65">
            Coming on other days too?{" "}
            <button
              type="button"
              className={`font-medium text-bright-gold underline underline-offset-4 ${focusRing}`}
              onClick={() => {
                const id = crypto.randomUUID();
                dispatch({ type: "guestAdded", id, fullName: name, ageText });
                dispatch({ type: "ageCommitted", id });
                onPersonAdded(id);
              }}
            >
              Add {name ? name.split(/\s+/)[0] : "them"} on a separate ticket
            </button>
          </p>
        </div>
      )}
    </li>
  );
}
