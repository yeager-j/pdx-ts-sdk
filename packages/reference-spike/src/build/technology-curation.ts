/**
 * The Technology page's derived claims.
 *
 * Same rule as the Situation page's: every sentence below is assembled from
 * what the probe read, and none of it is a fact somebody typed. Where a claim
 * looks like an opinion — that the shipped game contradicts the rules about
 * `prereqfor_desc`, that a non-start technology's cost is unchecked — the
 * opinion is in the *selection*, and the numbers, cardinalities, scopes and
 * shapes in the sentence come from the model. Fix the surface and the sentence
 * changes or the claim stops being built, which is what stops this page from
 * outliving what it describes.
 *
 * Two things a Technology page needs that a Situation page did not, both of
 * them derived rather than declared:
 *
 * - **Arity departures.** Twice on this registry the surface disagrees with the
 *   rules about how many times a key may be written — once widening because the
 *   shipped game contradicts the declaration, once narrowing because it does
 *   not. Both fall out of comparing a declared arm's cardinality against the
 *   lowered member's repetition, so neither is asserted.
 * - **The patch surface.** A `patchX` exists only where somebody verified what
 *   the game does with two files defining one key, and the emitter carries the
 *   consequences — which slots a patch may rewrite, which inputs it admits that
 *   a definition does not. An empty list is the honest signal that a registry
 *   has no patch surface, so "technology is patchable" is a projection.
 *
 * Authored prose is not here. It is in `content/technology.mdx`.
 */

import type { ReferenceClaim } from "../claims.ts";
import type { RegistryFacts } from "../facts.ts";
import type { RegistryEvidence } from "./corpus-evidence.ts";
import { derivations } from "./derive.ts";
import { isRequired } from "./fingerprints.ts";
import type { ReferencePage } from "./pages.ts";

const OVERLAY = "packages/codegen-cwt/src/overlay.ts";

/** `a`, `a and b`, `a, b and c` — a list in a sentence rather than in a table. */
function english(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "nothing";
  }
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)!}`;
}

function code(items: readonly string[]): string {
  return english(items.map((item) => `\`${item}\``));
}

/**
 * Keys the rules demand of every definition, whatever subtype it is in.
 *
 * The subtype filter is the part that matters. `cost_per_level` is declared
 * with a cardinality of exactly one and is still not a floor, because it is
 * only declared for repeatable technologies — and the surface cannot tell which
 * those are. A required-fields claim that skipped the filter would tell a
 * reader their first technology needs a per-level cost.
 */
function requiredOfEveryDefinition(facts: RegistryFacts): string[] {
  return facts.lowered
    .filter((member) => member.level === "top")
    .filter((member) => isRequired(facts, member.key))
    .filter(
      (member) =>
        !facts.subtypes.some(
          (subtype) =>
            subtype.gatedKeys.includes(member.key) || subtype.excludedKeys.includes(member.key)
        )
    )
    .map((member) => member.memberPath.join("."));
}

