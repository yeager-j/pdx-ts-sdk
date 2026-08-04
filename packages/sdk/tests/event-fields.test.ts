/**
 * Runtime coverage for SDK-46: the 14 unconditionally-declared `EventDef`
 * fields the hand-written surface omitted, the five `subtype` window flags
 * that gate on the event's kind, and the nine omitted `EventOption` fields.
 * See `packages/sdk/src/events.ts` and `vendor/cwtools-stellaris-config/config/events/events.cwt`.
 *
 * The blocking case gets its own describe block: a port of a real vanilla
 * dig-stage event (`arcsite.1000`, `events/arcsite_events.txt` in the
 * installed game) that sets `archaeology = yes` and `location = from` —
 * previously impossible to author without rebuilding the emitted entry
 * through the PDXScript AST by hand.
 */

import { describe, expect, it } from "vitest";

import { eventTarget } from "../src/effect-core.ts";
import { buildMod, collection, namespace, render } from "../src/index.ts";
import { hasEventChain, hasGlobalFlag } from "../src/triggers.ts";

const CONFIG = {
  name: "Event fields tests",
  prefix: "event_fields",
  supportedVersion: "4.0.*",
};

function makeEvents() {
  return namespace("event_fields");
}

describe("the archaeology blocking case (SDK-46)", () => {
  it("ports arcsite.1000 (events/arcsite_events.txt): archaeology + location + a dig option, no AST escape hatch", () => {
    const events = makeEvents();
    const dig = events.defineFleetEvent({
      id: 1000,
      from: "archaeological_site",
      title: "Icelocked Settlement",
      desc: "A settlement locked in ice.",
      picture: "GFX_evt_icelocked_settlement",
      showSound: "event_wind_ruins",
      location: (ctx) => ctx.from,
      archaeology: true,
      isTriggeredOnly: true,
      immediate: (_fleet, ctx) => {
        ctx.from.effects((site) => site.setSiteProgressLocked(true));
      },
      options: [
        {
          name: "DIG",
          effects: (fleet) => {
            fleet.owner((country) => {
              country.addMonthlyResourceMult({
                resource: "engineering_research",
                value: 5,
                min: 2,
                max: 10,
              });
            });
          },
        },
        {
          name: "Insights into Climate Control Network",
          trigger: hasGlobalFlag("tech_massive_glacier_known"),
          allow: hasGlobalFlag("energy_stockpile_400"),
          effects: (fleet) => {
            fleet.owner((country) => {
              country.addResearchOption("tech_massive_glacier");
            });
          },
        },
      ],
      after: (_fleet, ctx) => {
        ctx.from.effects((site) => site.setSiteProgressLocked(false));
      },
    });

    const rendered = render(buildMod(CONFIG, [collection("events", [dig])])).get(
      "events/event_fields_events.txt"
    )!;

    // The blocking case: the window flag and the FROM-scoped location, both
    // unreachable through EventDef before this change.
    expect(rendered).toContain("archaeology = yes");
    expect(rendered).toContain("location = from");
    // The rest of the header, matching arcsite.1000's shape.
    expect(rendered).toContain("picture = GFX_evt_icelocked_settlement");
    expect(rendered).toContain("show_sound = event_wind_ruins");
    expect(rendered).toContain("is_triggered_only = yes");
    // immediate/after both open the site FROM ref by its absolute path, exactly
    // as `from = { set_site_progress_locked = yes/no }` does in the source file.
    expect(rendered).toContain("immediate = {\n\t\tfrom = {\n\t\t\tset_site_progress_locked = yes");
    expect(rendered).toContain("after = {\n\t\tfrom = {\n\t\t\tset_site_progress_locked = no");
    // The two options, structurally matching arcsite.1000's DIG option and its
    // gated second option.
    expect(rendered).toContain("owner = {\n\t\t\tadd_monthly_resource_mult = {");
    expect(rendered).toContain("resource = engineering_research");
    expect(rendered).toContain("trigger = {\n\t\t\thas_global_flag = tech_massive_glacier_known");
    expect(rendered).toContain("add_research_option = tech_massive_glacier");
  });

  it("keeps the window flags off events of the wrong kind (no first_contact/espionage_operation/astral_rift leakage)", () => {
    const events = makeEvents();
    const rift = events.defineAstralRiftEvent({
      id: 1001,
      hideWindow: true,
      isTriggeredOnly: true,
      astralRift: true,
      difficulty: 3,
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [rift])])).get(
      "events/event_fields_events.txt"
    )!;
    expect(rendered).toContain("astral_rift = yes");
    expect(rendered).toContain("difficulty = 3");
    expect(rendered).not.toContain("archaeology");
    expect(rendered).not.toContain("first_contact = yes");
    expect(rendered).not.toContain("espionage_operation = yes");
  });

  it("lowers the diplomatic window flag on any event kind (an attribute subtype, not a kind-gated one)", () => {
    const events = makeEvents();
    const summit = events.defineCountryEvent({
      id: 1002,
      hideWindow: true,
      isTriggeredOnly: true,
      diplomatic: true,
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [summit])])).get(
      "events/event_fields_events.txt"
    )!;
    expect(rendered).toContain("diplomatic = yes");
  });
});

