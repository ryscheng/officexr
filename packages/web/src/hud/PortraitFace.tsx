export function PortraitFace({ src, initial }: { src: string | null; initial: string }) {
  return (
    <span aria-hidden className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full">
      {src ? <img src={src} alt="" draggable={false} className="size-full object-cover" /> : initial}
    </span>
  );
}
