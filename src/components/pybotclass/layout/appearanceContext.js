import { createContext, useContext } from "react";

export const AppearanceContext = createContext(null);

export function useAppearanceContext() {
  return useContext(AppearanceContext);
}
