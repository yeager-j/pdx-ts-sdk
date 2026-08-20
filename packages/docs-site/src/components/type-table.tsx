"use client";

import { useTranslations } from "@fuma-translate/react";
import { cva } from "class-variance-authority";
import Link from "fumadocs-core/link";
import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

export interface ParameterNode {
  name: string;
  description: ReactNode;
}

export interface TypeNode {
  /**
   * Additional description of the field
   */
  description?: ReactNode;

  /**
   * Local extension: the game's own key for this member, shown as its own
   * column.
   */
  gameKey?: ReactNode;

  /**
   * Local extension: a short label shown in the row's own line, beside the
   * name. The type column is hidden on a narrow container, so a fact that
   * must be readable at every width — an effect's category — belongs here
   * rather than folded into `type`.
   */
  badge?: ReactNode;

  /**
   * type signature (short)
   */
  type: ReactNode;

  /**
   * type signature (full)
   */
  typeDescription?: ReactNode;

  /**
   * Local extension: the scopes a script method is available on, shown as a
   * detail row when set.
   */
  availability?: ReactNode;

  /**
   * Local extension: for an event-fire method, the scope the fired event's
   * body runs in — a different fact from where the call is legal, so it gets
   * its own detail row.
   */
  eventBodyScope?: ReactNode;

  /**
   * Optional `href` for the type
   */
  typeDescriptionLink?: string;

  default?: ReactNode;

  required?: boolean;
  deprecated?: boolean;

  /**
   * a list of parameters info if the type is a function.
   */
  parameters?: ParameterNode[];

  returns?: ReactNode;
}

const fieldVariants = cva("text-fd-muted-foreground not-prose pe-2");

/**
 * Local extension: the card, border, and column headings without the rows.
 * A caller that chooses its own rows — the effects index, which filters and
 * paginates them — renders `TypeTableItem` children inside this instead of
 * handing over a whole `type` record.
 */
