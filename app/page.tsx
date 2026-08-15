import { redirect } from "next/navigation";

/**
 * Phase 1: land on run history (the signed-in home).
 * Phase 2 replaces this with the auth gate (sign-in screen for guests).
 */
export default function Home() {
  redirect("/runs");
}
