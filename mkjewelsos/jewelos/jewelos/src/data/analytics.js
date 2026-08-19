/* Chart data. In production these come from PerformanceMetric rows or a live
   aggregation in analyticsEngine. Amounts are in thousands of rupees. */

export const WEEKLY_SALES = [
  { day: "Mon", bandra: 640, andheri: 410, target: 900 },
  { day: "Tue", bandra: 520, andheri: 380, target: 900 },
  { day: "Wed", bandra: 780, andheri: 520, target: 900 },
  { day: "Thu", bandra: 910, andheri: 460, target: 900 },
  { day: "Fri", bandra: 1240, andheri: 690, target: 900 },
  { day: "Sat", bandra: 1680, andheri: 1120, target: 1400 },
  { day: "Sun", bandra: 1420, andheri: 980, target: 1400 },
];

export const CONVERSION_TREND = [
  { week: "W1", rate: 22 }, { week: "W2", rate: 26 }, { week: "W3", rate: 24 },
  { week: "W4", rate: 31 }, { week: "W5", rate: 29 }, { week: "W6", rate: 35 },
];

export const CATEGORY_MIX = [
  { name: "Diamond", value: 42, fill: "#0ea5e9" },
  { name: "Plain gold", value: 27, fill: "#f59e0b" },
  { name: "Polki", value: 18, fill: "#8b5cf6" },
  { name: "Silver", value: 8, fill: "#10b981" },
  { name: "Platinum", value: 5, fill: "#f43f5e" },
];
