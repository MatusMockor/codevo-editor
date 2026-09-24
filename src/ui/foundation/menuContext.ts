import { createContext, useContext } from "react";

export interface MenuContextValue {
  readonly menuId: string;
  readonly openSubmenuId: string | null;
  openSubmenu(id: string | null): void;
  closeAll(): void;
}

export const MenuContext = createContext<MenuContextValue | null>(null);

export function useMenuContext(): MenuContextValue {
  const value = useContext(MenuContext);
  if (value === null) throw new Error("Menu items must be rendered inside a Menu");
  return value;
}
