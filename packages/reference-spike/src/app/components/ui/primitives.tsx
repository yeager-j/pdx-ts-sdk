/**
 * The four shadcn/ui primitives this page uses, and nothing else.
 *
 * Kept in one file on purpose. The spike is disposable, and a
 * `components/ui/` tree with one export per file is the beginning of a design
 * system — which the design explicitly rules out until a production app needs
 * one. These are the shadcn shapes (cva variants, `cn`, `data-slot`) so the
 * page looks like the real thing, without pulling in Radix for widgets that
 * `<details>` and a `<button>` already cover.
 */

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("bg-card text-foreground rounded-xl border border-border shadow-xs", className)}
      {...props}
    />
  );
}

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground",
        contract: "border-contract/30 bg-contract-soft text-contract",
        observed: "border-observed/30 bg-observed-soft text-observed",
        curated: "border-curated/30 bg-curated-soft text-curated",
        omission: "border-omission/30 bg-omission-soft text-omission",
        unresolved: "border-unresolved/30 bg-unresolved-soft text-unresolved",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-xs",
        "placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  );
}

const toggleVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  {
    variants: {
      active: {
        true: "border-foreground/30 bg-foreground text-background",
        false: "border-border bg-background text-muted-foreground hover:bg-accent",
      },
    },
    defaultVariants: { active: false },
  }
);

export function Toggle({
  className,
  active,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof toggleVariants>) {
  return (
    <button
      type="button"
      data-slot="toggle"
      aria-pressed={active === true}
      className={cn(toggleVariants({ active }), className)}
      {...props}
    />
  );
}
