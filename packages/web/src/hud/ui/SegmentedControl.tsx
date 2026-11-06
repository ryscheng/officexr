import * as ToggleGroup from '@radix-ui/react-toggle-group';

/** Single-select; Radix reports an empty string when the selected item is clicked again, which is ignored. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onValueChange,
  'aria-label': ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
  'aria-label': string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) {
          onValueChange(next as T);
        }
      }}
      aria-label={ariaLabel}
      className="inline-flex gap-1 rounded-hud-control bg-hud-inset p-1"
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className="rounded-hud-control px-3 py-1.5 font-hud-body text-sm font-bold text-hud-text-2 data-[state=on]:bg-hud-accent data-[state=on]:text-hud-on-accent pointer-coarse:min-h-11"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
