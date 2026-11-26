import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-serif text-4xl text-white">We couldn't find that page</h1>
      <p className="mt-3 text-white/75">
        If you followed a booking link, check it was copied in full. Booking links are private and
        long on purpose.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-12 items-center rounded-xl bg-primary px-6 font-semibold text-heading hover:bg-bright-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright-gold"
      >
        Go to booking
      </Link>
    </main>
  );
}
