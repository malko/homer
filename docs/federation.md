# HOMER Federation

Federation allows you to link multiple HOMER instances together and manage them from a unified interface. Once paired, you can switch between instances using the selector in the navigation bar.

## Concepts

- **Local instance**: the HOMER instance you are currently logged into.
- **Peer**: another HOMER instance linked via pairing.
- **CA (Certificate Authority)**: each instance generates its own internal CA to sign TLS certificates. Sharing a common CA across instances prevents browser security warnings when navigating between instances in the same homelab.

## Case 1 — New instance joining an existing homelab (Setup Federation)

If you are installing a new HOMER instance and an existing homelab is already running, use **"Join an existing federation"** on the initial setup screen.

1. Enter the URL of the existing instance (e.g. `https://homer-a.local`).
2. Enter your credentials from the existing instance.
3. Check **"Use remote instance's certificate authority"** to share the same CA — browsers that already trust the existing instance will trust the new one without security warnings.
4. Click **"Join Federation"** — the page reloads automatically and the instance selector appears in the navigation bar.

> **Note**: For the CA change to take effect, Caddy must regenerate its TLS certificates. HOMER automatically clears the old CA certificate cache on import, so Caddy will issue new certificates immediately.

## Case 2 — Manual pairing between two existing instances

From the **Federation** page on instance A:

### On instance A (initiator)

1. Click **"Appairer"**.
2. Enter the URL of instance B (e.g. `https://homer-b.local`).
3. Click **"Initier"** — a 6-digit code is displayed.
4. Share this code with the administrator of instance B (verbally or via a messaging channel).
5. The page waits for approval automatically (polling every 3 seconds).

### On instance B (approver)

1. Go to the **Federation** page on instance B.
2. A pairing request appears in the **"Demandes d'appairage reçues"** section, showing the name and URL of instance A.
3. Click **"Approuver"**, enter the code provided by instance A's administrator, then click **"Confirmer"**.
4. The page reloads automatically — instance A appears in the selector.

### Back on instance A

Once B has approved, instance A detects it automatically and shows a success screen.

**If the two instances use different CAs**: an option is shown to adopt the remote CA. Clicking **"Adopter la CA distante"** imports B's root certificate onto A, and Caddy regenerates certificates using the shared CA.

Clicking **"Fermer"** reloads the page — the instance selector appears in the navigation bar.

## Pairing security model

- The initial handshake uses **TOFU** (Trust On First Use): the remote certificate is not verified on first contact, since the two instances do not yet share a CA.
- A **shared HMAC secret** is generated at initiation time and authenticates all subsequent peer-to-peer communication.
- The 6-digit code is an **out-of-band verification channel**: only an administrator with access to both UIs can complete the pairing, ensuring it is intentional.
- Pairing requests expire after **5 minutes**.

## Selecting a remote instance

Once paired, instances appear in the navigation bar selector. Selecting a remote instance routes all API requests to that instance (via the `X-Peer-Uuid` header). Federation and authentication pages always target the local instance regardless of the active selection.

## Unpairing

In the **"Instances appairées"** section, click **"Désappairer"** next to the instance. The remote instance is notified and removes the entry on its side.

## Relevant environment variables

| Variable | Purpose | Default |
|---|---|---|
| `HOMER_DOMAIN` | Public domain of this instance (e.g. `homer-a.local`). Used as the published URL during pairing. | *(empty)* |
| `HOMER_INSTANCE_NAME` | Human-readable name of the instance. Shown in the selector and during pairing. | system hostname |
| `AVAHI_ENABLED` | Enables/disables mDNS publishing for `.local` domains. | `auto` |
| `HOST_IP` | Host IP, used for mDNS publishing if auto-detection fails. | *(auto-detected)* |
