import { createWorker } from "https://esm.sh/await-sync";
import epoxyInit, {
	EpoxyClient,
	EpoxyClientOptions,
} from "https://esm.sh/@mercuryworkshop/epoxy-tls";

/**
 * @typedef {import("@mercuryworkshop/epoxy-tls").EpoxyClient} EpoxyClient
 */

const awaitSync = createWorker();

/**
 * @type {Promise<EpoxyClient> | null}
 */
let epoxyClientPromise = null;
/**
 * @returns {Promise<EpoxyClient>}
 */
const getSharedEpoxyClient = () => {
	if (!epoxyClientPromise) {
		epoxyClientPromise = (async () => {
			await epoxyInit();
			const epoxyOptions = new EpoxyClientOptions();
			return new EpoxyClient("wss://anura.pro/", epoxyOptions);
		})();
	}
	return epoxyClientPromise;
};

const ARGS = Symbol("xhr original args");
const HEADERS = Symbol("xhr headers");

XMLHttpRequest.prototype.open = new Proxy(XMLHttpRequest.prototype.open, {
	apply(target, that, args) {
		if (args[2] === undefined) args[2] = true;
		that[ARGS] = args;

		if (args[2]) {
			return Reflect.apply(target, that, args);
		}
	},
});

XMLHttpRequest.prototype.setRequestHeader = new Proxy(
	XMLHttpRequest.prototype.setRequestHeader,
	{
		apply(target, that, args) {
			if (!that[HEADERS]) that[HEADERS] = {};
			const headers = that[HEADERS];
			headers[args[0]] = args[1];

			return Reflect.apply(target, that, args);
		},
	},
);

XMLHttpRequest.prototype.send = new Proxy(XMLHttpRequest.prototype.send, {
	apply(target, that, args) {
		const originalArgs = that[ARGS];
		if (!originalArgs || originalArgs[2]) {
			return Reflect.apply(target, that, args);
		}

		const syncFetch = awaitSync(async (url, method, headers, body) => {
			const epoxyClient = await getSharedEpoxyClient();

			const response = await epoxyClient.fetch(url, {
				method: method,
				headers: headers,
				body: body,
			});
			const arrayBuffer = await response.arrayBuffer();
			const bodyText = new TextDecoder().decode(arrayBuffer);
			const responseHeaders = [];
			for (const [responseHeader, value] of Object.entries(response.headers)) {
				responseHeaders.push(`${responseHeader}: ${value}`);
			}
			return {
				status: response.status,
				statusText: response.statusText,
				body: bodyText,
				bodyab: Array.from(new Uint8Array(arrayBuffer)),
				headers: responseHeaders.join("\r\n"),
			};
		});

		const response = syncFetch(
			originalArgs[1],
			originalArgs[0],
			Object.fromEntries(Object.entries(that[HEADERS] || {})),
			args[0],
		);

		Object.defineProperty(that, "status", {
			get() {
				return response.status;
			},
			configurable: true,
		});

		Object.defineProperty(that, "statusText", {
			get() {
				return response.statusText;
			},
			configurable: true,
		});

		Object.defineProperty(that, "responseText", {
			get() {
				return response.body;
			},
			configurable: true,
		});

		Object.defineProperty(that, "response", {
			get() {
				if (that.responseType === "arraybuffer") {
					return new Uint8Array(response.bodyab).buffer;
				}
				return response.body;
			},
			configurable: true,
		});

		Object.defineProperty(that, "responseXML", {
			get() {
				const parser = new DOMParser();
				return parser.parseFromString(response.body, "text/xml");
			},
			configurable: true,
		});

		Object.defineProperty(that, "readyState", {
			get() {
				return 4;
			},
			configurable: true,
		});

		Object.defineProperty(that, "getAllResponseHeaders", {
			get() {
				return () => response.headers;
			},
			configurable: true,
		});

		Object.defineProperty(that, "getResponseHeader", {
			get() {
				return (header) => {
					const re = new RegExp(`^${header}: (.*)$`, "m");
					const match = re.exec(response.headers);
					return match ? match[1] : null;
				};
			},
			configurable: true,
		});

		if (that.onreadystatechange) that.onreadystatechange();
		if (that.onload) that.onload();

		return undefined;
	},
});
