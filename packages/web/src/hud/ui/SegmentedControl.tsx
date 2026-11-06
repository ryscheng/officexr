import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { SEGMENT_GROUP, SEGMENT_ITEM } from './segmentStyles';

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
      className={`inline-flex gap-1 ${SEGMENT_GROUP}`}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={SEGMENT_ITEM}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
