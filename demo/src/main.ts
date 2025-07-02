import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { Logger } from "npm:tslog";
import nunjucks from "npm:nunjucks";

/**
 * The default port for the demo server
 */
const PORT = 1337;
/**
 * The path where the panic `dist/` files are served
 */
const PANIC = "panic";
/**
 * Whether to run it in dev mode, which makes debug builds and starts a watcher
 */
const IS_DEV = Deno.env.get("DEV") === "true";

// Init the main logger
const log = new Logger({
	name: "Panic Demo Server",
});

/**
 * Checks if the dist folder exists
 * @returns Whether the Panic builds exist
 */
async function distFolderExists(): Promise<boolean> {
	try {
		await Deno.stat("../dist");
		return true;
	} catch {
		return false;
	}
}

/**
 * Runs an Rspack build for panic's SW
 * @param watch Whether to run the watcher for the rest of the server's lifetime
 */
async function runRspackBuild(watch = false) {
	if (watch) {
		log.info("Starting Rspack watcher, since we are in dev mode");
	} else {
		// Use the pre-existing build if it exists
		if (await distFolderExists()) {
			log.info("Using existing build");
		} else {
			log.info(
				"No build found, running initial build once, since we are in prod",
			);
		}
	}

	const cmd = new Deno.Command("npx", {
		args: watch
			? ["rspack", "build", "--watch", "--mode=development"]
			: ["rspack", "build", "--mode=production"],
		stdout: "piped",
		stderr: "piped",
		cwd: "..",
		env: {
			...Deno.env.toObject(),
			NODE_OPTIONS: "--experimental-transform-types",
		},
	});

	const proc = cmd.spawn();

	const textDecoder = new TextDecoder();
	const rspackBuildLogger = log.getSubLogger({ name: "Rspack" });

	async function readOutput(stream: ReadableStream<Uint8Array>, isErr = false) {
		const reader = stream.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const msg = textDecoder.decode(value).trim();
			if (msg) {
				if (isErr) {
					rspackBuildLogger.error(msg);
				} else {
					rspackBuildLogger.info(msg);
				}
			}
		}
	}

	Promise.all([readOutput(proc.stdout), readOutput(proc.stderr, true)]);

	return proc;
}

runRspackBuild(IS_DEV);

const app = new Hono();

nunjucks.configure({ autoescape: false });

app.get("/", async (ctx) => {
	const template = await Deno.readTextFile("./static/index.html");
	const rendered = nunjucks.renderString(template, { PANIC_PATH: PANIC });
	return ctx.html(rendered);
});

app.use("/*", serveStatic({ root: "./static" }));
app.use(
	`/${PANIC}/*`,
	serveStatic({
		root: "../dist",
		rewriteRequestPath: (path) => path.replace(new RegExp(`^/${PANIC}`), ""),
	}),
);

log.info(
	`Server running in ${IS_DEV ? "development" : "production"} mode on http://localhost:${PORT}`,
);

Deno.serve({ port: PORT }, app.fetch);
