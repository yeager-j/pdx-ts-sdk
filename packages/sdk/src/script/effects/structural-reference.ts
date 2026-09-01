/**
 * Handwritten display metadata for the SDK-owned effect methods. The fixed PDXScript
 * key each method records is not repeated here: it comes from the generated
 * `STRUCTURAL_EFFECT_IDENTITY`, whose policy table is its only authority.
 */

import {
  STRUCTURAL_EFFECT_IDENTITY,
  type StructuralEffectMethod,
} from "../../generated/effect-policy.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { StructuralEffects } from "./types.ts";

type StructuralAvailability =
  | { readonly kind: "universal" }
  | { readonly kind: "scopes"; readonly scopes: readonly ScopeName[] };

interface StructuralEffectReference {
  readonly method: StructuralEffectMethod;
  readonly kind: "structural";
  readonly availability: StructuralAvailability;
  readonly signature: string;
  readonly docs: readonly string[];
}

const referencesByMethod = {
  if: {
    method: "if",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "if(condition: Trigger<S>, body: () => void): IfChain<S>;",
    docs: [
      "In-game branching: `if = { limit = { ... } ... }`.",
      "Chain `.elseIf(...)` and `.else(...)` before recording any further effects.",
      "`.else(...)` ends the chain: a further link on it throws.",
    ],
  },
  hiddenEffect: {
    method: "hiddenEffect",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "readonly hiddenEffect: SameScopeEffectPath<S>;",
    docs: [
      "Begins a same-scope `hidden_effect = { ... }` path.",
      "Terminate it with `.effects(...)`, or continue through generated scope-link properties.",
    ],
  },
  randomList: {
    method: "randomList",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "randomList(arms: ReadonlyArray<RandomListArm<S>>): void;",
    docs: ["Picks one arm at random, weighted; modifiers adjust weights in-game."],
  },
  lockedRandomList: {
    method: "lockedRandomList",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "lockedRandomList(arms: ReadonlyArray<RandomListArm<S>>): void;",
    docs: ["`random_list` that shows only the chosen arm in tooltips."],
  },
  random: {
    method: "random",
    kind: "structural",
    availability: { kind: "universal" },
    signature:
      "random(args: { chance: number; modifiers?: readonly Modifier<S>[] }, body: () => void): void;",
    docs: ["Runs the body with the given percent chance, in-game."],
  },
  whileLoop: {
    method: "whileLoop",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "whileLoop(args: { count?: number; limit?: Trigger<S> }, body: () => void): void;",
    docs: ["`while = { count/limit ... }` — in-game iteration."],
  },
  saveEventTargetAs: {
    method: "saveEventTargetAs",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "saveEventTargetAs(target: EventTarget<S>): void;",
    docs: [
      "Saves the current scope under the target's name.",
      "The target's declared scope must match the scope being saved — reads stay safe because saves are checked.",
    ],
  },
  saveGlobalEventTargetAs: {
    method: "saveGlobalEventTargetAs",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "saveGlobalEventTargetAs(target: EventTarget<S>): void;",
    docs: ["Like `saveEventTargetAs`, but the target survives the event chain."],
  },
  addResource: {
    method: "addResource",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "addResource(args: { resource: string; amount: number; mult?: number }): void;",
    docs: ["Adds resources to the scope's stockpile: `add_resource = { energy = 50 }`."],
  },
  addEventChainCounter: {
    method: "addEventChainCounter",
    kind: "structural",
    availability: { kind: "scopes", scopes: ["country"] },
    signature:
      "addEventChainCounter<Chain extends EventChainItem>(args: DefinedCounterArgs<Chain> & { amount: ScriptValue }): void;\naddEventChainCounter(args: ExternalCounterArgs & { amount: ScriptValue }): void;",
    docs: ["Adds an amount to an event-chain counter."],
  },
  resetEventChainCounter: {
    method: "resetEventChainCounter",
    kind: "structural",
    availability: { kind: "scopes", scopes: ["country"] },
    signature:
      "resetEventChainCounter<Chain extends EventChainItem>(args: DefinedCounterArgs<Chain>): void;\nresetEventChainCounter(args: ExternalCounterArgs): void;",
    docs: ["Resets an event-chain counter."],
  },
  previewModifier: {
    method: "previewModifier",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "previewModifier(modifier: StaticModifierRef | string): void;",
    docs: [
      "Displays a static modifier in a non-executing tooltip without treating this scope as its host.",
    ],
  },
  target: {
    method: "target",
    kind: "structural",
    availability: {
      kind: "scopes",
      scopes: ["agreement", "espionage_operation", "situation", "spy_network"],
    },
    signature: "target<S2 extends ScopeName>(body: (scope: ScopeObjOf<S2>) => void): void;",
    docs: ["Opens the asserted target scope as a `target = { ... }` block."],
  },
  run: {
    method: "run",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "run(effect: ScriptedEffectCall<S>): void;",
    docs: [
      "Runs a scripted effect bound by `scriptedEffect` or imported from `@pdx-ts/stellaris-ids/effects`.",
    ],
  },
} as const satisfies Record<StructuralEffectMethod, StructuralEffectReference>;

type MissingStructuralMethod = Exclude<StructuralEffectMethod, keyof typeof referencesByMethod>;
type UnexpectedStructuralMethod = Exclude<keyof typeof referencesByMethod, StructuralEffectMethod>;
const exactStructuralMethods: [MissingStructuralMethod, UnexpectedStructuralMethod] extends [
  never,
  never,
]
  ? true
  : never = true;
void exactStructuralMethods;

type UniversalLedgerMethod = {
  [K in keyof typeof referencesByMethod]: (typeof referencesByMethod)[K]["availability"] extends {
    readonly kind: "universal";
  }
    ? K
    : never;
}[keyof typeof referencesByMethod];
type MissingStructuralBaseMethod = Exclude<
  keyof StructuralEffects<ScopeName>,
  UniversalLedgerMethod
>;
type UnexpectedStructuralBaseMethod = Exclude<
  UniversalLedgerMethod,
  keyof StructuralEffects<ScopeName>
>;
const exactStructuralBaseMethods: [
  MissingStructuralBaseMethod,
  UnexpectedStructuralBaseMethod,
] extends [never, never]
  ? true
  : never = true;
void exactStructuralBaseMethods;

type IdentityMethod = (typeof STRUCTURAL_EFFECT_IDENTITY)[number]["method"];
type MissingIdentityMethod = Exclude<StructuralEffectMethod, IdentityMethod>;
type UnexpectedIdentityMethod = Exclude<IdentityMethod, StructuralEffectMethod>;
const exactIdentityMethods: [MissingIdentityMethod, UnexpectedIdentityMethod] extends [never, never]
  ? true
  : never = true;
void exactIdentityMethods;

const fixedKeyByMethod = Object.fromEntries(
  STRUCTURAL_EFFECT_IDENTITY.map((identity) => [identity.method, identity.key])
) as Record<StructuralEffectMethod, string | null>;

/** Reference rows for every SDK-owned effect method, carrying the fixed key it records. */
export const STRUCTURAL_EFFECT_REFERENCES = Object.values(referencesByMethod).map((reference) => {
  const key = fixedKeyByMethod[reference.method];
  return key === null ? reference : { ...reference, key };
});
