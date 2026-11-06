import type { ComponentProps } from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';

export function Switch({ className = '', ...props }: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-hud-edge bg-hud-inset p-0.5 data-[state=checked]:border-hud-accent-edge data-[state=checked]:bg-hud-accent pointer-coarse:h-11 pointer-coarse:w-16 ${className}`}
      {...props}
    >
      <RadixSwitch.Thumb className="block h-5 w-5 rounded-full bg-hud-text-2 transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-hud-on-accent pointer-coarse:h-8 pointer-coarse:w-8 pointer-coarse:data-[state=checked]:translate-x-6" />
    </RadixSwitch.Root>
  );
}
