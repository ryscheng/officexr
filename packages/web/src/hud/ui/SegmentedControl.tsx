import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { SEGMENT_GROUP, SEGMENT_ITEM } from './segmentStyles';

/** Single-select; Radix reports an empty string when the selected item is clicked again, which is ignored. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onValueChange,
  'aria-label': ariaLabel,
  fill = false,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
  'aria-label': string;
  fill?: boolean;
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
      className={`${fill ? 'flex w-full' : 'inline-flex'} gap-1 pointer-coarse:gap-2 ${SEGMENT_GROUP}`}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={fill ? `${SEGMENT_ITEM} min-h-12 flex-1 text-base` : SEGMENT_ITEM}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
