import { useContext } from "react";
import { LocaleContext } from "../../components/tt/ui/foundation/LocaleProvider.jsx";

export function useLocale() {
  const context = useContext(LocaleContext);
  if (context === null) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
