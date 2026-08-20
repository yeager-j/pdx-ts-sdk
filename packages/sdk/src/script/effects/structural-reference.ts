/** Handwritten display metadata for the SDK-owned effect methods. */

import type { StructuralEffectMethod } from "../../generated/effect-policy.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { StructuralEffects } from "./types.ts";

type StructuralAvailability =
  | { readonly kind: "universal" }
  | { readonly kind: "scopes"; readonly scopes: readonly ScopeName[] };

interface StructuralEffectReference {
  readonly method: StructuralEffectMethod;
  readonly key?: string;
  readonly kind: "structural";
  readonly availability: StructuralAvailability;
  readonly signature: string;
  readonly docs: readonly string[];
}

const referencesByMethod = {
  if: {
    method: "if",
    key: "if",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "if(condition: Trigger<S>, body: (scope: ScopeObjOf<S>) => void): IfChain<S>;",
    docs: [
      "In-game branching: `if = { limit = { ... } ... }`.",
      "Chain `.elseIf(...)` and `.else(...)` before recording any further effects.",
    ],
  },
  hiddenEffect: {
    method: "hiddenEffect",
    key: "hidden_effect",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "readonly hiddenEffect: EffectPathOf<S>;",
    docs: [
      "Begins a same-scope `hidden_effect = { ... }` path.",
      "Terminate it with `.effects(...)`, or continue through generated scope-link properties.",
    ],
  },
  randomList: {
    method: "randomList",
    key: "random_list",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "randomList(arms: ReadonlyArray<RandomListArm<S>>): void;",
    docs: ["Picks one arm at random, weighted; modifiers adjust weights in-game."],
  },
  lockedRandomList: {
    method: "lockedRandomList",
    key: "locked_random_list",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "lockedRandomList(arms: ReadonlyArray<RandomListArm<S>>): void;",
    docs: ["`random_list` that shows only the chosen arm in tooltips."],
  },
  random: {
    method: "random",
    key: "random",
    kind: "structural",
    availability: { kind: "universal" },
    signature:
      "random(args: { chance: number; modifiers?: readonly Modifier<S>[] }, body: (scope: ScopeObjOf<S>) => void): void;",
    docs: ["Runs the body with the given percent chance, in-game."],
  },
  whileLoop: {
    method: "whileLoop",
    key: "while",
    kind: "structural",
    availability: { kind: "universal" },
    signature:
      "whileLoop(args: { count?: number; limit?: Trigger<S> }, body: (scope: ScopeObjOf<S>) => void): void;",
    docs: ["`while = { count/limit ... }` — in-game iteration."],
  },
  saveEventTargetAs: {
    method: "saveEventTargetAs",
    key: "save_event_target_as",
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
    key: "save_global_event_target_as",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "saveGlobalEventTargetAs(target: EventTarget<S>): void;",
    docs: ["Like `saveEventTargetAs`, but the target survives the event chain."],
  },
  addResource: {
    method: "addResource",
    key: "add_resource",
    kind: "structural",
    availability: { kind: "universal" },
    signature: "addResource(args: { resource: string; amount: number; mult?: number }): void;",
    docs: ["Adds resources to the scope's stockpile: `add_resource = { energy = 50 }`."],
  },
  addEventChainCounter: {
    method: "addEventChainCounter",
    key: "add_event_chain_counter",
    kind: "structural",
    availability: { kind: "scopes", scopes: ["country"] },
    signature:
      "addEventChainCounter<Chain extends EventChainItem>(args: DefinedCounterArgs<Chain> & { amount: ScriptValue }): void;\naddEventChainCounter(args: ExternalCounterArgs & { amount: ScriptValue }): void;",
    docs: ["Adds an amount to an event-chain counter."],
  },
  resetEventChainCounter: {
    method: "resetEventChainCounter",
    key: "reset_event_chain_counter",
    kind: "structural",
    availability: { kind: "scopes", scopes: ["country"] },
    signature:
      "resetEventChainCounter<Chain extends EventChainItem>(args: DefinedCounterArgs<Chain>): void;\nresetEventChainCounter(args: ExternalCounterArgs): void;",
    docs: ["Resets an event-chain counter."],
  },
  target: {
    method: "target",
    key: "target",
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

export const STRUCTURAL_EFFECT_REFERENCES = Object.values(referencesByMethod);
