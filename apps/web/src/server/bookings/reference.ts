import { randomInt } from "node:crypto";

/** No 0/O, 1/I/L or U: easy to read out at the door and to type. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 6;

/** "sharad-utsav-2026" -> "SU26": initials of the words, then the year's last two digits. */
export function referencePrefix(slug: string): string {
  const words = slug.split("-").filter(Boolean);
  const initials = words
    .filter((word) => !/^\d+$/.test(word))
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 4);
  const year = words.find((word) => /^\d{4}$/.test(word))?.slice(2) ?? "";
  return initials + year || "BK";
}

/** A booking reference such as "SU26-7K3QXM": random, so it reveals nothing about other bookings. */
export function newReference(slug: string): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET.charAt(randomInt(ALPHABET.length));
  return `${referencePrefix(slug)}-${code}`;
}
