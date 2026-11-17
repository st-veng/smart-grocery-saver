import { useId } from 'react';

/** Radio-group segmented control (keyboard: arrow keys, like any radio group). */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex w-fit rounded-full border border-slate-300 p-0.5 dark:border-slate-700">
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className="flex min-h-10 cursor-pointer items-center rounded-full px-3 text-sm has-[:checked]:bg-slate-900 has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-700 dark:has-[:checked]:bg-slate-100 dark:has-[:checked]:text-slate-900"
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            className="sr-only"
            checked={value === o.value}
            onChange={() => {
              onChange(o.value);
            }}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}
