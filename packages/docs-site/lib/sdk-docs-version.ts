import sdkPackage from "../../sdk/package.json";
import { SDK_DOCS_REVISION } from "./generated/sdk-docs-revision";

export const SDK_DOCS_VERSION = sdkPackage.version;
export const SDK_DOCS_VERSION_LINE = `SDK version: ${SDK_DOCS_VERSION}`;
export { SDK_DOCS_REVISION };
export const SDK_DOCS_REVISION_LINE = `SDK revision: ${SDK_DOCS_REVISION}`;
