import { readFileSync } from "node:fs";

export const PLAN_TREE_UI_RESOURCE_URI = "ui://plantree/plan-tree.html";
export const PLAN_TREE_UI_MIME_TYPE = "text/html;profile=mcp-app";
export const PLAN_TREE_UI_METADATA = {
  ui: {
    csp: {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    },
    permissions: {},
  },
} as const;

export const planTreeUiHtml = readFileSync(new URL("../../ui/dist/mcp-app.html", import.meta.url), "utf8");
