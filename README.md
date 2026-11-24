# Relay — SSH remote UI demo

An Electron thin client with a local connection form and connection history. After connecting, a remote web application fills the window, while a small local control remains available for reconnecting, switching hosts, or refreshing the page. Business JavaScript runs in the client's Chromium renderer; Linux serves HTML, CSS, JavaScript, and API responses through an SSH tunnel.

## Run locally

Requires Node.js 22+ and, for remote connections, the system OpenSSH client.

```sh
npm ci
npm start
```

The app opens the connection form without connecting automatically. The default host is `example.com`; enter your own host or SSH alias. `npm run start:ssh` opens the same form.

To try the local demo, open **Connection settings**, choose **Local demo**, enter a project path, and click **Open demo**. No remote host is contacted in this mode.

## Connection form

- **Host**: a DNS name, IPv4 address, or SSH alias. IPv6 literals are not supported yet.
- **Project path**: required. Empty or whitespace-only values are rejected in the UI, client, and server. The path is limited to 4096 characters and cannot contain control characters.
- **User**: optional and visually secondary. The app reads `os.userInfo().username`; leaving this field blank attempts to use the local account. Explicit values and saved users take priority. If account lookup fails, SSH uses its default configuration.
- **Connection settings**: SSH port, service port, and whether to check/start the dedicated `relay-demo.service` user unit.
- **Recent connections**: displays `user@host` and the project path. Selecting a record fills the form without connecting. Older records without a path remain available, but require a path before connection.

Defaults can be set through `RELAY_SSH_HOST`, `RELAY_SSH_PORT`, and `RELAY_BACKEND_PORT`. Saved connections take priority. SSH port defaults to 22; service port defaults to 18765.

The local history contains only host, user, path, ports, the service-start option, and a timestamp. It stores no passwords or private keys. History remains in the operating system's application-data directory, outside the source checkout. The application keeps its legacy profile directory name for compatibility.

## Backend and path acknowledgement

The backend listens only on `127.0.0.1`. For a simple remote deployment, copy `server/` into a dedicated directory on your server and run:

```sh
PORT=18765 node server/server.cjs
```

On Windows PowerShell, set `$env:PORT = '18765'` before running Node for a local server.

The client requires:

- `GET /health`: returns JSON containing `ok: true`.
- `POST /api/connection-context`: accepts JSON `{ "path": "/your/project" }` and returns `{ "ok": true, "path": "/your/project" }`.
- `GET /`: serves the workspace and its same-origin resources.

The client waits for the path acknowledgement before opening the workspace and sends the path again on reconnect. The backend only validates and acknowledges the path. It does not persist, resolve, expand, read, or execute it. Paths do not enter SSH commands or page URLs. Request bodies are limited to 32 KiB.

The API delay demo demonstrates that slow network requests need not block local rendering and counting. It does not protect against CPU-heavy JavaScript in the renderer.

## Optional Linux user service

`deploy/relay-demo.service` is a portable template using `%h/relay-ssh-demo` under the remote account's home directory. Copy `server/` and `scripts/` into that directory and adjust the Node executable path if needed. Install the unit as `~/.config/systemd/user/relay-demo.service`, then run:

```sh
systemctl --user daemon-reload
systemctl --user start relay-demo.service
```

The client can check/start this fixed user service if **Start service automatically** is selected. It does not install dependencies, change system services, or enable boot startup. For an independently managed server, disable this option.

From the deployment directory, run `node scripts/publish.cjs` to update the demo version. Refresh the workspace from the local connection control to see it. The server reads `version.txt` when `DEMO_VERSION_FILE` is configured, as in the service template.

Before using SSH, verify the host fingerprint and configure your existing key or SSH agent in a terminal. The app does not prompt for a password, modify `known_hosts`, or bypass host verification.

## Architecture and boundaries

- Local `BrowserWindow`: connection form and history, with a narrow preload API.
- Remote `WebContentsView`: full-window workspace, without preload or Node access.
- Local `WebContentsView`: a 48px floating control within 56px native bounds; expanded controls stay above the workspace.
- System SSH: loopback-only port forwarding, strict host checking, batch mode, no agent forwarding, and keepalive checks.
- Remote renderer: sandbox, context isolation, and default web security enabled. New windows, downloads, permission requests, and cross-origin requests/navigation are blocked.
- IPC: sender identity, frame URL, and per-view action allowlists are checked in the main process.

The connection background uses slow, muted blue/teal movement. It pauses in the workspace and becomes static when reduced motion is requested. The app uses native HTML/CSS/JavaScript without an additional UI framework.

## Tests

```sh
npm test
npm run test:ui
```

The core tests cover server behaviour, lifecycle, SSH arguments, history, path acknowledgement, and local username fallback. The Electron tests cover required paths, page-load failures, view layout, floating controls, delayed requests, publishing, reconnecting, and renderer isolation.

Real SSH tests are explicitly opt-in and require a **dedicated test service**. They stop and restart `relay-demo.service`, so do not point them at a shared application:

```sh
RUN_SSH_DEMO_TEST=1 \
RELAY_TEST_HOST='demo@example.com' \
RELAY_TEST_PATH='/srv/demo-project' \
npm run test:ssh
```

Optional test settings: `RELAY_TEST_SSH_PORT`, `RELAY_TEST_BACKEND_PORT`, and `RELAY_TEST_HOSTNAME`. Test profiles are isolated under ignored `work/`. All hostnames, addresses, users, and paths shown here are examples.

Validated on macOS with a Linux backend. Windows uses cross-platform code paths but has not been tested on a physical Windows machine. Packaging, signing, automatic updates, production authentication/authorization, and long-running network fault testing are outside this demo's scope.

## Publishing this repository

Do not commit runtime connection histories, local environment files, SSH keys, test profiles, or screenshots containing real hosts and paths. These artifacts are excluded in `.gitignore`. Before creating a commit, configure your Git author email to your GitHub-provided noreply address if you do not want a personal email published. Local Git configuration and application data are not part of a push.