export function technologyClaims(
  facts: RegistryFacts,
  evidence: RegistryEvidence,
  page: ReferencePage
): ReferenceClaim[] {
  const { member, observation, share, declarationSite, scopeText } = derivations(
    facts,
    evidence,
    page
  );
  const CWT = page.cwtSource;
  const CORPUS = `packages/sdk/tests/fixtures/corpus/${facts.registry}.json`;
  const corpusProvenance = {
    kind: "corpus" as const,
    source: CORPUS,
    detail: `Stellaris ${evidence.gameVersion}, ${evidence.definitions} definitions in ${evidence.files} files`,
  };

  const cost = member("cost");
  const costArms = facts.declared.find((entry) => entry.key === "cost")?.arms ?? [];
  const start = facts.subtypes.find((entry) => entry.name === "start");
  const swap = member("technology_swap");
  const prereqDesc = member("prereqfor_desc");
  const prereqDescArm = facts.declared.find((entry) => entry.key === "prereqfor_desc")?.arms[0];
  const groupWeights = member("mod_weight_if_group_picked");
  const groupWeightsArm = facts.declared.find((entry) => entry.key === "mod_weight_if_group_picked")
    ?.arms[0];
  const categories = member("prereqfor_desc.hide_prereq_for_desc").literals ?? [];

  const claims: ReferenceClaim[] = [
    {
      id: "registry",
      subject: "mod.technology",
      status: "supported-contract",
      statement:
        `\`mod.technology(name, def)\` defines one researchable technology. The mod's prefix is ` +
        `minted into its id, and the definition is written to \`${facts.definitionPath.replace(
          /^game\//,
          ""
        )}/<feature>.txt\`.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: `${CWT} — type[${facts.registry}]`,
          detail: `path = "${facts.definitionPath}"`,
        },
      ],
      guidance: [],
    },
    {
      id: "required-floor",
      subject: "area / tier / category",
      status: "supported-contract",
      statement:
        `${code(requiredOfEveryDefinition(facts))} are the keys the rules demand of every ` +
        `technology: each is declared exactly once, with a cardinality of one, outside any ` +
        `subtype. Nothing else on the definition is required by the rules — \`cost\` included, ` +
        `which is its own problem further down. A display name is required too, by the SDK ` +
        `rather than by the rules.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: `${CWT} — type[${facts.registry}]`,
          detail: `cardinality 1..1 outside every subtype; ${facts.subtypes.length} subtypes declared, ${
            facts.subtypes.filter((subtype) => subtype.absentUnless === null).length
          } with no modeled discriminator`,
        },
      ],
      guidance: [],
    },
    {
      id: "areas-are-closed",
      subject: "area",
      status: "supported-contract",
      statement:
        member("area").literals === null
          ? `\`area\` admits any scalar the game accepts; the rules close no set around it.`
          : `\`area\` is a closed set of ${member("area").literals?.length} values — ` +
            `${code(member("area").literals ?? [])} — so a typo there is a compile error. ` +
            `\`category\` is not closed the same way: it lowers as a ` +
            `\`${member("category").shape}\` of references to \`technology_category\` ` +
            `definitions, which means the game's own categories and any your mod adds, and a ` +
            `bare string for anything else.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("area") ?? CWT,
          detail: `literals ${(member("area").literals ?? []).join(" | ")}; category shape ${member("category").shape}`,
        },
      ],
      guidance: [],
    },
    {
      id: "cost-dual",
      subject: "cost",
      status: "supported-contract",
      statement:
        cost.shape === "dual"
          ? `\`cost\` takes either form the rules declare: a plain number of research points, or ` +
            `a weight block whose modifier rows move the price for the empire being asked. Both ` +
            `arms survived the lowering into one member, so there is no wrapper to choose ` +
            `between them.`
          : `\`cost\` lowers as \`${cost.shape}\`, which is one of the two forms the rules declare.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("cost") ?? CWT,
          detail: `declared arms ${costArms.map((arm) => arm.declaredType).join(" | ")}; lowered ${cost.shape}`,
        },
      ],
      guidance: [],
    },
    {
      id: "trigger-scopes",
      subject: "potential / modifier / weightModifier",
      status: "supported-contract",
      statement: (() => {
        const gated = [
          "potential",
          "starting_potential",
          "modifier",
          "weight_modifier",
          "ai_weight",
          "technology_swap.trigger",
        ];
        const scopes = [...new Set(gated.map((key) => scopeText(member(key).scope)))];
        return scopes.length === 1
          ? `Every trigger and modifier block a technology carries runs in ${scopes[0]} scope — ` +
              `${code(gated.map((key) => member(key).memberPath.join(".")))}. There is no ` +
              `technology scope to reach for: a technology is a thing an empire researches, and ` +
              `the empire is what all of these are asked about.`
          : `The trigger and modifier blocks on a technology do not share one scope: ` +
              `${english(gated.map((key) => `\`${member(key).memberPath.join(".")}\` in ${scopeText(member(key).scope)}`))}.`;
      })(),
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("potential") ?? CWT,
          detail: "scopes read from the rules' own `## replace_scopes` annotations",
        },
      ],
      guidance: [],
    },
    {
      id: "cost-modifier-unpinned",
      subject: "cost.modifier",
      status: "supported-contract",
      statement:
        `The modifier rows inside a \`cost\` block are the one place on this registry the rules ` +
        `pin no scope, so the surface widens them to ${scopeText(member("cost.modifier").scope)} ` +
        `rather than guessing. The identical rows inside \`weightModifier\` and \`aiWeight\` are ` +
        `pinned to ${scopeText(member("weight_modifier.modifier").scope)}. Nothing is checking ` +
        `the triggers you write inside a cost block against the scope the game evaluates them in.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("cost") ?? CWT,
          detail:
            `cost.modifier: ${scopeText(member("cost.modifier").scope)}; ` +
            `weight_modifier.modifier: ${scopeText(member("weight_modifier.modifier").scope)}; ` +
            `ai_weight.modifier: ${scopeText(member("ai_weight.modifier").scope)}`,
        },
      ],
      guidance: [],
    },
    {
      id: "prerequisites-refs",
      subject: "prerequisites",
      status: "supported-contract",
      statement:
        `\`prerequisites\` is a flat list of technology references, and every entry has to be ` +
        `researched before this one is offered. A binding from your own mod carries the id it ` +
        `was minted with; a vanilla or third-party id is a plain string the surface takes as ` +
        `given. The rules give the list no order and no weights.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("prerequisites") ?? CWT,
          detail: `lowered ${member("prerequisites").shape}; entries typed <${facts.registry}>`,
        },
      ],
      guidance: [],
    },
    {
      id: "swap-layout",
      subject: "technologySwap",
      status: "supported-contract",
      statement:
        `\`technologySwap\` is a list of alternatives this technology becomes for an empire that ` +
        `matches the swap's own \`trigger\`. It emits the other way round from how you write it: ` +
        `one \`technology_swap = { … }\` block per entry, repeated as siblings. You author it as ` +
        `an array and not as a record of ids, because ${
          facts.repeatedStructs.length === 0
            ? "this registry declares no keyed collections at all"
            : `only ${code(facts.repeatedStructs.map((entry) => entry.key))} are keyed`
        } — a swap's identity is the \`name\` field inside it, not a key you mint.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("technology_swap") ?? CWT,
          detail: `${swap.shape}, repeated ${swap.repeated}; keyed collections on this registry: ${
            facts.repeatedStructs.length
          }`,
        },
      ],
      guidance: [],
    },
    {
      id: "localisation",
      subject: "name / desc",
      status: "supported-contract",
      statement:
        `You write English in the definition and the build produces the localization file. The ` +
        `technology declares ${facts.localisation.length} slots: ` +
        `${english(
          facts.localisation.map(
            (slot) => `\`${slot.member}\` under \`${slot.pattern.replace("$", "<id>")}\``
          )
        )}. The keys are invented for you from the id the capability minted.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: `${CWT} — type[${facts.registry}] localisation`,
          detail: facts.localisation
            .map((slot) => `${slot.owner}.${slot.member} → ${slot.pattern}`)
            .join(", "),
        },
      ],
      guidance: [],
    },
  ];

  // The unlock tooltip: the rules cap it at one block, the shipped game writes
  // two, and the surface followed the game. Derived by comparing the declared
  // arm's ceiling against the lowered member's repetition — an assertion in
  // either direction would go stale silently.
  if (prereqDescArm !== undefined && prereqDescArm.cardinality.max === 1 && prereqDesc.repeated) {
    claims.push({
      id: "unlock-lines",
      subject: "prereqforDesc",
      status: "supported-contract",
      statement:
        `\`prereqforDesc\` writes the "this unlocks" lines under a technology's tooltip, one ` +
        `entry per category — ${code([...categories])}. The rules declare at most one block per ` +
        `technology and the surface authors a list of them anyway: the shipped game writes two ` +
        `in at least one technology, and the arity follows the game rather than the ` +
        `declaration.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("prereqfor_desc") ?? CWT,
          detail: `declared cardinality ${prereqDescArm.cardinality.min}..${
            prereqDescArm.cardinality.max
          }; lowered repeated ${prereqDesc.repeated}`,
        },
        {
          kind: "recorded-disposition",
          source: `${OVERLAY} — CONTENT_FIELD_OVERRIDES, technology.prereqfor_desc`,
          detail: 'arity: "repeated"',
        },
      ],
      guidance: [],
    });
    const observed = observation("prereqfor_desc");
    if (observed !== undefined) {
      claims.push({
        id: "unlock-lines-usage",
        subject: "prereqforDesc",
        status: "observed-example",
        supports: "unlock-lines",
        statement:
          `${share("prereqfor_desc")} write an unlock line of their own, and ${observed.repeated} ` +
          `of those write more than one block — which is the definition the declaration does not ` +
          `admit. Of the categories, \`custom\` is the one most of them reach for: ` +
          `${observation("prereqfor_desc.custom")?.definitions ?? 0} definitions.`,
        provenance: [corpusProvenance],
        guidance: [],
      });
    }
  }

  // The mirror case: the rules allow any number, the game writes one, and the
  // surface took the game's answer as the authoring contract. Same comparison,
  // opposite direction, so the same derivation catches both.
  if (
    groupWeightsArm !== undefined &&
    groupWeightsArm.cardinality.max === null &&
    !groupWeights.repeated
  ) {
    claims.push({
      id: "group-weights-narrowed",
      subject: "modWeightIfGroupPicked",
      status: "known-omission",
      statement:
        `The rules let a technology write \`mod_weight_if_group_picked\` any number of times. ` +
        `The surface takes exactly one \`${groupWeights.shape}\` — a map from weight-group name ` +
        `to a number — so a second block is not something you can author. The disposition is ` +
        `recorded rather than inferred: ${share("mod_weight_if_group_picked")} write the block ` +
        `and none of them writes it twice.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("mod_weight_if_group_picked") ?? CWT,
          detail: `declared cardinality ${groupWeightsArm.cardinality.min}..inf; lowered ${
            groupWeights.shape
          }, repeated ${groupWeights.repeated}`,
        },
        {
          kind: "recorded-disposition",
          source: `${OVERLAY} — CONTENT_FIELD_OVERRIDES, technology.mod_weight_if_group_picked`,
          detail: 'shape: "scalarMap", arity: "single"',
        },
        corpusProvenance,
      ],
      guidance: [],
    });
  }

  // Patchability is read off the emission rather than off a list of registry
  // names: the emitter derives a patch's rewritable localization slots only for
  // a registry the override table has admitted, so an empty list means there is
  // no `patchX` at all.
  if (facts.patchLocalisation.length > 0) {
    claims.push({
      id: "patch-surface",
      subject: "mod.patchTechnology",
      status: "supported-contract",
      statement:
        `Technology is one of the few registries with a patch surface. ` +
        `\`mod.patchTechnology(parsed, transform)\` takes a vanilla definition read out of a ` +
        `local install and re-emits the whole object with your changes folded in; every member ` +
        `the definition can author, a patch can change, because ` +
        `${facts.patchExclusions.length === 0 ? "nothing is excluded from one" : `${facts.patchExclusions.length} members are excluded`}. ` +
        `Its ${facts.patchLocalisation.length} localization slots are rewritable too, replacing ` +
        `vanilla's own text rather than adding a key.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: `${CWT} — type[${facts.registry}]`,
          detail: facts.patchLocalisation.join("; "),
        },
        {
          kind: "recorded-disposition",
          source: `${OVERLAY} — CONTENT_PATCH_REGISTRIES, technology`,
          detail: "verified in-game by the patches-that-provably-win calibration",
        },
      ],
      guidance: [],
    });

    const orGroup = facts.patchWidenings.find((row) =>
      row.startsWith(`${facts.registry}.prerequisites `)
    );
    if (orGroup !== undefined) {
      claims.push({
        id: "or-groups-omitted",
        subject: "prerequisites",
        status: "known-omission",
        statement:
          `The rules let a technology's \`prerequisites\` hold an \`OR = { … }\` alternation ` +
          `group — "any one of these three" — and the authoring surface does not. The member ` +
          `lowers to a flat list, so a definition of your own can only require all of its ` +
          `entries. The patch surface is the one place the alternation appears, and only as an ` +
          `input: a patch has to be able to hand back the group it was given.`,
        provenance: [
          {
            kind: "codegen-projection",
            source: declarationSite("prerequisites") ?? CWT,
            detail: orGroup,
          },
          {
            kind: "recorded-disposition",
            source: `${OVERLAY} — PATCH_WIDENINGS, technology.prerequisites`,
            detail: "extraType: AnyOf<TechnologyRef>",
          },
        ],
        guidance: [],
      });
    }
  }

  // The one thing on this registry nobody can settle: the rules describe two
  // kinds of technology and the surface cannot tell them apart.
  if (start !== undefined) {
    const contested = start.gatedKeys.filter((key) => start.excludedKeys.includes(key));
    const outside = costArms.filter((arm) => arm.cardinality.min >= 1);
    claims.push({
      id: "start-subtype-unresolved",
      subject: "cost / weight / startTech",
      status: "unresolved-behavior",
      statement:
        `The rules describe two kinds of technology and the surface cannot tell which one you ` +
        `are writing. ${code(contested)} are declared twice over — once inside ` +
        `\`subtype[${start.name}]\`, where each is optional, and once outside it, where ` +
        `${outside.length} of the ${costArms.length} declarations of \`cost\` demand at least ` +
        `one. What puts a definition in that subtype is \`start_tech = yes\`, and that ` +
        `discriminator is not carried into the model the SDK is generated from` +
        `${start.absentUnless === null ? "" : ` (\`absentUnless = ${start.absentUnless}\`)`}, so ` +
        `both members are optional on every technology, always. Nothing at build time knows ` +
        `whether a technology without a cost is a starting technology or an oversight. The ` +
        `corpus cannot settle it either: ${share("cost")} write one.`,
      provenance: [
        {
          kind: "cwt-rule",
          source: declarationSite("cost") ?? CWT,
          detail: costArms
            .map(
              (arm) =>
                `${arm.declaredType} at line ${arm.line}, cardinality ${arm.cardinality.min}..${
                  arm.cardinality.max ?? "inf"
                }`
            )
            .join("; "),
        },
        {
          kind: "codegen-projection",
          source: `${CWT} — subtype[${start.name}]`,
          detail: `gates ${start.gatedKeys.join(", ")}; withholds ${start.excludedKeys.join(
            ", "
          )}; discriminator ${start.absentUnless === null ? "not modeled" : start.absentUnless}`,
        },
        corpusProvenance,
      ],
      guidance: [],
    });

    const observed = observation("cost");
    if (observed !== undefined) {
      claims.push({
        id: "cost-usage",
        subject: "cost",
        status: "observed-example",
        supports: "start-subtype-unresolved",
        statement:
          `${share("cost")} write a cost: ${observed.scalars} as a plain number and ` +
          `${observed.blocks} as the block form. ${
            evidence.definitions - observed.definitions
          } write none at all, and ${share("start_tech")} declare themselves starting ` +
          `technologies.`,
        provenance: [corpusProvenance],
        guidance: [],
      });
    }
  }

  return claims;
}
