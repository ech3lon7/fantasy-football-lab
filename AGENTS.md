# Project instructions

Read docs/architecture.md and docs/implementation-plan.md before changing model behavior.
Keep real workbooks, extracted league data and credentials out of Git and deployment assets.
Keep calculation logic in src/domain; UI components must not duplicate formulas.
Preserve null versus zero and source timestamps. Keep surplus exchange, lineup impact, legality and uncertainty separate.
Run npm run check and npm run build for changes affecting the application; run relevant browser and Excel parity checks for affected workflows.
Do not publish secrets or real test data. Supabase changes must remain isolated from Trainwise tables.
