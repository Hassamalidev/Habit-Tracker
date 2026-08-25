import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "habit-theme";

function read(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(read);

  useEffect(() => {
    const root = document.documentElement;
    // Removing the attribute is what hands control back to prefers-color-scheme.
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);

    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* private browsing - the choice simply will not persist */
    }
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => setChoiceState(next), []);

  const cycle = useCallback(() => {
    setChoiceState((current) =>
      current === "light" ? "dark" : current === "dark" ? "system" : "light",
    );
  }, []);

  return { choice, setChoice, cycle };
}

/** Reads a resolved token off the document, for canvas/SVG code that needs a real colour. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
