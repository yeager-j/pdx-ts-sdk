/**
 * The components map handed to every page's `<Content />`.
 *
 * Only components that carry derived material. Headings, paragraphs, lists,
 * tables and inline code are markdown, and Starlight's own stylesheet renders
 * them — that stylesheet is the single largest thing the framework replaced,
 * and a component whose job was structure or styling would be putting it back.
 */

import Claim from "./Claim.astro";
import Convention from "./Convention.astro";
import EvidenceSummary from "./EvidenceSummary.astro";
import FieldTable from "./FieldTable.astro";
import SdkContracts from "./SdkContracts.astro";
import StoryPanel from "./StoryPanel.astro";

export const DERIVED_COMPONENTS = {
  Claim,
  Convention,
  StoryPanel,
  FieldTable,
  SdkContracts,
  EvidenceSummary,
};
