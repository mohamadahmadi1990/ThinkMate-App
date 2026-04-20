import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Sentence Type MVP",
  description: "Classify a short input as a word, number, or sentence type."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
