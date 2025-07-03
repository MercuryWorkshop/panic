# PANic!

A web proxy, similar to [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet) or [Rammerhead](https://github.com/binary-person/rammerhead), powered by **Palo Alto GlobalProtect**.

Site support is currently limited, but it should still support many sites that ultraviolet or rammerhead would.

## Installation

1. clone the repository
2. Download the client js bundle for PAN (will be named something like `pan_js_all_XXXs.js`). We cannot legally redistribute this. The sha256sum is `62c7f732cd7db70fffcac81bab9b7e5a3cd70b8391902075dc7d2977f7421093`. Only the 260s revision is known to be working.
3. Place the bundle in the root directory of the repository.
4. Modify the variables at the top of `panic.js` to match your environment.
5. `pnpm i`
6. Run the server with `node panic.js`
