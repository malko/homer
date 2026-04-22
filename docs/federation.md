# HOMER Federation

Federation allows you to link multiple HOMER instances together and manage them from a unified interface. Once paired, you can switch between instances using the selector in the navigation bar.

## Concepts

- **Local instance**: the HOMER instance you are currently logged into.
- **Peer**: another HOMER instance linked via pairing.
- **Home instance**: when joining a federation as a new node, the instance you connect to becomes your "home" — your user account is federated through it.
- **CA (Certificate Authority)**: each instance generates its own internal CA to sign TLS certificates. Sharing a common CA across instances prevents browser security warnings when navigating between instances in the same homelab.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      HOMER Federation                            │
│                                                                 │
│  ┌───────────┐    shared_secret A↔B    ┌───────────┐           │
│  │ Homer-A   │ ◄──────────────────────► │ Homer-B   │           │
│  │ (home)    │    HMAC-authenticated    │ (peer)    │           │
│  │           │    HTTPS + WebSocket     │           │           │
│  └─────┬─────┘                          └─────┬─────┘           │
│        │                                       │                │
│        │ shared_secret A↔C                     │ shared_secret  │
│        │                                       │ B↔C            │
│  ┌─────▼─────┐                          ┌─────▼─────┐           │
│  │ Homer-C   │ ◄──────────────────────►│ Homer-D   │           │
│  │ (peer)    │    shared_secret C↔D    │ (peer)    │           │
│  └───────────┘                          └───────────┘           │
│                                                                 │
│  Each pair shares:                                               │
│  • A unique shared_secret (HMAC)                                │
│  • Peer CA certificate (TLS)                                    │
│  • Bidirectional REST + WS proxy                                │
└─────────────────────────────────────────────────────────────────┘
```

## Case 1 — New instance joining an existing federation (Setup Federation)

If you are installing a new HOMER instance and an existing homelab is already running, use **"Join an existing federation"** on the initial setup screen.

The new instance will automatically discover and register with **all peers** in the federation, not just the one you connect to:

```
                        Setup Federation Flow
                        ═════════════════════

  New Instance                    Homer-A (home)              Homer-B, C, ...
  ────────────                    ─────────────────           ──────────────

  1. Enter URL + credentials
  ─────────────────────────►
                                  2. Verify credentials
                                  3. (optional) Adopt CA

  4. Receive: home info +
     shared_secret + peer list
  ◄─────────────────────────
                                  5. Register on Homer-A      ┌── Homer-A notifies
                                      (federation-join)      │   all existing peers
                                      ──► returns peer list ──┘   about the newcomer
                                                               (includes each peer's
                                                                shared_secret with A)

  6. For each peer in list:
     ──► Register via /_peer/federation-join
         (using home instance's shared_secret as HMAC auth,
          senderUuid = home UUID)

  7. Store all peer entries locally
     (with unique shared_secret per peer)

  8. Create federated user + local session
  ◄── Page reloads, federation selector appears
```

1. Enter the URL of the existing instance (e.g. `https://homer-a.local`).
2. Enter your credentials from the existing instance.
3. Check **"Use remote instance's certificate authority"** to share the same CA — browsers that already trust the existing instance will trust the new one without security warnings.
4. Click **"Join Federation"** — the page reloads automatically, the instance selector appears, and **all peers from the federation are immediately available**.

> **Note**: When a CA is adopted, HOMER replaces the root CA files on disk and removes the old intermediate certificate, so Caddy regenerates the entire chain (root → intermediate → site certificates) on the next config reload. The page reloads automatically after setup. **If you see a certificate error in your browser afterwards, close and reopen the browser** — browsers cache TLS sessions and may not pick up the new certificate until restarted.

## Case 2 — Manual pairing between two existing instances

From the **Settings → Federation** page on instance A:

### On instance A (initiator)

1. Click **"Appairer"**.
2. Enter the URL of instance B (e.g. `https://homer-b.local`).
3. Click **"Initier"** — a 6-digit code is displayed.
4. Share this code with the administrator of instance B (verbally or via a messaging channel).
5. The page waits for approval automatically (polling every 3 seconds).

### On instance B (approver)

When a pairing request arrives, a **notification bell** appears in the app header. Click it to go directly to the Federation settings page.

1. Go to **Settings → Federation** on instance B.
2. A pairing request appears in the **"Demandes d'appairage reçues"** section, showing the name and URL of instance A.
3. Click **"Approuver"**, enter the code provided by instance A's administrator, then click **"Confirmer"**.
4. The page reloads automatically — instance A appears in the selector.

### Back on instance A

Once B has approved, instance A detects it automatically and shows a success screen.

**If the two instances use different CAs**: an option is shown to adopt the remote CA. Clicking **"Adopter la CA distante"** imports B's root certificate onto A, and Caddy regenerates certificates using the shared CA. The page reloads automatically. **If you see a certificate error, close and reopen your browser** to clear the cached TLS session.

Clicking **"Fermer"** reloads the page — the instance selector appears in the navigation bar.

