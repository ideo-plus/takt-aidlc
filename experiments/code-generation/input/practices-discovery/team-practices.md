# Development practices: synthetic CG test input

## Testing Posture

Methodology is test-after and Test Strategy is standard. Change the value, write five tests, then run the build, unit tests, and type checking. Minimum line coverage is 80%.

## Code Style

Preserve the existing export const answer form and trailing semicolon. No application dependencies or configuration additions are needed. No lint framework is introduced, so this experiment records an evidence-backed linter exemption. Type checking uses the integration's fixed script.
