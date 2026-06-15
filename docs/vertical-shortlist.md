# Vertical Shortlist

The framework is a reusable continuous intelligence gateway. Verticals are plugins, not product identity.

Scores use 1-5, where 5 is strongest.

| Vertical | Urgency | Buyer Budget | Data Access | Defensibility | Framework Reuse | Sales Cycle | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Vendor/API risk monitor | 4 | 4 | 4 | 3 | 5 | 3 | 23 |
| API reliability and SLA evidence | 3 | 3 | 5 | 3 | 5 | 4 | 23 |
| Regulatory and filing monitor | 4 | 4 | 3 | 4 | 3 | 2 | 20 |
| AI dataset and content licensing registry | 3 | 4 | 3 | 4 | 4 | 2 | 20 |
| Niche market intelligence feed | 4 | 3 | 4 | 3 | 3 | 3 | 20 |
| Generic API marketplace | 2 | 3 | 3 | 2 | 4 | 1 | 15 |
| Generic scraping proxy | 3 | 2 | 2 | 1 | 2 | 4 | 14 |
| Generic LLM proxy | 3 | 2 | 4 | 1 | 2 | 4 | 16 |

## Recommendation

Use **Vendor/API Risk Monitor** as the first validation plugin.

It has the best fit with the existing framework because domain verification, scheduled collection, searchable catalog records, evidence history, and paid API access all map naturally. It also avoids the failed assumption that a new namespace standard must be adopted by the market.

## Kill Criteria

Stop the first plugin if all are true after one week:

- fewer than 2 of 5 target users ask for batch monitoring or history
- nobody can name a concrete workflow where the score changes a decision
- users say existing status pages, security questionnaires, or GRC tools already solve the problem
- the only interest is a free public directory

## Expansion Criteria

Add a second vertical only after:

- at least 20 entities are monitored
- at least 5 entities have useful historical evidence
- at least 2 users ask for API/JWT/x402 access
- the first plugin has one signal that users consider decision-grade
