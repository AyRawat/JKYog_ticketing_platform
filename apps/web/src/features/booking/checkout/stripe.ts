import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

/** Stripe.js, loaded once, only when a payment form is first shown. Null if not configured. */
export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

/** Stripe's card form in the festival's colours, with the same contrast rules as the page. */
export const stripeAppearance: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#d1ac3e",
    colorBackground: "#363636",
    colorText: "#ffffff",
    colorTextSecondary: "rgba(255, 255, 255, 0.7)",
    colorDanger: "#ff8a8a",
    borderRadius: "8px",
    fontSizeBase: "16px",
  },
  rules: {
    ".Input": { border: "1px solid rgba(255, 255, 255, 0.2)" },
    ".Input:focus": {
      borderColor: "#d1ac3e",
      boxShadow: "0 0 0 2px rgba(209, 172, 62, 0.45)",
    },
    ".Tab--selected": { borderColor: "#c99b24" },
  },
};
