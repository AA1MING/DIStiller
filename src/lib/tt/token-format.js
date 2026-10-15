import { formatCompactNumber, toDisplayNumber } from "./format.ts";

export const TOKEN_FORMAT_MODES = Object.freeze({
  COMPACT: "compact",
  FULL: "full",
});

export const TOKEN_FORMAT_STORAGE_KEY = "tt.tokenFormat";

export function normalizeTokenFormatMode(value) {
  return value === TOKEN_FORMAT_MODES.FULL
    ? TOKEN_FORMAT_MODES.FULL
    : TOKEN_FORMAT_MODES.COMPACT;
}

export function readTokenFormatMode() {
  if (typeof window === "undefined") return TOKEN_FORMAT_MODES.COMPACT;
  try {
    return normalizeTokenFormatMode(window.localStorage?.getItem(TOKEN_FORMAT_STORAGE_KEY));
  } catch (_error) {
    return TOKEN_FORMAT_MODES.COMPACT;
  }
}

export function persistTokenFormatMode(value) {
  const mode = normalizeTokenFormatMode(value);
  if (typeof window === "undefined") return mode;
  try {
    window.localStorage?.setItem(TOKEN_FORMAT_STORAGE_KEY, mode);
  } catch (_error) {
    // localStorage can be unavailable in private/locked-down browser contexts.
  }
  return mode;
}

export function formatTokenCount(
  value,
  {
    mode = TOKEN_FORMAT_MODES.COMPACT,
    forceFull = false,
    decimals = 1,
    thousandSuffix = "K",
    millionSuffix = "M",
    billionSuffix = "B",
  } = {},
) {
  if (forceFull || normalizeTokenFormatMode(mode) === TOKEN_FORMAT_MODES.FULL) {
    return toDisplayNumber(value);
  }
  return formatCompactNumber(value, {
    decimals,
    thousandSuffix,
    millionSuffix,
    billionSuffix,
  });
}

export function formatTokenTooltip(value, options = {}) {
  const full = toDisplayNumber(value);
  const display = formatTokenCount(value, options);
  if (display === full || display === "-" || full === "-") return full;
  return `${display} · ${full}`;
}
