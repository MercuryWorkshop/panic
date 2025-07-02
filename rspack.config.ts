import { defineConfig } from "@rspack/cli";
import { resolve } from "path";

export default defineConfig({
	entry: {
	    // I'm not going to touch this or make it TS yet until Velzie is done with whatever he is doing - Ryan
		sw: "./sw.js",
	},
	output: {
		filename: "[name].panic.js",
		path: resolve(import.meta.dirname, "dist"),
		clean: true,
	},
	target: "webworker",
	optimization: {
		minimize: true,
	},
});
