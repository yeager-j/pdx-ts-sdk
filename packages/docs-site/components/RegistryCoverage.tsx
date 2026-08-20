import { Fragment } from "react";

import { coveragePages } from "@/lib/coverage-pages";
import { buildCoverage } from "@/src/registry-coverage";

/**
 * The coverage page's three tables, and the site's registry gate.
 *
 * `buildCoverage` throws on any registry that is neither documented nor
 * excused, so rendering this component in the page is what gives the gate its
 * teeth: the failure happens during `next build`, locally and in CI.
 */
export function RegistryCoverage() {
  const coverage = buildCoverage(coveragePages());
  const documented = coverage.registries.filter((row) => row.page !== undefined).length;

  return (
    <>
      <h2 id="content-registries">Content registries</h2>

      <p>
        {coverage.registries.length} registries, {documented} with a reference page. Each one
        defines a kind of game content, and writes into the folder named here.
      </p>

      <table>
        <thead>
          <tr>
            <th>Registry</th>
            <th>Call</th>
            <th>Game folder</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          {coverage.registries.map((row) => (
            <tr key={row.registry}>
              <td>
                <code>{row.registry}</code>
              </td>
              <td>
                <code>mod.{row.method}</code>
              </td>
              <td>
                <code>{row.folder}</code>
              </td>
              <td>
                {row.page ? (
                  <a href={row.page.href}>{row.page.title}</a>
                ) : (
                  <span>Not written yet ({row.undocumented})</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>Rows with no page name the batch of work that will write it.</p>

      <h2 id="channels">Channels</h2>

      <p>
        These are supported too, but they are not registries: they mint no content ids and are not
        generated from a content type. Each has its own page: <a href="/concepts/events/">Events</a>
        , <a href="/concepts/on-actions/">On-actions</a>,{" "}
        <a href="/concepts/localization/">Localization</a>, <a href="/concepts/assets/">Assets</a>,
        and <a href="/reference/ship-of-size-limits/">Ship-of-size limits</a>.
      </p>

      <table>
        <thead>
          <tr>
            <th>Concept</th>
            <th>Call</th>
            <th>Game folder</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          {coverage.channels.map((channel) => (
            <tr key={channel.concept}>
              <td>{channel.concept}</td>
              <td>
                {channel.methods.map((method, index) => (
                  <Fragment key={method}>
                    {index > 0 && <br />}
                    <code>{method}</code>
                  </Fragment>
                ))}
              </td>
              <td>
                {channel.folders.length === 0 ? (
                  <span>Wherever you place them</span>
                ) : (
                  channel.folders.map((folder) => <code key={folder}>{folder}</code>)
                )}
              </td>
              <td>{channel.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="not-supported-yet">Not supported yet</h2>

      <p>
        The {coverage.unsupported.length} locations below hold script content in Stellaris{" "}
        {coverage.gameVersion} and nothing the SDK authors writes to any of them. There is no page
        for these and no generated TypeScript type, so the SDK cannot author them today.
      </p>

      <p>
        The list covers <code>common/</code> only — a folder per concept, except for the handful of
        files the game keeps at the root of <code>common/</code>, two of which are the game's own
        notes to modders rather than content. Script content the game keeps elsewhere —{" "}
        <code>map/</code>, <code>prescripted_countries/</code>, flag colors, music, fonts — is also
        unsupported and not listed here. Asset trees — <code>gfx/</code>, <code>interface/</code>,{" "}
        <code>sound/</code> — are the Assets channel's business, and the registries that write into
        them are in the first table.
      </p>

      <ul>
        {coverage.unsupported.map((folder) => (
          <li key={folder}>
            <code>{folder}</code>
          </li>
        ))}
      </ul>
    </>
  );
}
