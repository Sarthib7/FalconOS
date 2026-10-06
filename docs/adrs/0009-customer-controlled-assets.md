# ADR 0009: Keep customer assets in customer-controlled accounts

**Status:** Accepted as product direction, 2026-10-05. Transaction authority and legal structure remain open.

FalconOS agents operate on customer-controlled wallets or financial accounts. FalconOS provides agent infrastructure, evidence, decision graphs, and authorized financial workflows. The platform does not pool or take custody of customer assets under this model.

A wallet connection does not grant signing authority. Specify who signs, which actions an agent may perform, how permissions are scoped and revoked, and how actions are reconciled before any funded automation. Do not infer that non-custodial operation removes advisory, execution, or compliance obligations.

A pooled hedge fund is a separate product option, not part of this accepted architecture. It requires a new decision and legal review.
