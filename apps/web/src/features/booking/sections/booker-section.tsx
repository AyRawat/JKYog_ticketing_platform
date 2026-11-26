"use client";

import { useBooking } from "../booking-context";
import { fieldKey } from "../state/fields";
import { BOOKER_PERSON_ID } from "../state/reducer";
import { Card, SectionHeading, Switch } from "../ui/controls";
import { dayLabel } from "../ui/format";
import { TextField } from "../ui/text-field";

/** The person paying: asked once per booking. */
export function BookerSection() {
  const { catalog, state, dispatch } = useBooking();
  const { booker } = state;
  const attending = state.people.some((person) => person.kind === "booker");
  const { ageRules } = catalog.event;

  return (
    <section aria-labelledby="booker-heading" className="space-y-4">
      <div>
        <SectionHeading id="booker-heading">Your details</SectionHeading>
        <p className="mt-1 text-white/65">We'll send the confirmation to you.</p>
      </div>
      <Card className="space-y-6">
        <Switch
          id="booking-for-someone-else"
          label="Booking for someone else?"
          description={
            attending
              ? "Turn this on if you're paying but not coming."
              : "You won't get a ticket. Add the people who are coming below."
          }
          checked={!attending}
          onChange={(forSomeoneElse) => {
            dispatch({ type: "bookerAttendingSet", attending: !forSomeoneElse });
          }}
        />
        <div className="grid gap-5 border-t border-white/10 pt-6 sm:grid-cols-2">
          <TextField
            className="sm:col-span-2"
            label="Full name"
            fieldKey={fieldKey.booker("fullName")}
            autoComplete="name"
            value={booker.fullName}
            onValueChange={(value) => {
              dispatch({ type: "bookerChanged", field: "fullName", value });
            }}
          />
          <TextField
            label="Email"
            fieldKey={fieldKey.booker("email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={booker.email}
            onValueChange={(value) => {
              dispatch({ type: "bookerChanged", field: "email", value });
            }}
          />
          <TextField
            label="Phone"
            fieldKey={fieldKey.booker("phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={booker.phone}
            onValueChange={(value) => {
              dispatch({ type: "bookerChanged", field: "phone", value });
            }}
          />
          <TextField
            label="Your age"
            hint={`On ${dayLabel(ageRules.referenceDate)}. You must be ${String(ageRules.bookerMinAge)} or over to book.`}
            fieldKey={fieldKey.booker("ageYears")}
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            value={booker.ageText}
            onValueChange={(value) => {
              dispatch({ type: "bookerChanged", field: "ageText", value });
            }}
            onCommit={() => {
              dispatch({ type: "ageCommitted", id: BOOKER_PERSON_ID });
            }}
          />
        </div>
      </Card>
    </section>
  );
}
