import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata: Metadata = {
  title: "Component gallery",
  robots: { index: false, follow: false },
};

/**
 * Development-only component gallery: every primitive in every state,
 * visually matched against design/prototype/Event Lead Router.dc.html.
 * Excluded from production builds (404) unless explicitly re-enabled with
 * NEXT_PUBLIC_ENABLE_DEV_GALLERY=true.
 */
export default function ComponentsPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_ENABLE_DEV_GALLERY !== "true"
  ) {
    notFound();
  }
  return <Gallery />;
}
