import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { SiteHeader } from "./components/site-header";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin", "cyrillic"],
  weight: ["600"],
  variable: "--font-cormorant",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Verde Marea — бронирование столов", template: "%s · Verde Marea" },
  description: "Ресторан средиземноморской кухни на набережной. Бронирование столов онлайн.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${cormorant.variable} ${manrope.variable}`}>
      <body>
        <SiteHeader />
        <main className="container-vm py-8 md:py-12">{children}</main>
        <footer className="border-t border-line">
          <div className="container-vm py-6 text-small text-muted">
            Verde Marea · вторник–воскресенье, 12:00–21:00 · понедельник — выходной
          </div>
        </footer>
      </body>
    </html>
  );
}
