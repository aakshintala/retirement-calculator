export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function fmtCurrency(v) {
  if (!Number.isFinite(v)) return "0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  let scaled = abs;
  let suffix = "";
  if (abs >= 1e9) {
    scaled = abs / 1e9;
    suffix = "B";
  } else if (abs >= 1e6) {
    scaled = abs / 1e6;
    suffix = "M";
  } else if (abs >= 1e3) {
    scaled = abs / 1e3;
    suffix = "k";
  }
  return sign + scaled.toFixed(2) + suffix;
}

export function fmtFullCurrency(v) {
  if (!Number.isFinite(v)) {
    return "$0";
  }
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

export function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = (sortedArr.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedArr[lower];
  const w = idx - lower;
  return sortedArr[lower] * (1 - w) + sortedArr[upper] * w;
}

export function parseCurrencyValue(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const raw = value.toString().replace(/,/g, "").trim();
  if (raw === "") return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}
