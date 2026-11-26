"use client";

import { useState } from "react";
import { useBooking } from "../booking-context";
import { fieldGroupId, fieldKey } from "../state/fields";
import { focusRing, SectionHeading } from "../ui/controls";
import { FieldMessages } from "../ui/field-messages";
import { FamilyCard } from "./family-card";
import { PersonCard } from "./person-card";

/** Everyone coming, one card each, and the way to add another. */
export function GroupSection() {
  const { catalog, state, dispatch } = useBooking();
  const [justAdded, setJustAdded] = useState<string | null>(null);

  return (
    <section aria-labelledby="group-heading" className="space-y-4">
      <div>
        <SectionHeading id="group-heading">Your group</SectionHeading>
        <p className="mt-1 text-white/65">
          Everyone coming, with their ticket and extras. Under {catalog.event.ageRules.childMinAge}s
          go free, but add them so the door team expects them.
        </p>
      </div>

      <div id={fieldGroupId(fieldKey.people)}>
        <FieldMessages fieldKey={fieldKey.people} />
      </div>

      {state.people.length > 0 && (
        <ol className="space-y-4">
          {state.people.map((person, index) => {
            const { family } = person;
            if (!family) {
              return (
                <PersonCard
                  key={person.id}
                  person={person}
                  position={index + 1}
                  focusName={person.id === justAdded}
                />
              );
            }
            // A family shows once, as one card, where its first member is.
            const first = state.people.find((p) => p.family?.familyId === family.familyId);
            return first?.id === person.id ? (
              <FamilyCard
                key={family.familyId}
                familyId={family.familyId}
                onPersonAdded={setJustAdded}
              />
            ) : null;
          })}
        </ol>
      )}

      <button
        type="button"
        onClick={() => {
          const id = crypto.randomUUID();
          dispatch({ type: "guestAdded", id });
          setJustAdded(id);
        }}
        className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gold/70 text-bright-gold transition-colors hover:border-bright-gold hover:bg-white/5 ${focusRing}`}
      >
        <span aria-hidden="true" className="text-xl leading-none">
          +
        </span>
        {state.people.length === 0 ? "Add a person" : "Add another person"}
      </button>
    </section>
  );
}