describe("previously-omitted EventDef fields", () => {
  it("lowers trigger, abort_trigger, and abort_effect", () => {
    const events = makeEvents();
    const gated = events.defineCountryEvent({
      id: 1010,
      hideWindow: true,
      isTriggeredOnly: true,
      trigger: hasGlobalFlag("event_fields_eligible"),
      abortTrigger: hasGlobalFlag("event_fields_abort"),
      abortEffect: (country) => country.setCountryFlag("event_fields_aborted"),
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [gated])])).get(
      "events/event_fields_events.txt"
    )!;
    expect(rendered).toContain("trigger = {\n\t\thas_global_flag = event_fields_eligible");
    expect(rendered).toContain("abort_trigger = {\n\t\thas_global_flag = event_fields_abort");
    expect(rendered).toContain("abort_effect = {\n\t\tset_country_flag = event_fields_aborted");
  });

  it("lowers mean_time_to_happen with its days/months/years and modifier rows", () => {
    const events = makeEvents();
    const scheduled = events.defineCountryEvent({
      id: 1011,
      hideWindow: true,
      meanTimeToHappen: {
        days: 10,
        months: 1,
        modifiers: [{ factor: 2, when: hasGlobalFlag("event_fields_boosted") }],
      },
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [scheduled])])).get(
      "events/event_fields_events.txt"
    )!;
    expect(rendered).toContain(
      "mean_time_to_happen = {\n\t\tmonths = 1\n\t\tdays = 10\n\t\tmodifier = {\n\t\t\tfactor = 2\n\t\t\thas_global_flag = event_fields_boosted"
    );
  });

  it("lowers weight_multiplier with its factor and modifier rows", () => {
    const events = makeEvents();
    const scheduled = events.defineCountryEvent({
      id: 1014,
      hideWindow: true,
      isTriggeredOnly: true,
      weightMultiplier: {
        factor: 5,
        modifiers: [{ factor: 3, when: hasGlobalFlag("event_fields_weighted") }],
      },
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [scheduled])])).get(
      "events/event_fields_events.txt"
    )!;
    expect(rendered).toContain(
      "weight_multiplier = {\n\t\tfactor = 5\n\t\tmodifier = {\n\t\t\tfactor = 3\n\t\t\thas_global_flag = event_fields_weighted"
    );
  });

  it("lowers major_trigger, an attribute-subtype trigger gated on major's own value", () => {
    const events = makeEvents();
    const flagged = events.defineCountryEvent({
      id: 1015,
      hideWindow: true,
      isTriggeredOnly: true,
      major: true,
      majorTrigger: hasGlobalFlag("event_fields_materialist"),
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [flagged])])).get(
      "events/event_fields_events.txt"
    )!;
    expect(rendered).toContain("major = yes");
    expect(rendered).toContain("major_trigger = {\n\t\thas_global_flag = event_fields_materialist");
  });

  it("lowers the plain unconditional booleans, refs, and text fields", () => {
    const events = makeEvents();
    const flagged = events.defineCountryEvent({
      id: 1012,
      hideWindow: true,
      isTriggeredOnly: true,
      diplomaticTitle: "A diplomatic screen title.",
      messageDesc: "A message feed entry.",
      eventMessageType: "event",
      eventChain: "event_fields_chain",
      specimen: "event_fields_specimen",
      eventPictureBackground: "GFX_evt_background",
      notificationEventIcon: "GFX_notification_icon",
      eventWindowType: "leader_conversation",
      major: true,
      trackable: true,
      isAdvisorEvent: true,
      autoSelect: true,
      autoOpens: true,
      isTestEvent: true,
      forceOpen: true,
    });
    const files = render(buildMod(CONFIG, [collection("events", [flagged])]));
    const rendered = files.get("events/event_fields_events.txt")!;
    expect(rendered).toContain("event_message_type = event");
    expect(rendered).toContain("event_chain = event_fields_chain");
    expect(rendered).toContain("specimen = event_fields_specimen");
    expect(rendered).toContain("event_picture_background = GFX_evt_background");
    expect(rendered).toContain("notification_event_icon = GFX_notification_icon");
    expect(rendered).toContain("event_window_type = leader_conversation");
    expect(rendered).toContain("major = yes");
    expect(rendered).toContain("trackable = yes");
    expect(rendered).toContain("is_advisor_event = yes");
    expect(rendered).toContain("auto_select = yes");
    expect(rendered).toContain("auto_opens = yes");
    expect(rendered).toContain("is_test_event = yes");
    expect(rendered).toContain("force_open = yes");
    expect(rendered).toContain("message_desc = event_fields.1012.message_desc");
    expect(rendered).toContain("diplomatic_title = event_fields.1012.diplomatic_title");
    const loc = files.get("localisation/english/event_fields_l_english.yml")!;
    expect(loc).toContain(' event_fields.1012.message_desc:0 "A message feed entry."');
    expect(loc).toContain(' event_fields.1012.diplomatic_title:0 "A diplomatic screen title."');
  });

  it("lowers a situation reference", () => {
    const events = makeEvents();
    const target = eventTarget<"situation">("event_fields_situation");
    const observed = events.defineCountryEvent({
      id: 1013,
      hideWindow: true,
      isTriggeredOnly: true,
      situation: target,
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [observed])])).get(
      "events/event_fields_events.txt"
    )!;
    expect(rendered).toContain("situation = event_target:event_fields_situation");
  });
});

