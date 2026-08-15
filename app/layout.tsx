import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Event Lead Router",
    template: "%s · Event Lead Router",
  },
  description:
    "A demo of a Clay-powered workflow: badge scans in, enriched and deduped leads in a Salesforce campaign — with a number you can stand behind.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-oat-100 font-body text-[16px] text-oat-500 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
