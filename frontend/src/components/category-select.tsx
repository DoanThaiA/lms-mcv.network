"use client";

import { Select } from "@/components/ui/form";
import { useCategories } from "@/lib/hooks";

/** Chọn danh mục; value null = không danh mục. */
export function CategorySelect({
  id,
  value,
  onChange,
  emptyLabel = "— Không danh mục —",
  className,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  emptyLabel?: string;
  className?: string;
}) {
  const { categories } = useCategories();
  return (
    <Select
      id={id}
      className={className}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{emptyLabel}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}