export function TypeTableFrame({
  id,
  className,
  nameHeader,
  typeHeader,
  children,
  ...props
}: {
  /** Local extension: header label for the name column (default "Prop"). */
  nameHeader?: ReactNode;
  /** Local extension: header label for the type column (default "Type"). */
  typeHeader?: ReactNode;
} & ComponentProps<"div">) {
  const t = useTranslations({ note: "type table" });

  return (
    <div
      id={id}
      className={cn(
        "@container flex flex-col p-1 bg-fd-card text-fd-card-foreground rounded-2xl border my-6 text-sm overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="flex font-medium items-center px-3 py-1 not-prose text-fd-muted-foreground">
        <p className="w-1/3">{nameHeader ?? t("Prop")}</p>
        <p className="@max-xl:hidden">{typeHeader ?? t("Type")}</p>
      </div>
      {children}
    </div>
  );
}

export function TypeTable({
  id,
  type,
  ...props
}: {
  type: Record<string, TypeNode>;
  nameHeader?: ReactNode;
  typeHeader?: ReactNode;
} & ComponentProps<"div">) {
  return (
    <TypeTableFrame id={id} {...props}>
      {Object.entries(type).map(([key, value]) => (
        <TypeTableItem key={key} parentId={id} name={key} item={value} hasKeyColumn />
      ))}
    </TypeTableFrame>
  );
}

export function TypeTableItem({
  parentId,
  name,
  hasKeyColumn = false,
  item: {
    parameters = [],
    description,
    gameKey,
    availability,
    eventBodyScope,
    badge,
    required = false,
    deprecated,
    typeDescription,
    default: defaultValue,
    type,
    typeDescriptionLink,
    returns,
  },
}: {
  parentId?: string;
  name: string;
  hasKeyColumn?: boolean;
  item: TypeNode;
}) {
  const t = useTranslations({ note: "type table" });
  const [open, setOpen] = useState(false);
  const id = parentId ? `${parentId}-${name}` : undefined;

  /**
   * Local extension: the upstream component reads the hash once, on mount, so
   * a row already on screen stayed shut when a later link named it. The
   * effects index links rows to each other and pages between them, so the row
   * follows the hash for as long as it lives. `replaceState` on open does not
   * raise `hashchange`, so opening a row cannot re-enter this.
   */
  useEffect(() => {
    if (!id) return;
    const openIfNamed = (): void => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    openIfNamed();
    window.addEventListener("hashchange", openIfNamed);
    return () => window.removeEventListener("hashchange", openIfNamed);
  }, [id]);

  return (
    <Collapsible
      id={id}
      open={open}
      onOpenChange={(v) => {
        if (v && id) {
          window.history.replaceState(null, "", `#${id}`);
        }
        setOpen(v);
      }}
      className={cn(
        "rounded-xl border overflow-hidden scroll-m-20 transition-all",
        open ? "shadow-sm bg-fd-background not-last:mb-2" : "border-transparent"
      )}
    >
      <CollapsibleTrigger
        className={cn(
          "relative flex flex-row items-center w-full group text-start px-3 py-2 not-prose hover:bg-fd-accent",
          // The name column refuses to shrink, so on a narrow container a long
          // name would push the badge under the chevron. Wrapping drops the
          // badge to its own line instead of truncating either one. Rows
          // without a badge keep the original single-line class list.
          badge && "flex-wrap"
        )}
      >
        <code
          className={cn(
            "text-fd-primary min-w-fit w-1/3 font-mono font-medium pe-2",
            deprecated && "line-through text-fd-primary/50"
          )}
        >
          {name}
          {!required && "?"}
        </code>
        {/*
          The badge sits beside the name rather than at the end of the row:
          the chevron is absolutely positioned against the row's end, and the
          type column that would otherwise reserve room for it disappears on a
          narrow container. A row without a badge renders exactly as before.
        */}
        {badge && <span className="text-fd-muted-foreground text-xs pe-2 shrink-0">{badge}</span>}
        {typeDescriptionLink ? (
          <Link
            href={typeDescriptionLink}
            className="underline @max-xl:hidden min-w-0 flex-1 truncate pe-6"
          >
            {type}
          </Link>
        ) : (
          <span className="@max-xl:hidden min-w-0 flex-1 truncate pe-6">{type}</span>
        )}
        <ChevronDown className="absolute inset-e-2 size-4 text-fd-muted-foreground transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-[1fr_3fr] gap-y-4 text-sm p-3 overflow-auto fd-scroll-container border-t">
          <div className="text-sm prose col-span-full prose-no-margin empty:hidden">
            {description}
          </div>
          {hasKeyColumn && (
            <>
              <p className={cn(fieldVariants())}>{t("Game Key")}</p>
              <p className="my-auto not-prose">
                {gameKey ?? <em className="text-fd-muted-foreground">none</em>}
              </p>
            </>
          )}
          {typeDescription && (
            <>
              <p className={cn(fieldVariants())}>{t("Type")}</p>
              <p className="my-auto not-prose">{typeDescription}</p>
            </>
          )}
          {availability && (
            <>
              <p className={cn(fieldVariants())}>{t("Availability")}</p>
              <p className="my-auto not-prose">{availability}</p>
            </>
          )}
          {eventBodyScope && (
            <>
              <p className={cn(fieldVariants())}>{t("Event body scope")}</p>
              <p className="my-auto not-prose">{eventBodyScope}</p>
            </>
          )}
          {defaultValue && (
            <>
              <p className={cn(fieldVariants())}>{t("Default")}</p>
              <p className="my-auto not-prose">{defaultValue}</p>
            </>
          )}
          {parameters.length > 0 && (
            <>
              <p className={cn(fieldVariants())}>{t("Parameters")}</p>
              <div className="flex flex-col gap-2">
                {parameters.map((param) => (
                  <div key={param.name} className="inline-flex items-center flex-wrap gap-1">
                    <p className="font-medium not-prose text-nowrap">{param.name} -</p>
                    <div className="text-sm prose prose-no-margin">{param.description}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {returns && (
            <>
              <p className={cn(fieldVariants())}>{t("Returns")}</p>
              <div className="my-auto text-sm prose prose-no-margin">{returns}</div>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
