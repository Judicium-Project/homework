import type { ReactElement } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import css from "./ui.module.css";

interface Props {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement<Record<string, unknown>>;
}

/** İpucu (§6.7): yalnız tamamlayıcı bilgi. Üzerine gelince 200 ms gecikmeli, odakta anında. */
export function Tooltip({ label, side = "top", children }: Props) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          {children}
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={4}
            collisionPadding={8}
            className={css.tooltip}
          >
            {label}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
