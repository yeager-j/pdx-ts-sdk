const OPTIONAL_BOOL = "7f458999f754f7024a8ca2dcab499c90d84c7380a56425a7eecdcf36573a817c";
const OPTIONAL_SCALAR = "4991372805db6e602783d6cac77b45415a1b47c9c4cf5078a1701c89f2ed17e6";
const OPTIONAL_LOCALISATION = "6df6f11a721885f478d9cb30bfe7daeda0ece00112f3616972f9a7b9f114aa49";
const OPTIONAL_TRIGGER = "8e2edb1bad9661d87c9471ae33b87991257a42b101e18931ef95752070701e90";
const OPTIONAL_EFFECT = "048d783ff51ed1abee08716bc90d30c2285569e5a749159ecb5f45048bff6188";
const OPTIONAL_YES = "a42175346a2df11d5251a341011a1809f99ee5874ac775f1ca6f16369e60bbfa";
const OPTIONAL_SPRITE = "a816d16885a7f6b32c56472017e84070c48450cacd401afa6dbd5b7c5b897349";

/**
 * Reviewed SHA-256 signatures for every field in the vendored event rule body.
 * A rule-shape change fails policy validation until its field is reviewed and this table is updated.
 */
export const EVENT_RULE_SIGNATURES = {
  abort_effect: OPTIONAL_EFFECT,
  abort_trigger: OPTIONAL_TRIGGER,
  after: OPTIONAL_EFFECT,
  archaeology: OPTIONAL_BOOL,
  astral_rift: OPTIONAL_BOOL,
  auto_opens: OPTIONAL_BOOL,
  auto_select: OPTIONAL_BOOL,
  base: "625fb7fd71a0750ab4029322684960c5a0e2c553e5b8a161fde971794f501796",
  custom_gui: OPTIONAL_SCALAR,
  custom_gui_option: OPTIONAL_SCALAR,
  desc: "ae24d028d78354099e15055fdd3562babf677770409b08e55b21d5d3f0d6f3d1",
  desc_clear: OPTIONAL_YES,
  difficulty: "d270f3c82d1fd020b719f009a2a6746bd601bbe4bec9b8ced04081612567f6cb",
  diplomatic: OPTIONAL_BOOL,
  diplomatic_title: OPTIONAL_LOCALISATION,
  espionage_operation: OPTIONAL_BOOL,
  event_chain: "3531081917d3ab7746ba9111f4d7fe00b1bbf1a2642a73b8e37cc097bcc5a90b",
  event_message_type: "50b5e3b3b9c29b6ada7d70bc2b36643c12934b86e314f9dfca213c906e2f4f2a",
  event_picture_background: OPTIONAL_SPRITE,
  event_window_type: "31a81b7885e46e57b5cee011cc628f1c9feb2f64bd6186236bbfa1315650c1fd",
  fire_only_once: OPTIONAL_BOOL,
  first_contact: OPTIONAL_BOOL,
  force_open: OPTIONAL_BOOL,
  hide_window: OPTIONAL_BOOL,
  id: "d19e2537e6205d1de23c0fff3684c636244fe35ca89fa6622b308a36a70cf598",
  immediate: OPTIONAL_EFFECT,
  is_advisor_event: OPTIONAL_BOOL,
  is_test_event: OPTIONAL_BOOL,
  is_triggered_only: OPTIONAL_BOOL,
  location: "1c32758e1b7f75d7b0e3025dc9b5730c65c922d1a8c52207101e497b56eb0a32",
  major: OPTIONAL_YES,
  major_trigger: OPTIONAL_TRIGGER,
  mean_time_to_happen: "bb352357506c1bbac0dd2a2500423cae5023c02f792c28422b8e093b8908c1ed",
  message_desc: OPTIONAL_LOCALISATION,
  notification_event_icon: OPTIONAL_SPRITE,
  option: "e7b2cd5f437f7c47f22c82d5171e6f787943d82ce38ce2d83428fbc00d68d5e3",
  option_clear: OPTIONAL_YES,
  picture: "d8c1ce5420b4e9ac739a08e7b1a0ef1aab70856f265ed2be6c209e0ed5c544bd",
  picture_clear: OPTIONAL_YES,
  picture_event_data: "831b406806f4349680a57d4765ca7294bfc4526f7b823651e42847361645f5e5",
  pre_triggers: "5c162636aad8b0254fd57080060c20c6a85325cc805c08674dcbb865d042a18b",
  show_sound: "af065e4adb531dca064b081f0a55ccaa9c9f9743ee29c5f42297177ef445805e",
  show_sound_clear: OPTIONAL_YES,
  situation: "fc2aae240525c0ca45874dd656f04651ef1b9855bb900e8ec451d318fe15903c",
  specimen: "9f13cfd14b1e1506a6391a40d2f89c908554dcce2dcbb56b0b06ffb0d865b3cb",
  title: "c04dff3e33ebbd7b52b6f82f7168a0c64c29788123a58ea09d3b4b23f36d0606",
  trackable: OPTIONAL_BOOL,
  trigger: OPTIONAL_TRIGGER,
  trigger_clear: OPTIONAL_YES,
  weight_multiplier: "b6493dbb3e6a1a80c5d27050ab7e5212702ecf88ef70f29e5a92e7bba2789a4a",
};

/**
 * Reviewed SHA-256 signatures for every field in the vendored event-option rule body.
 * Hashes use the normalized signatures produced by `eventFieldRuleSignatures`.
 */
export const OPTION_RULE_SIGNATURES = {
  ai_chance: "045b9a1b5f1ea6a005b99230a12929da046ceb84b00684f209282ec2af2aaacb",
  allow: OPTIONAL_TRIGGER,
  custom_gui: OPTIONAL_SCALAR,
  default_hide_option: OPTIONAL_BOOL,
  exclusive_trigger: OPTIONAL_TRIGGER,
  hide_option_if_not_allowed: OPTIONAL_BOOL,
  icon: "720c2adb3f4b2b5655a7e101b53e27ed790b677d4336435cd35396a24740fe44",
  is_dialog_only: OPTIONAL_BOOL,
  name: "ad2f508557297b03f41bcf7d00d38bd5817f66a8998a04c204994b0dca1c4f0e",
  response_text: OPTIONAL_LOCALISATION,
  sound: OPTIONAL_SCALAR,
  tag: "63bca1a915c4d5ca4461d0c254c30892427c8fa107d19e7072bfc929426f018e",
  trigger: OPTIONAL_TRIGGER,
};
