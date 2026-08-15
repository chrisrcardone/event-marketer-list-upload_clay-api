# Routine contract — Event Lead Router

The app is coupled to a Clay **workflow-type routine** through this contract. The reference
implementation was built in Clay (workspace 859539) as
["Event Lead Router — enrich & write to Salesforce campaign"](https://app.clay.com/workspaces/859539/terracotta/tc-workflows/wf_0tju1s7qHXcxnYpijqb),
registered as routine **`workflow:wf_0tju1s7qHXcxnYpijqb`**, and verified end-to-end through
the Public API on 15 Aug 2026. A fork points `CLAY_ROUTINE_ID` at its own routine satisfying
the same contract.

> Routine id formats: `function:t_…` for function-type routines, `workflow:wf_…` for
> workflow-type routines (this app uses the latter; treat the id as an opaque string).

## What the workflow does

1. Normalizes the incoming lead.
2. Finds the person's **LinkedIn URL** if missing (name + optional domain/title).
3. Enriches the **person** from LinkedIn/email (canonical profile, title, current company + domain).
4. Enriches the **company** by domain (industry, size, description, location).
5. Finds a **work email** if missing (name + company domain), and a **mobile phone** if
   missing (from LinkedIn) — each lookup runs only when its value is absent and its inputs exist.
6. Looks up the target **Campaign** (by record id, else by name), the **Contact** (by email,
   else name + account name), and the **Account** (by website domain, else name).
7. Creates the **Account** (fully enriched) when the company isn't in Salesforce yet, then the
   **Contact** (linked to the account) when the person isn't.
8. Ensures **campaign membership**: creates the CampaignMember with the chosen
   `campaign_member_status` (e.g. Registered, Attended), or lets Salesforce apply the
   campaign's default status when none was given. Already-members are never duplicated.

The workflow owns every Salesforce write. The app never talks to Salesforce except to build
deep links.

## Inputs (per item `inputs` object — all strings, all optional)

| Field | Notes |
| --- | --- |
| `first_name`, `last_name` | Trimmed; used for finders, contact creation, name-based lookup |
| `email` | Lowercased; primary contact-lookup key; skips the email finder when present |
| `phone` | Skips the phone finder when present |
| `company` | Company name |
| `title` | Job title |
| `linkedin_url` | Skips the LinkedIn finder when present |
| `campaign_id` | Salesforce Campaign record id — preferred campaign reference |
| `campaign_name` | Fallback campaign reference when no id (exact name match, newest first) |
| `campaign_member_status` | Member disposition (must exist on the campaign, e.g. Registered / Attended); empty ⇒ campaign default |
| `source_event` | Audit label; written into the created contact's description |
| `uploaded_by` | Uploader's email, for auditability |

At least one identity — `email`, or `first_name`+`last_name`+`company`, or `linkedin_url` —
must be present for a useful outcome (the app enforces this pre-flight).

## Output (per item `result` object)

```json
{
  "status": "added | already_member | failed",
  "failure_reason": "campaign_not_specified | campaign_not_found | missing_required_field | salesforce_write_failed | \"\"",
  "first_name": "Alison", "last_name": "Gresham",
  "email": "alison@outtake.ai", "email_was_found": false, "email_verification": "",
  "phone": "+1 555 000 0000", "phone_was_found": false,
  "title": "Head of Sales Development",
  "linkedin_url": "https://www.linkedin.com/in/alison-gresham", "linkedin_was_found": true,
  "company_name": "Outtake", "company_domain": "outtake.ai",
  "company_industry": "", "company_employees": 0,
  "salesforce_contact_id": "003a700000zVnO0AAK",
  "salesforce_account_id": "001a700000KXXTAAA5",
  "contact_was_created": false, "account_was_created": false,
  "campaign_member_id": "00va700000gz9fhAAA",
  "campaign_member_status": "Sent",
  "campaign_id": "701a700001B5lfRAAR",
  "campaign_name": "Hypergrowth GTM Operators Dinner",
  "campaign_type": "In-Person"
}
```

(That example is a real verified run — the already-member path.)

**Status semantics**

- `added` — the contact is now a member of the campaign (contact/account created as needed).
- `already_member` — the contact was already in the campaign; nothing was written.
  `campaign_member_status` echoes their *existing* status.
- `failed` + `failure_reason`:
  - `campaign_not_specified` — neither campaign id nor name arrived.
  - `campaign_not_found` — the campaign lookup found nothing.
  - `missing_required_field` — no existing contact and no last name to create one with.
  - `salesforce_write_failed` — a create call failed.

**Two kinds of failure still apply** (spec §3.2): Clay can mark the whole item
`status: "failed"` (the run itself broke), *or* the item completes and this payload reports
`status: "failed"`. The app counts both.

The app maps statuses to its row vocabulary: `added` → written; `already_member` → skipped
("Already in campaign"); `failed` → failed with the humanized reason. The reserved contract
statuses `enriched_only` and `skipped_duplicate` map to skipped if a routine returns them
(this workflow doesn't).

## Building your own

Any Clay workflow with a **manual trigger** whose input schema matches the table above and
whose terminal node returns the output shape satisfies the contract. Register it:

```bash
clay routines create workflow <your-workflow-id> --name "Event Lead Router"
```

and set `CLAY_ROUTINE_ID` to the returned id. The Salesforce connection is whatever your Clay
workspace has connected — this app never sees those credentials.