```
                    Manual Pairing Flow
                    ═══════════════════

  Instance A (initiator)              Instance B (approver)
  ────────────────────                ─────────────────────

  1. POST /pair/initiate { url: B }
     ──────────────────────────────►
                                       2. Create pending request
                                          Generate local_code_B
     ◄──────────────────────────────
     Receive: request_id, local_code_A,
              remote_code (= B's code)

  3. Display local_code_A to admin
     Admin communicates code to B's admin

                                       4. Admin sees pairing request
                                          (bell notification in header)
                                          Clicks "Approuver"
                                          Enters A's code (local_code_A)
                                       5. POST /pair/approve/{id}
     ◄──────────────────────────────
     Polling detects "approved" status

  6. Both instances exchange
     shared_secret via HMAC-auth
     Peer entries created on both sides
```

## Pairing security model

- The initial handshake uses **TOFU** (Trust On First Use): the remote certificate is not verified on first contact, since the two instances do not yet share a CA.
- A **shared HMAC secret** is generated at initiation time and authenticates all subsequent peer-to-peer communication.
- The 6-digit code is an **out-of-band verification channel**: only an administrator with access to both UIs can complete the pairing, ensuring it is intentional.
- Pairing requests expire after **5 minutes**.

## Selecting a remote instance

Once paired, instances appear in the navigation bar selector. Selecting a remote instance routes all API requests to that instance (via the `X-Peer-Uuid` header). Federation and authentication pages always target the local instance regardless of the active selection.

## Unpairing

In the **"Instances appairées"** section, click **"Désappairer"** next to the instance. The remote instance is notified and removes the entry on its side.

## Leaving a federation

Clicking **"Quitter la fédération"** unpaire from **all** peers at once. Each peer is notified via the `_peer/unpair` endpoint. The instance becomes fully independent — you can re-join a federation later via the Federation settings page.

## Federation Settings Page

All federation management is now in **Settings → Federation** (`/settings/federation`). This page includes:

- **Instance info**: name, version, public URL
- **Paired peers**: list with status, CA adoption, unpair actions
- **Leave federation**: unpair from all peers
- **Pairing requests**: approve or reject incoming requests
- **Initiate pairing**: start a new pairing with another instance
- **CA management**: export/import root CA certificate and key

The URL reflects the active tab:
- `/settings` → General settings
- `/settings/containers` → System containers
- `/settings/federation` → Federation management

## Notification of pairing requests

When another instance initiates a pairing request, a **bell notification** appears in the app header with the count of pending requests. Clicking it navigates directly to `/settings/federation` where you can approve or reject the request.

This uses WebSocket events: when a `pairing_request` message is received, the pending count increments in the `usePeer` context and the badge updates in real-time.

## Relevant environment variables

| Variable | Purpose | Default |
|---|---|---|
| `HOMER_DOMAIN` | Public domain of this instance (e.g. `homer-a.local`). Used as the published URL during pairing. | *(empty)* |
| `HOMER_INSTANCE_NAME` | Human-readable name of the instance. Shown in the selector and during pairing. | system hostname |
| `AVAHI_ENABLED` | Enables/disables mDNS publishing for `.local` domains. | `auto` |
| `HOST_IP` | Host IP, used for mDNS publishing if auto-detection fails. | *(auto-detected)* |

## API Reference

### Auth endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/setup-federation` | Initial setup: join an existing federation. Creates federated user, registers with home + all peers. |

### Instance endpoints (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/instances/self` | Local instance identity |
| GET | `/api/instances` | List paired peers |
| GET | `/api/instances/pair/pending` | List pending pairing requests |
| POST | `/api/instances/pair/initiate` | Start pairing with a remote instance |
| GET | `/api/instances/pair/status/:id` | Poll pairing status |
| POST | `/api/instances/pair/approve/:id` | Approve a received pairing request |
| DELETE | `/api/instances/pair/:id` | Cancel a pending pairing request |
| DELETE | `/api/instances/:uuid` | Unpair from a specific peer |
| POST | `/api/instances/leave` | Leave the entire federation (unpair from all peers) |
| POST | `/api/instances/pair/adopt-ca` | Adopt a peer's CA certificate |

### Peer-to-peer endpoints (HMAC authenticated)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/instances/_peer/pair/hello` | Initial pairing handshake |
| GET | `/api/instances/_peer/pair/status` | Poll pairing approval status |
| POST | `/api/instances/_peer/unpair` | Notification that a peer has unpaired |
| POST | `/api/instances/_peer/ca-export` | Export local CA (cert + key) |
| POST | `/api/instances/_peer/federation-join` | Register a new instance (accepts both Bearer token and HMAC auth) |

### WebSocket events

| Event | Direction | Description |
|-------|-----------|-------------|
| `peer_status_changed` | Server → Client | A peer went online/offline |
| `pairing_request` | Server → Client | A new pairing request was received |
| `update_available` | Server → Client | A new HOMER version is available |
| `update_output` | Server → Client | Self-update log line |
| `update_pull_done` | Server → Client | Self-update pull completed |
| `update_error` | Server → Client | Self-update error |