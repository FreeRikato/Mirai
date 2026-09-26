import { transformAsync } from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";
import type { BunPlugin } from "bun";

const plugin: BunPlugin = {
  name: "react-compiler",
  setup(build) {
    build.onLoad({ filter: /\/src\/web\/.+\.tsx?$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const isTsx = path.endsWith(".tsx");
      const result = await transformAsync(source, {
        filename: path,
        configFile: false,
        babelrc: false,
        parserOpts: { plugins: isTsx ? ["jsx", "typescript"] : ["typescript"] },
        plugins: [[reactCompiler, { target: "19" }]],
        sourceMaps: "inline",
      });
      return { contents: result?.code ?? source, loader: isTsx ? "tsx" : "ts" };
    });
  },
};

export default plugin;
