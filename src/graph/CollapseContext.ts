import { createContext, useContext } from 'react';

export interface CollapseApi {
  collapsed: Set<string>;
  toggle: (id: string) => void;
}

export const CollapseContext = createContext<CollapseApi>({
  collapsed: new Set(),
  toggle: () => {},
});

export const useCollapse = () => useContext(CollapseContext);
