import { useMemo } from "react";
import { useAppTheme } from "@/theme/ThemeProvider";
import type { Theme } from "@/theme/theme";

/**
 * Declares a component's styles as a function of the theme.
 *
 * `StyleSheet.create` at module scope captures one palette forever, which is
 * why a theme toggle appears to do nothing. Wrapping the same object in this
 * helper turns it into a hook that rebuilds only when the theme actually
 * changes, so the diff against a static stylesheet stays small:
 *
 *   const useStyles = makeStyles((t) => StyleSheet.create({
 *     card: { backgroundColor: t.colors.surface },
 *   }));
 *
 *   function Card() {
 *     const styles = useStyles();
 *     ...
 *   }
 */
export function makeStyles<T extends object>(factory: (theme: Theme) => T): () => T {
  return function useStyles(): T {
    const theme = useAppTheme();
    return useMemo(() => factory(theme), [theme]);
  };
}
