# Components: synthetic input

## Structure

ValueModule is a single ES module in src/value.ts. It exposes only the named numeric constant answer, changing from 41 to 42. It has no data model, state transitions, persistence, or external I/O.

## Dependencies and boundaries

The same unit's src/value.test.ts validates the module. There are no other-unit or external-service dependencies. The contract preserves the answer export name and numeric type. The intended change is to set the internal constant value to 42.
