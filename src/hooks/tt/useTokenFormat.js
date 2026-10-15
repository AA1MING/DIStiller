import { useContext } from "react";
import { TokenFormatContext } from "../../components/tt/ui/foundation/TokenFormatProvider.jsx";
import {
  TOKEN_FORMAT_MODES,
  formatTokenCount,
  formatTokenTooltip,
} from "../../lib/tt/token-format.js";

const FALLBACK_VALUE = Object.freeze({
  mode: TOKEN_FORMAT_MODES.COMPACT,
  setMode: () => {},
  formatTokens: (value, options = {}) => formatTokenCount(value, options),
  formatTokensTooltip: (value, options = {}) => formatTokenTooltip(value, options),
});

export function useTokenFormat() {
  return useContext(TokenFormatContext) ?? FALLBACK_VALUE;
}
