import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";

import react from "@astrojs/react";
import remarkToc from "remark-toc";

// https://astro.build/config
export default defineConfig({
  site: "https://ponbac.xyz",
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    sitemap(),
    mdx(),
    react(),
  ],
  markdown: {
    remarkPlugins: [remarkToc],
  },
});
