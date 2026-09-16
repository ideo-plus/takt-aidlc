# CG inputs and verification records

input/context.json indexes the current unit, requirement IDs, Testing Contract, original source paths, and fixed scripts.
Script copies are under input/project. Their actual targets and methods can be compared with the written testing procedures.
cg/source-manifest.json lists actual file changes; cg/traceability.json maps requirements to source and tests.
cg/build.json, cg/test.json, and cg/sensors.json contain measured quality-gate results. Sensor details are in cg/linter.json and cg/type-check.json.
verified means TAKT validation completed. It does not mean native CG completed or code was imported into the original project.
