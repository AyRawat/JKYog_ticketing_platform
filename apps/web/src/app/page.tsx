import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BookingFlow } from "@/features/booking/booking-flow";
import { EVENT_SLUG } from "@/features/booking/config";
import { getPublicCatalog } from "@/server/catalog/get-catalog";

const festivalDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default async function HomePage() {
  // Rendered per request: availability changes as people book, so never prerender it.
  await connection();

  const catalog = await getPublicCatalog(EVENT_SLUG);
  if (!catalog) notFound();

  const { event } = catalog;
  const first = event.days[0]?.date;
  const last = event.days.at(-1)?.date;
  const dates =
    first && last
      ? `${String(new Date(`${first}T00:00:00Z`).getUTCDate())}–${festivalDate.format(new Date(`${last}T00:00:00Z`))}`
      : null;

  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 pb-32 sm:px-6 lg:pb-16">
      <header>
        <p className="text-sm font-medium tracking-widest text-bright-gold uppercase">
          Book your family's tickets
        </p>
        <h1 className="mt-2 font-serif text-4xl text-white sm:text-5xl">{event.name}</h1>
        <p className="mt-2 text-white/75">
          {event.venue}
          {dates ? ` · ${dates}` : ""}
        </p>
      </header>
      <BookingFlow catalog={catalog} />
    </main>
  );
}
