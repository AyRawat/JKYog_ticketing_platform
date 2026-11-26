import { BookingId } from "@ticketing/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReceiptView } from "@/features/receipt/receipt-view";
import { loadBookingView } from "@/server/bookings/booking-view";
import { releaseExpiredHolds } from "@/server/bookings/release-holds";
import { getPublicCatalog } from "@/server/catalog/get-catalog";
import { getDb } from "@/server/db";

// A private link: anyone with it can see the booking, so search engines must not list it.
export const metadata: Metadata = {
  title: "Your booking · Sharad Utsav 2026",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

interface PageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BookingPage({ params, searchParams }: PageProps) {
  // Always fresh: the status changes when the payment is confirmed.
  await connection();
  const { id } = await params;
  if (!BookingId.safeParse(id).success) notFound();

  const db = getDb();
  await releaseExpiredHolds(db, { now: new Date(), bookingId: id });
  const booking = await loadBookingView(db, id);
  if (!booking) notFound();

  const catalog = await getPublicCatalog(booking.event.slug);
  const { redirect_status: redirectStatus } = await searchParams;

  return (
    <main className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6 print:pt-0">
      <p className="text-sm font-medium tracking-widest text-bright-gold uppercase print:text-black">
        {booking.event.name}
      </p>
      <div className="mt-4">
        <ReceiptView
          initial={booking}
          venue={catalog?.event.venue ?? ""}
          paymentFailed={redirectStatus === "failed"}
        />
      </div>
    </main>
  );
}
