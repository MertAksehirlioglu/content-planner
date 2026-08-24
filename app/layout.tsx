import "@mantine/core/styles.css";
import "./globals.css";

import type { ReactNode } from "react";
import type { Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from "@mantine/core";

import { theme } from "./theme";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-mono" });

export const metadata = {
  title: "Weekly Content Planner",
  description: "A week of Instagram posts from one form.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        {/* An explicit <head> suppresses Next's automatic icon injection, so link it here. */}
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body>
        <MantineProvider defaultColorScheme="dark" theme={theme}>
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
