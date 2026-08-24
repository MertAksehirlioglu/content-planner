import { createTheme, type MantineColorsTuple } from "@mantine/core";

// "Editorial desk at night": a warm ink surface with a semantic duotone —
// iris drives planning/interactive states, amber marks finished creative.

const iris: MantineColorsTuple = [
  "#f0f1ff", "#dbddfa", "#b2b6f0", "#888ee8", "#656ce1",
  "#4f57dd", "#434cd9", "#343dc2", "#2c34ad", "#222a97",
];

// Warmer, bluer ink than Mantine's neutral dark scale. dark[7] is the body,
// dark[6] the lifted card surface, dark[4] the hairline borders.
const ink: MantineColorsTuple = [
  "#C4C9E0", "#AEB4CE", "#9096B2", "#666E92", "#3C4260",
  "#2C3248", "#1B1F30", "#151826", "#101321", "#0B0D15",
];

export const theme = createTheme({
  primaryColor: "iris",
  primaryShade: { light: 6, dark: 5 },
  colors: { iris, dark: ink },
  fontFamily: "var(--font-body), system-ui, sans-serif",
  fontFamilyMonospace: "var(--font-mono), ui-monospace, monospace",
  headings: {
    fontFamily: "var(--font-display), var(--font-body), sans-serif",
    fontWeight: "600",
  },
  defaultRadius: "md",
});
