import { createMDX } from "fumadocs-mdx/next";

import { PDX_NEXT_CONFIG } from "./src/next-config-values.mjs";
import { withPdxSourceResolution } from "./src/pdx-source-resolution.mjs";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  ...PDX_NEXT_CONFIG,
  webpack: (webpackConfig) => withPdxSourceResolution(webpackConfig),
};

export default withMDX(config);
