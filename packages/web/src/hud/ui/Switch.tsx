import type { ComponentProps } from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';

/** macOS switch: a grey track that turns accent blue, with a white thumb that slides across. */
export function Switch({ className = '', ...props }: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={`inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-hud-track p-0.5 transition-colors data-[state=checked]:bg-hud-accent pointer-coarse:h-12 pointer-coarse:w-[4.5rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hud-accent ${className}`}
      {...props}
    >
      <RadixSwitch.Thumb className="block h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform data-[state=checked]:translate-x-4 pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:data-[state=checked]:translate-x-7" />
    </RadixSwitch.Root>
  );
}
