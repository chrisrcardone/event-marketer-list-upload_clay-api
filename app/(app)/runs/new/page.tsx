import type { Metadata } from "next";
import { NewRunComposer } from "./composer";

export const metadata: Metadata = { title: "New run" };

export default function NewRunPage() {
  return <NewRunComposer />;
}
