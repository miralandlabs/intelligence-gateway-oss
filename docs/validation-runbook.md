# Validation Runbook

Use this runbook before expanding the framework or adding a second vertical.

## Goal

Determine whether buyers need a continuous evidence and signal feed, not whether they like the idea of a registry.

## One-Week Validation

Day 1:

- load 20 validation entities from `vendor-api-risk-plugin.md`
- run the collector at least twice
- confirm each entity has DNS, HTTP, and `security.txt` observations where available

Day 2:

- review signal output for false confidence
- adjust only obvious scoring errors
- do not add new connectors unless a user asks for that evidence

Days 3-5:

- interview 5 target users from procurement, security, developer-platform, AI-agent, or compliance workflows
- show entity cards and the `vendor_api_risk` feed
- ask for the last real vendor/API decision they made and whether this evidence would have changed it

Days 6-7:

- summarize which evidence mattered
- decide whether to charge for history, batch checks, alerts, API access, or no product

## Interview Questions

- Which vendors or APIs do you continuously worry about?
- What evidence do you check before approving or routing traffic to one?
- What breaks if that evidence is stale?
- Would a score help, or do you need raw evidence only?
- Would you pay for alerts, batch checks, history, or API access?
- Who owns this budget: security, procurement, platform, compliance, or engineering?

## Pass Criteria

Proceed if at least 3 of 5 users identify a real workflow and at least 2 ask for a paid capability such as:

- batch vendor/API checks
- alerting on risk changes
- historical evidence trails
- API/JWT access
- agentic x402 access to a specific feed

## Fail Criteria

Stop or pivot if:

- users only want a free directory
- the score is not trusted and raw evidence is not valuable
- the useful data requires private integrations the MVP cannot access
- the buyer is unclear after five conversations

## Output

At the end of validation, produce a short decision memo:

- keep, pivot, or stop
- strongest buyer segment
- evidence users cared about
- evidence users ignored
- first paid feature
- next connector, if any
