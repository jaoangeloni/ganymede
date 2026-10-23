import { Icon } from "../../components/Icon";
import { Menu } from "../../components/Menu";
import { FILTERS, type FilterGroup, type Filters } from "./pipeline/bing";

interface Props {
  filters: Filters;
  onChange(filters: Filters): void;
}

export function SearchFilters({ filters, onChange }: Props) {
  const active = Object.values(filters).filter(Boolean).length;
  const pick = (group: FilterGroup, value: string) =>
    onChange({ ...filters, [group]: filters[group] === value ? undefined : value });

  return (
    <span className="relative grid shrink-0 place-items-center">
      <Menu label={active ? `Filters (${active})` : "Filters"} icon="sliders">
        <div className="w-[21rem] px-2.5 pt-1.5 pb-1">
          <div className="flex h-8 items-center justify-between">
            <p className="text-[13px] font-medium">Filters</p>
            {active > 0 && (
              <button
                type="button"
                onClick={() => onChange({})}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-skeleton hover:text-fg"
              >
                <Icon name="close" size={11} />
                Clear
              </button>
            )}
          </div>
          {FILTERS.map(({ group, label, options }) => {
            const swatches = options.filter((option) => option.swatch);
            return (
              <div key={group} role="group" aria-label={label} className="border-t border-line py-2.5">
                <p className="mb-2 text-xs text-muted">{label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {options
                    .filter((option) => !option.swatch)
                    .map((option) => {
                      const on = filters[group] === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => pick(group, option.value)}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-[background-color,border-color,color,scale] duration-150 active:scale-95 ${
                            on ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-fg/30 hover:text-fg"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                </div>
                {swatches.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 px-0.5">
                    {swatches.map((option) => {
                      const on = filters[group] === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={on}
                          aria-label={option.label}
                          title={option.label}
                          onClick={() => pick(group, option.value)}
                          className={`size-5 rounded-full transition-[scale,box-shadow] duration-150 ease-spring hover:scale-110 active:scale-95 ${
                            on ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : "ring-1 ring-fg/15 ring-inset"
                          }`}
                          style={{ background: option.swatch }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Menu>
      {active > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary-ink"
        />
      )}
    </span>
  );
}
