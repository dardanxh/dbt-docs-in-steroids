import { createContext, type ReactNode, useContext, useState } from "react";

// Lets a view (LineageView) render contextual controls INTO the right sidebar
// via a portal, while keeping the controls' state local to that view.
interface SlotCtx {
  target: HTMLElement | null;
  register: (el: HTMLElement | null) => void;
}

const Ctx = createContext<SlotCtx>({ target: null, register: () => {} });

export function SidebarSlotProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return <Ctx.Provider value={{ target, register: setTarget }}>{children}</Ctx.Provider>;
}

export const useSidebarSlot = () => useContext(Ctx);
