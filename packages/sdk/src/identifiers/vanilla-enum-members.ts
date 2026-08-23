/** Runtime evidence for complex-enum members that can resemble owned references. */

import { VANILLA_ENUM_MEMBERS } from "@pdx-ts/stellaris-ids/enum-members";

import { immutableSet } from "../compiler/freeze.ts";

const cached = new Map<string, ReadonlySet<string>>();

/** Packaged vanilla enum members, lazily converted to immutable membership sets. */
export const PACKAGED_ENUM_EVIDENCE: ReadonlyMap<string, () => ReadonlySet<string>> = new Map(
  Object.keys(VANILLA_ENUM_MEMBERS).map((name) => [
    name,
    (): ReadonlySet<string> => {
      const memoized = cached.get(name);
      if (memoized !== undefined) {
        return memoized;
      }
      const built = immutableSet(VANILLA_ENUM_MEMBERS[name] ?? []);
      cached.set(name, built);
      return built;
    },
  ])
);
