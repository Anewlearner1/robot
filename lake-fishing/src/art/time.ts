export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

/** Local time of day: dawn 5-7, day 7-17, dusk 17-19, night otherwise. */
export function getTimeOfDay(date: Date): TimeOfDay {
  const h = date.getHours();
  if (h >= 5 && h < 7) return "dawn";
  if (h >= 7 && h < 17) return "day";
  if (h >= 17 && h < 19) return "dusk";
  return "night";
}
