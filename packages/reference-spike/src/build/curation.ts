/**
 * The Situation page's derived claims: sentences generated from the facts, not
 * written.
 *
 * The line this module draws is the same one the page draws for its reader.
 * Everything here is a *generated* sentence — a supported contract assembled
 * from what the lowering decided, an observation that quotes the committed
 * corpus and counts, an omission derived from comparing declared arms against
 * lowered ones. Change the surface and these sentences change with it, because
 * none of them was typed by hand.
 *
 * Authored prose is not here. Section narrative and the curated conventions
 * live in `content/situations.mdx`, where a person can write and edit them like
 * writing. The machine half of a convention is in `conventions.ts`, which every
 * page shares.
 */

import type { ReferenceClaim } from "../claims.ts";
import type { RegistryFacts } from "../facts.ts";
import type { RegistryEvidence } from "./corpus-evidence.ts";
import { derivations } from "./derive.ts";
import { isRequired } from "./fingerprints.ts";
import type { ReferencePage } from "./pages.ts";

const CWT = "vendor/cwtools-stellaris-config/config/common/situations.cwt";
const OBSERVATIONS = "packages/sdk/tests/codegen/corpus-observations.ts";

/**
 * Builds the page's claims from the facts and the evidence.
 *
 * Takes both rather than reading them itself so the negative-control tests can
 * hand it deliberately mutated facts and watch the guidance fingerprints move.
 */
