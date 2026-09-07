# Running the momentum mock backend inside a real Nextcloud instance

`mock/` (see `README.md` in this directory) is a standalone Vite dev-server
harness: `npm run mock` boots the real `src/main.ts` app shell against a
mocked host/API/DAV layer, with no Nextcloud instance at all. That's the
fastest loop for day-to-day frontend work, but it renders inside a
hand-approximated `nc-theme.css`, not real Nextcloud/HiDrive Next chrome —
useful, but not the same thing a user actually sees.

This doc covers the other option: pointing a **real, running Nextcloud
instance's** momentum app at the same mock backend, so you see the exact
same mocked documents/fields inside genuine HiDrive Next navigation, header,
theming, and routing. Everything below was exercised end-to-end against this
repo's own `.devcontainer` stack.

## Why this needs more than `npm run mock`

A real Nextcloud instance doesn't load `src/main.ts` through Vite — it loads
the **prebuilt** bundle this app ships at `js/momentum-main.js` /
`js/momentum-files.js` (`npm run build`'s output). The mock backend's
middleware, on the other hand, only exists inside the Vite dev server
(`vite.mock.config.ts`'s `configureServer` hook) — a real Nextcloud instance
has no such hook. So the setup is: run the mock backend as its own reachable
HTTP server (still `npm run mock`, just exposed on the network), then point
the real instance's Glue App proxy at it instead of a real Doc-Mgr backend.

**Consequence to remember:** every time you change momentum frontend source
and want to see it in the real instance (not the Vite mock harness), you
must `npm run build` again — the real instance never picks up `src/`
changes on its own. A stale `js/momentum-main.js` is the most likely reason
what you see in the real instance doesn't match the mock harness or your
latest source edit.

## One-time instance setup

These steps configure a Nextcloud instance and its `momentum` app to accept
proxied requests without a real Doc-Mgr backend. All commands below assume
this repo's `.devcontainer` (`docker compose` service `nextclouddev`,
Postgres `db`) — adjust container/user names for a different instance.

1. **Bring the instance up.**

   ```sh
   cd .devcontainer
   docker compose up -d
   ```

   This repo's `.devcontainer/docker-compose.yml` maps the instance to
   `localhost:8880` (see that file's `ports:` — `8880:80`) rather than the
   devcontainer's stock `80:80`, to avoid clashing with anything else
   already bound to host port 80.

2. **Confirm the `momentum` app is enabled and has a tenant mapping.**

   ```sh
   docker exec -u devcontainer devcontainer-nextclouddev-1 php occ app:list | grep momentum
   docker exec devcontainer-db-1 psql -U oc_admin -d postgres -c "SELECT * FROM oc_momentum_tenants;"
   ```

   You need at least one row in `oc_momentum_tenants` mapping an NC user
   group (e.g. `momentum-demo`) to a `tenant_id` and `backend_url`, and a
   user in that group to log in as. If this instance has never been
   configured for momentum before, you also need `momentum_eddsa_private_key`
   set (`occ config:system:get momentum_eddsa_private_key`) — token minting
   (`TokenMinter.php`) fails closed without it, before the request ever
   reaches `backend_url`. Provisioning that from scratch is out of scope
   here; ask whoever last set up this instance's momentum tenant, or see
   `glue-app/lib/Service/TokenMinter.php`'s own doc comment.

3. **Point that tenant's `backend_url` at the mock server**, replacing
   whatever real Doc-Mgr backend it currently targets:

   ```sh
   docker exec devcontainer-db-1 psql -U oc_admin -d postgres -c \
     "UPDATE oc_momentum_tenants SET backend_url = 'http://<gateway-ip>:5173/apps/momentum/api' WHERE user_group_id = '<your-group>';"
   ```

   `<gateway-ip>` is the Docker bridge gateway address the container sees
   the host through — find it via the *existing* `backend_url` value if one
   is already configured (it'll be an IP like `172.23.0.1`), or from
   `docker exec <nextclouddev-container> ip route | grep default`. This is
   **not** `localhost`/`127.0.0.1` — that resolves to the container itself,
   not the host running `npm run mock`.

   This is a live update to a shared row in a real database — if this
   instance is shared with anyone else, coordinate before repointing it away
   from a real backend, and remember to point it back afterwards.

## Every time you want to see the mock data

1. **Start the mock server exposed on the network**, not just localhost —
   the default `npm run mock` binds to `127.0.0.1` only, which the
   container cannot reach:

   ```sh
   cd glue-app   # or wherever this app's source lives on the host
   npm run mock -- --host 0.0.0.0
   ```

   Verify the container can actually reach it before debugging anything
   else:

   ```sh
   docker exec <nextclouddev-container> curl -s -o /dev/null -w '%{http_code}\n' \
     http://<gateway-ip>:5173/apps/momentum/api/document-types
   ```

   A `200` here means the network path is fine and any remaining issue is
   in the app itself; a connection failure means fix the `--host`/gateway-IP
   step first.

2. **Rebuild the real instance's JS bundle** so it reflects your current
   `src/`:

   ```sh
   npm run build
   ```

   (`vite build && VITE_BUILD_TARGET=files vite build`, per `package.json`
   — writes `js/momentum-main.js` and `js/momentum-files.js`.)

3. **Log into the real instance** (`http://localhost:8880/` for this repo's
   devcontainer) as a user in the mapped group, and open
   `/index.php/apps/momentum/document/<mock-public-id>` for any
   `public_id` seeded in `mock/fixtures.ts`'s `DOCUMENTS`.

4. If you change `src/` again, repeat steps 1-2 is unnecessary for the mock
   server (it hot-reloads on save) — only **step 2** (`npm run build`) needs
   repeating, since the real instance only ever reads the prebuilt bundle.
   A hard reload (bypass cache) in the browser after rebuilding is the
   cheapest way to rule out a stale asset if something still looks off.

## Known rough edges

* **File preview will show "Preview unavailable."** The mock DAV endpoint
  (`mock/server.ts`'s `handleDav`) only resolves paths under its own mock
  user's home (`/mock-user/files/...`); a real instance's logged-in user
  has a different home path, so the preview's `PROPFIND`/`GET` calls 404
  against the mock. Only the field panel (driven by the
  `/apps/momentum/api/*` proxy) is meaningfully mocked end-to-end this way.
* **This bypasses `apps/*`'s usual gitignore/submodule handling.** This
  `mock/` directory (and the rest of this app's source, however it got onto
  this host) isn't tracked in this repo — see the top-level `README.md` for
  this app's actual source of truth and how it's meant to be brought in.