describe("previously-omitted EventOption fields", () => {
  it("lowers icon, sound, exclusive_trigger, ai_chance, response_text, and the remaining flags", () => {
    const events = makeEvents();
    const withOptions = events.defineCountryEvent({
      id: 1020,
      hideWindow: true,
      isTriggeredOnly: true,
      options: [
        {
          name: "First",
          icon: {
            icon: "GFX_option_icon",
            iconBackground: "GFX_option_bg",
            text: "An icon caption.",
          },
          sound: "event_default",
          exclusiveTrigger: hasGlobalFlag("event_fields_exclusive"),
          aiChance: {
            factor: 15,
            modifiers: [{ factor: 3, when: hasGlobalFlag("event_fields_ai_boost") }],
          },
          responseText: "The AI's response.",
          isDialogOnly: true,
          defaultHideOption: true,
          customGui: "event_fields_gui",
          tag: "event_fields_tag",
        },
      ],
    });
    const files = render(buildMod(CONFIG, [collection("events", [withOptions])]));
    const rendered = files.get("events/event_fields_events.txt")!;
    expect(rendered).toContain(
      "icon = {\n\t\t\ticon = GFX_option_icon\n\t\t\ticon_background = GFX_option_bg\n\t\t\ttext = event_fields.1020.a.icon"
    );
    expect(rendered).toContain("sound = event_default");
    expect(rendered).toContain(
      "exclusive_trigger = {\n\t\t\thas_global_flag = event_fields_exclusive"
    );
    expect(rendered).toContain(
      "ai_chance = {\n\t\t\tfactor = 15\n\t\t\tmodifier = {\n\t\t\t\tfactor = 3\n\t\t\t\thas_global_flag = event_fields_ai_boost"
    );
    expect(rendered).toContain("response_text = event_fields.1020.a.response");
    expect(rendered).toContain("is_dialog_only = yes");
    expect(rendered).toContain("default_hide_option = yes");
    expect(rendered).toContain("custom_gui = event_fields_gui");
    expect(rendered).toContain("tag = event_fields_tag");

    const loc = files.get("localisation/english/event_fields_l_english.yml")!;
    expect(loc).toContain(' event_fields.1020.a.icon:0 "An icon caption."');
    expect(loc).toContain(' event_fields.1020.a.response:0 "The AI\'s response."');
  });
});