export function situationClaims(
  facts: RegistryFacts,
  evidence: RegistryEvidence,
  page: ReferencePage
): ReferenceClaim[] {
  const { member, observation, share, declarationSite, scopeText } = derivations(
    facts,
    evidence,
    page
  );
  const stages = facts.repeatedStructs.find((entry) => entry.key === "stages")!;
  const approach = facts.repeatedStructs.find((entry) => entry.key === "approach")!;
  const picture = facts.partialLowerings.find((entry) => entry.key === "picture");
  const color = facts.partialLowerings.find((entry) => entry.key === "stages.color");
  const dynamic = facts.subtypes.find((entry) => entry.name === "dynamic_progress")!;
  const colorDocs =
    facts.declared.find((entry) => entry.key === "stages.color")?.arms[0]?.docs ?? [];

  const claims: ReferenceClaim[] = [
    {
      id: "registry",
      subject: "mod.situationType",
      status: "supported-contract",
      statement:
        `\`mod.situationType(name, def)\` defines one situation type. The mod's prefix is ` +
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
      id: "monthly-progress-required",
      subject: "monthlyProgress",
      status: "supported-contract",
      statement: isRequired(facts, "monthly_progress")
        ? "`monthlyProgress` is required. It is a weight block whose every modifier row also " +
          "carries display text, so the game can show a player why the situation is moving " +
          "at the rate it is."
        : "`monthlyProgress` is optional in the current surface.",
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("monthly_progress") ?? CWT,
          detail: `shape ${member("monthly_progress").shape}, scope ${scopeText(
            member("monthly_progress").scope
          )}`,
        },
      ],
      guidance: [],
    },
    {
      id: "stages-layout",
      subject: "stages",
      status: "supported-contract",
      statement:
        `\`stages\` is a keyed container: the whole collection is written as one \`stages = { … }\` ` +
        `block, and each record key becomes an entry inside it. Order is the order you write ` +
        `them in.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("stages") ?? CWT,
          detail: `repeatedStruct, ${stages.keying} keying, no identity field`,
        },
      ],
      guidance: [],
    },
    {
      id: "approach-layout",
      subject: "approach",
      status: "supported-contract",
      statement:
        `\`approach\` is written the other way round: the key repeats once per entry — ` +
        `\`approach = { name = … } approach = { name = … }\` — and your record key is lifted ` +
        `into each block's \`${approach.identityKey}\` field. Same authoring shape as ` +
        `\`stages\`, different PDXScript.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("approach") ?? CWT,
          detail: `repeatedStruct, ${approach.keying} keying, identity field \`${approach.identityKey}\``,
        },
      ],
      guidance: [],
    },
    {
      id: "nested-localisation",
      subject: "stages / approach localization",
      status: "supported-contract",
      statement:
        "Every stage and approach key is a localization key too. `name` is emitted under the " +
        "key itself and is required; `desc` is emitted under `<key>_desc` and is optional. You " +
        "write English text in the definition and the build produces the localization entries.",
      provenance: [
        {
          kind: "codegen-projection",
          source: `${CWT} — type[${facts.registry}] localisation`,
          detail: facts.localisation
            .filter((slot) => slot.owner !== facts.registry)
            .map((slot) => `${slot.owner}.${slot.member} → ${slot.pattern}`)
            .join(", "),
        },
      ],
      guidance: [],
    },
    {
      id: "trigger-scopes",
      subject: "potential / abortTrigger / onStart",
      status: "supported-contract",
      statement:
        `\`potential\` runs in ${scopeText(member("potential").scope)} scope — it decides ` +
        `whether an empire can have the situation at all. Everything else on the definition — ` +
        `\`abortTrigger\`, \`onStart\`, \`onFail\`, \`onAbort\`, \`onProgressComplete\` — runs in ` +
        `${scopeText(member("on_start").scope)} scope.`,
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
      id: "stage-target-modifier-unpinned",
      subject: "stages.targetModifier",
      status: "supported-contract",
      statement:
        `A stage's \`targetModifier\` and \`triggeredTargetModifier\` are the one place the rules ` +
        `pin no scope, so the surface widens them to any scope rather than guessing. The same ` +
        `two members on the situation type and on an approach are pinned to ` +
        `${scopeText(member("target_modifier").scope)}. Nothing is checking a stage's ` +
        `target modifier keys against the scope your target actually is.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("stages.target_modifier") ?? CWT,
          detail:
            `stages.targetModifier: ${scopeText(member("stages.target_modifier").scope)}; ` +
            `approach.targetModifier: ${scopeText(member("approach.target_modifier").scope)}`,
        },
      ],
      guidance: [],
    },
  ];

  if (picture !== undefined) {
    claims.push({
      id: "picture-block-omitted",
      subject: "picture",
      status: "known-omission",
      statement:
        `The rules declare \`picture\` twice: once as a plain sprite, and once as a ` +
        `trigger-gated block that picks a different image per condition. Only the plain sprite ` +
        `form is authorable. Both declarations repeat, so both would author as arrays and the ` +
        `writer could not tell which arm a value belonged to — unlike \`title\` and \`desc\`, ` +
        `whose scalar arm is single and which therefore lower as duals.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("picture") ?? CWT,
          detail: `declared arms ${[picture.keptArm, ...picture.droppedArms].join(" | ")}; lowered ${picture.loweredShape}`,
        },
        {
          kind: "recorded-disposition",
          source: `${OBSERVATIONS} — ACKNOWLEDGED_MISMATCHES, situation_type.picture form`,
          detail: "family: indistinguishable-arms",
        },
      ],
      guidance: [],
    });
    const pictureEvidence = observation("picture");
    if (pictureEvidence !== undefined) {
      claims.push({
        id: "picture-usage",
        subject: "picture",
        status: "observed-example",
        supports: "picture-block-omitted",
        statement:
          `${share("picture")} write \`picture\`: ${pictureEvidence.scalars} as a plain ` +
          `sprite and ${pictureEvidence.blocks} as the conditional block. The block form is what ` +
          `the SDK cannot author.`,
        provenance: [
          {
            kind: "corpus",
            source: `packages/sdk/tests/fixtures/corpus/${facts.registry}.json`,
            detail: `Stellaris ${evidence.gameVersion}, ${evidence.definitions} definitions`,
          },
        ],
        guidance: [],
      });
    }
  }

  if (color !== undefined) {
    claims.push({
      id: "stage-color-contradiction",
      subject: "stages.color",
      status: "known-omission",
      statement:
        `A stage's \`color\` accepts a named color only. The rules declare it twice — ` +
        `${color.droppedArms.join(", ")} as well as ${color.keptArm} — and only the named-color ` +
        `arm lowered. The documentation the surface carries on the member is the prose attached ` +
        `to the arm that did not: it still tells you a numeric RGBA vector is accepted, and the ` +
        `type will reject one. Treat the member's own doc comment as wrong until this is fixed.`,
      provenance: [
        {
          kind: "codegen-projection",
          source: declarationSite("stages.color") ?? CWT,
          detail: `declared arms ${[color.keptArm, ...color.droppedArms].join(" | ")}; lowered ${color.loweredShape}`,
        },
        {
          kind: "cwt-rule",
          source: `${CWT}:${facts.declared.find((entry) => entry.key === "stages.color")?.arms[0]?.line}`,
          detail: colorDocs.join(" "),
        },
      ],
      guidance: [],
    });
    claims.push({
      id: "stage-color-usage",
      subject: "stages.color",
      status: "observed-example",
      supports: "stage-color-contradiction",
      statement:
        `${share("stages.color")} set a stage color at all, which is far below the ` +
        `floor at which this repo's conformance gate treats a field as load-bearing. That the ` +
        `game ships almost no examples is not evidence that the field is unimportant, only that ` +
        `there is very little to read.`,
      provenance: [
        {
          kind: "corpus",
          source: `packages/sdk/tests/fixtures/corpus/${facts.registry}.json`,
          detail: `Stellaris ${evidence.gameVersion}`,
        },
      ],
      guidance: [],
    });
  }

  claims.push({
    id: "progress-mode-unresolved",
    subject: "totalProgress / stages.end / stages.sectionWeight",
    status: "unresolved-behavior",
    statement:
      `A situation measures progress in one of two ways, and which one it is in is not something ` +
      `the surface can tell you. The rules gate \`sectionWeight\` behind a \`${dynamic.name}\` ` +
      `subtype and withhold \`end\` from it, but the discriminator that puts a definition in ` +
      `that subtype is not carried into the model the SDK is generated from — so both members ` +
      `are optional, on every stage, always. The rules' own prose says setting \`totalProgress\` ` +
      `switches the mode and that mixing the two makes the game log an error; the subtype is ` +
      `keyed on the block form of \`totalProgress\` specifically, and nothing states what the ` +
      `scalar form does. The corpus cannot settle it either: ${share("total_progress")} ` +
      `write \`totalProgress\` at all. Nothing checks the combination for you at build time.`,
    provenance: [
      {
        kind: "cwt-rule",
        source: `${CWT}:${facts.declared.find((entry) => entry.key === "total_progress")?.arms[0]?.line}`,
        detail:
          "Setting this switches the Situation into SECTION WEIGHTS mode: every stage must then " +
          "use `section_weight` and none may use `end` (the game logs an error if you mix the two).",
      },
      {
        kind: "codegen-projection",
        source: `${CWT} — subtype[${dynamic.name}]`,
        detail: `gates ${dynamic.gatedKeys.join(", ")}; withholds ${dynamic.excludedKeys.join(
          ", "
        )}; discriminator not modeled`,
      },
      {
        kind: "corpus",
        source: `packages/sdk/tests/fixtures/corpus/${facts.registry}.json`,
        detail: `total_progress in ${observation("total_progress")?.definitions ?? 0} definitions, stages.section_weight in ${
          observation("stages.section_weight")?.definitions ?? 0
        }`,
      },
    ],
    guidance: [],
  });

  claims.push({
    id: "target-scope-authored",
    subject: "targetScope",
    status: "supported-contract",
    statement:
      "`targetScope` is not a game field. No rule declares it, nothing is written for it, and " +
      "the SDK strips it before serializing. It is an assertion you make about your own " +
      "situation, and its whole value is that `startSituation` is then checked against it.",
    provenance: [
      {
        kind: "sdk-source",
        source: "packages/sdk/src/content/situations.ts",
        detail: "`targetScope` is authored and emits nothing",
      },
      {
        kind: "codegen-projection",
        source: `${CWT} — type[${facts.registry}]`,
        detail: "no `target_scope` key is declared or lowered",
      },
    ],
    guidance: [],
  });

  const identityKey = approach.identityKey ?? "name";
  claims.push({
    id: "identity-boundary",
    subject: "stages / approach record keys",
    status: "supported-contract",
    statement:
      `Your record keys are nested content ids, and the capability refuses one that does not ` +
      `carry the mod prefix. Written straight into \`approach.allow\`, \`approach.potential\`, ` +
      `\`stages.potential\` or \`abortTrigger\`, a \`currentStage\` or ` +
      `\`currentSituationApproach\` value is also checked against the keys this same definition ` +
      `declares. Nested inside a combinator or an effect closure it still compiles, unchecked — ` +
      `which is what most vanilla script looks like.`,
    provenance: [
      {
        kind: "sdk-source",
        source: "packages/sdk/src/content/situations.ts",
        detail: `approach identity field \`${identityKey}\`; stages keyed by the record key itself`,
      },
      {
        kind: "codegen-projection",
        source: declarationSite("approach") ?? CWT,
        detail: "the rules type the identity value and say nothing about prefixes",
      },
    ],
    guidance: [],
  });

  return claims;
}
