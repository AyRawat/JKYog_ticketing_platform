import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const heading = Fraunces({ subsets: ["latin"], variable: "--font-heading" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Sharad Utsav 2026 — Book your family's tickets",
  description: "Radha Krishna Temple, Allen, Texas · 10–14 December 2026",
};

export const viewport: Viewport = { themeColor: "#2c2c2c" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
