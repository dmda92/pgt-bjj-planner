// Retained as a fail-closed compatibility entrypoint for old operator commands.
// A deployment/test must never inventory, erase or bootstrap the database.
throw Error('WHOLE_DATABASE_QA_PROCEDURE_DISABLED: use an audited, quota-gated cleanup manifest for the exact QA run');
