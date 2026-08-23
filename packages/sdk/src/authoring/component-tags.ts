/** Capability-owned component-tag declarations. */

import type { TypedRef } from "../script/scalar.ts";

const componentTagOwner: unique symbol = Symbol("component tag capability owner");

/** An immutable component tag declared by one mod capability. */
export interface ComponentTagItem<
  P extends string = string,
  Name extends string = string,
> extends TypedRef<"component_tag"> {
  readonly itemKind: "component-tag";
  /** The complete tag id written to `common/component_tags`. */
  readonly id: `${P}_${Name}`;
  readonly [componentTagOwner]: object;
}

/** Creates one capability-owned component tag after the capability validates its logical name. */
export function createComponentTagItem<P extends string, Name extends string>(
  owner: object,
  prefix: P,
  name: Name
): ComponentTagItem<P, Name> {
  return Object.freeze({
    itemKind: "component-tag" as const,
    id: `${prefix}_${name}` as `${P}_${Name}`,
    [componentTagOwner]: owner,
  });
}

/** Refuses a component tag minted by another capability. */
export function assertComponentTagOwner(
  item: ComponentTagItem,
  owner: object,
  prefix: string
): void {
  if (item[componentTagOwner] === owner) {
    return;
  }
  throw new Error(
    `Component tag "${item.id}" was minted by a different capability, not the one for mod prefix "${prefix}"`
  );
}
