// Pure booking rules: age banding, ticket composition, extras, stock, pricing and promo codes.
// No I/O and no framework imports, so every rule is unit-tested in isolation.

export { quoteCart, type Quote } from "./quote";
export { catalogAvailability, type Availability, type CatalogAvailability } from "./availability";
export {
  ageBand,
  bandAgeRange,
  isValidAge,
  MAX_AGE_YEARS,
  type AgeBand,
  type TicketedBand,
} from "./age";
export { unitsToAdmit } from "./composition";
export { checkAttendeeContacts } from "./contacts";
export { formatDay, formatDayList, localDate, type IsoDate } from "./dates";
export { ISSUE_CODES, type Issue, type IssueCode } from "./issues";
export { formatCents, percentOfCents, type Cents } from "./money";
export { NOTICE_CODES, type Notice, type NoticeCode } from "./notices";
export { PROMO_REJECTIONS, type PromoRejection, type PromoResult } from "./promo";
export { unitsByProduct } from "./stock";
export type * from "./types";
