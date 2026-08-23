/** Capability-owned component-tag declarations. */

import type { TypedRef } from "../script/scalar.ts";

const componentTagOwners = new WeakMap<ComponentTagItem, object>();

/** An immutable component tag declared by one mod capability. */
export interface ComponentTagItem<
  P extends string = string,
  Name extends string = string,
> extends TypedRef<"component_tag"> {
  /** Identifies this value as a component-tag declaration. */
  readonly itemKind: "component-tag";
  /** The complete tag id written to `common/component_tags`. */
  readonly id: `${P}_${Name}`;
}

/** Creates one capability-owned component tag after the capability validates its logical name. */
export function createComponentTagItem<P extends string, Name extends string>(
  owner: object,
  prefix: P,
  name: Name
): ComponentTagItem<P, Name> {
  const item: ComponentTagItem<P, Name> = Object.freeze({
    itemKind: "component-tag" as const,
    id: `${prefix}_${name}` as `${P}_${Name}`,
  });
  componentTagOwners.set(item, owner);
  return item;
}

/** Refuses a component tag minted by another capability. */
export function assertComponentTagOwner(
  item: ComponentTagItem,
  owner: object,
  prefix: string
): void {
  if (componentTagOwners.get(item) === owner) {
    return;
  }
  throw new Error(
    `Component tag "${item.id}" was minted by a different capability, not the one for mod prefix "${prefix}"`
  );
}
