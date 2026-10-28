import { createContext, useContext } from "react";

/**
 * Opens the earlier form answers of the work being done, over the form being
 * filled. Null when there are no earlier answers or no page offers them.
 */
export const FmsEarlierAnswersContext = createContext<(() => void) | null>(null);

export const useFmsEarlierAnswers = () => useContext(FmsEarlierAnswersContext);
