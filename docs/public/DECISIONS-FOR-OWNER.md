# Decisions for the owner

Things only the owner can decide (billing, tenant policy, legal, risk). Each has a recommended default that the
code already uses, so nothing is blocked while the decision is open. Entries are added as the work goes.

Nothing below has been decided for you. Where the code needed a value, it uses the **recommended default**, and
the setting that changes it is named.

## 1. Sign-in method: Google and GitHub, not Microsoft Entra External ID

- **Recommended default:** app-level OpenID Connect with Google and GitHub (what the code implements).
- **Why it is yours:** External ID needs a new external tenant, which is a tenant-policy and billing decision, and
  you work at Microsoft, so it may not be yours to create. The code has a provider interface, so External ID can be
  added later as one more class.
- **To decide:** whether to also offer External ID (or Microsoft personal accounts), and in which tenant.

## 2. Free-tier limits and the daily spend ceiling

- **Recommended default:** per person per day 60,000 tokens and 40 model calls; 300,000 tokens for the whole life of
  an account; one run and three calls in flight at a time; **all free users together 2,000,000 tokens or an
  estimated US$5 a day**, whichever comes first. At `gpt-4.1-mini` list prices that is about US$0.10 a day for a
  person who uses all of it.
- **Why it is yours:** it is your money. The numbers are conservative on purpose.
- **To decide:** the ceilings. The settings are `FREE_USER_DAILY_TOKENS`, `FREE_USER_DAILY_CALLS`,
  `FREE_USER_LIFETIME_TOKENS`, `FREE_USER_CONCURRENT_RUNS`, `FREE_GLOBAL_DAILY_TOKENS` and
  `FREE_GLOBAL_DAILY_COST_USD`.

## 3. The model deployment for the free tier, and its quota

- **Recommended default:** a **new, non-reasoning** deployment (`gpt-4.1-mini`) in the public edition's own Azure
  OpenAI / Foundry account, never the pilot's `gpt-5-mini` deployment, which reasons and spends hidden tokens.
- **Why it is yours:** a new billable resource, a quota request, and a region (data residency) are yours to approve.
  Nothing was created. The what-if in [DEPLOY.md](DEPLOY.md) shows what would be.
- **To decide:** the account, region, deployment name and capacity, and the real prices to put in `MODEL_PRICES`
  (a cost cap is never enforced from a guessed price, so the app will not start without one).

## 4. A BYOK key stays in server memory for the length of a run, and there is one replica

- **Recommended default:** a person's own key is held **only in memory**, for at most 90 minutes idle and 4 hours in all, so
  that a queued run can finish; it is never written anywhere. The public deployment runs a **single replica**, because
  the key is in one process's memory. A run whose key has gone stops and asks for the key again; it never falls back
  to your credits.
- **Why it is yours:** the brief says the server uses the key "for that request only". A run outlives its request,
  so this is a deliberate, narrow deviation, and a risk decision (a memory dump of the process would show a key that
  is in use).
- **To decide:** accept this, or limit BYOK to the steps that finish inside one request (shorter, but less useful).

## 5. What is kept after someone deletes their account

- **Recommended default:** everything of theirs is deleted. Two things stay: the append-only audit log (opaque ids,
  action words and counts, no content), and for **30 days** a keyed hash of the provider account with the free tokens
  it had used, so that deleting and signing up again does not reset the lifetime cap.
- **Why it is yours:** it is a legal question (GDPR and similar), and your answer belongs in the privacy notice.
- **To decide:** the retention. `PUBLIC_DELETED_ACCOUNT_RETENTION_DAYS=0` keeps nothing, at the cost of a weaker cap.

## 6. Terms of service and privacy notice

- **Recommended default:** the stubs in `legal/` are shipped marked "NOT YET REVIEWED", and the site says so until
  they are replaced.
- **Why it is yours:** legal text, the data controller, a contact address, the minimum age and the governing law are
  yours, and probably need a lawyer.
- **To decide:** the text. Do not open the site to the public before it is written.

## 7. Who runs it: administrators, and who owns the OAuth apps

- **Recommended default:** one or two administrators in `PUBLIC_ADMIN_EMAILS`, and the Google and GitHub OAuth apps
  registered under an account you control, not a personal one you may lose.
- **Why it is yours:** administrators can switch the free tier and signups off and disable accounts. Whoever owns the
  OAuth apps controls sign-in.
- **To decide:** the people and the owning accounts.

## 8. Where the public edition lives

- **Recommended default:** its own resource group, **in a subscription you are allowed to put a public service in**,
  and a domain you control.
- **Why it is yours:** hosting a public service on a Microsoft-linked subscription or tenant may be restricted by
  policy, and the bill and the abuse reports land on whoever owns it.
- **To decide:** the subscription, the region and the domain name ([DEPLOY.md](DEPLOY.md) has the DNS option).

## 9. The monthly budget, the alert contacts and the automatic stop

- **Recommended default:** a monthly budget with alerts at 50, 80, 100 and 120 percent, and an action group whose
  webhook turns the **free tier off** (it cannot turn it on). The amount is a parameter with no default you did not
  choose.
- **Why it is yours:** the amount, the currency, who is told, and whether a machine may switch a feature off
  without asking you.
- **Honest limit:** an Azure budget alerts; it does not stop spend, and its cost data arrives hours late. The
  protection that works in real time is the app's own daily cap.

## 10. Optional features that are off

- **Recommended default:** the web-research crawler is **off** (`PUBLIC_ALLOW_RESEARCH`). It makes your server fetch
  pages for strangers, which is an abuse and reputation risk. Turnstile bot protection is implemented and **off**
  (`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`).
- **To decide:** whether to turn either on, and when. Turn Turnstile on at the first sign of signup farming.
