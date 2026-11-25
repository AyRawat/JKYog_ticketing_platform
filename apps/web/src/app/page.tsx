import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BookingFlow } from "@/features/booking/booking-flow";
import { EVENT_SLUG } from "@/features/booking/config";
import { getPublicCatalog } from "@/server/catalog/get-catalog";

export default async function HomePage() {
  // Rendered per request: availability changes as people book, so never prerender it.
  await connection();

  const catalog = await getPublicCatalog(EVENT_SLUG);
  if (!catalog) notFound();

  const { event } = catalog;

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <header>
        <h1 className="font-serif text-4xl text-bright-gold">{event.name}</h1>
        <p className="mt-3">{event.venue}</p>
      </header>
      <BookingFlow catalog={catalog} />
    </main>
  );
}
