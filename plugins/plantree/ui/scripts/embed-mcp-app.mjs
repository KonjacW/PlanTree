import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve("dist/mcp");
const script = await readFile(resolve(outputDirectory, "app.js"), "utf8");
const style = await readFile(resolve(outputDirectory, "app.css"), "utf8");
const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PlanTree · 任务树</title>
    <style>${style}</style>
  </head>
  <body>
    <main id="root"></main>
    <script type="module">${script.replaceAll("</script>", "<\\/script>")}</script>
  </body>
</html>`;

await writeFile(resolve("dist/mcp-app.html"), html, "utf8");
