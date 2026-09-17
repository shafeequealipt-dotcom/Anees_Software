import { addDays, financialYear, monthRange, todayIST } from "./dates";

export function periodPresets(today = todayIST()) {
  const month = monthRange(today);
  const lastMonth = monthRange(addDays(month.from, -1));
  const fy = financialYear(today);
  const lastFy = financialYear(addDays(fy.from, -1));
  const [y, m] = today.split("-").map(Number);
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const qFrom = `${y}-${String(qStartMonth).padStart(2, "0")}-01`;
  const qTo = monthRange(`${y}-${String(qStartMonth + 2).padStart(2, "0")}-01`).to;
  return [
    { key: "today", label: "Today", from: today, to: today },
    { key: "7d", label: "Last 7 days", from: addDays(today, -6), to: today },
    { key: "month", label: "This month", from: month.from, to: month.to },
    { key: "lastmonth", label: "Last month", from: lastMonth.from, to: lastMonth.to },
    { key: "quarter", label: "This quarter", from: qFrom, to: qTo },
    { key: "fy", label: `This year (${fy.label})`, from: fy.from, to: fy.to },
    { key: "lastfy", label: `Last year (${lastFy.label})`, from: lastFy.from, to: lastFy.to },
  ];
}

export function resolvePeriod(sp: { from?: string; to?: string }, defaultKey = "month") {
  const presets = periodPresets();
  const def = presets.find((p) => p.key === defaultKey)!;
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return { presets, from: valid(sp.from) ? sp.from! : def.from, to: valid(sp.to) ? sp.to! : def.to };
}