describe("PR #15 review follow-ups (SDK-46)", () => {
  it("registers a localisation key for modifier desc in mean_time_to_happen, weight_multiplier, and option.ai_chance, instead of throwing", () => {
    const events = makeEvents();
    // The real proof: this builds at all. Before this fix, modifierEntry threw
    // "this row was never registered" for every one of these three fields —
    // a hard crash on a legal `Modifier<S>` input (modifier_rule.cwt's `desc`).
    const scheduled = events.defineCountryEvent({
      id: 1030,
      hideWindow: true,
      meanTimeToHappen: {
        days: 5,
        modifiers: [
          { factor: 2, desc: "MTTH modifier tooltip.", when: hasGlobalFlag("event_fields_mtth") },
        ],
      },
      weightMultiplier: {
        factor: 1,
        modifiers: [
          {
            factor: 3,
            desc: "Weight modifier tooltip.",
            when: hasGlobalFlag("event_fields_weight"),
          },
        ],
      },
      options: [
        {
          name: "First",
          aiChance: {
            factor: 10,
            modifiers: [
              {
                factor: 4,
                desc: "AI chance modifier tooltip.",
                when: hasGlobalFlag("event_fields_ai"),
              },
            ],
          },
        },
      ],
    });

    const files = render(buildMod(CONFIG, [collection("events", [scheduled])]));
    const rendered = files.get("events/event_fields_events.txt")!;
    expect(rendered).toContain(
      "mean_time_to_happen = {\n\t\tdays = 5\n\t\tmodifier = {\n\t\t\tfactor = 2\n\t\t\tdesc = event_fields.1030_mean_time_to_happen_0"
    );
    expect(rendered).toContain(
      "weight_multiplier = {\n\t\tfactor = 1\n\t\tmodifier = {\n\t\t\tfactor = 3\n\t\t\tdesc = event_fields.1030_weight_multiplier_0"
    );
    expect(rendered).toContain(
      "ai_chance = {\n\t\t\tfactor = 10\n\t\t\tmodifier = {\n\t\t\t\tfactor = 4\n\t\t\t\tdesc = event_fields.1030_option_0.ai_chance_0"
    );

    const loc = files.get("localisation/english/event_fields_l_english.yml")!;
    expect(loc).toContain(' event_fields.1030_mean_time_to_happen_0:0 "MTTH modifier tooltip."');
    expect(loc).toContain(' event_fields.1030_weight_multiplier_0:0 "Weight modifier tooltip."');
    expect(loc).toContain(
      ' event_fields.1030_option_0.ai_chance_0:0 "AI chance modifier tooltip."'
    );
  });

  it("lowers majorTrigger as a country-scope predicate, evaluated per recipient country rather than the event's own scope", () => {
    const events = makeEvents();
    // A fleet event: majorTrigger must still accept a country-only predicate
    // (events.cwt:419-425 — it filters recipient countries, not fleets).
    const flagged = events.defineFleetEvent({
      id: 1031,
      hideWindow: true,
      major: true,
      majorTrigger: hasEventChain("event_fields_chain"),
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [flagged])])).get(
      "events/event_fields_events.txt"
    )!;
    expect(rendered).toContain("major_trigger = {\n\t\thas_event_chain = event_fields_chain");
  });
});
