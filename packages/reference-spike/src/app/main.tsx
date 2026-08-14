/**
 * The viewer's entry point.
 *
 * It resolves which page the reader asked for, checks the snapshot is a schema
 * it understands, and renders. There is no router: the pages are known at build
 * time, the link between them is an ordinary `<a href>`, and a full page load is
 * the correct amount of machinery for a static document with two pages in it.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { selectedPage } from "./pages.tsx";

import "./index.css";

const page = selectedPage(window.location.search);

if (page.build.schemaVersion !== 1) {
  throw new Error(
    `this viewer reads Reference build schema 1 and the ${page.id} snapshot is schema ` +
      `${page.build.schemaVersion} — rendering it anyway would show a reader claims the page ` +
      "does not understand"
  );
}

document.title = `${page.build.title} — Authoring Reference (spike)`;

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html is missing its #root element");
}

createRoot(root).render(
  <StrictMode>
    <App page={page} />
  </StrictMode>
);
