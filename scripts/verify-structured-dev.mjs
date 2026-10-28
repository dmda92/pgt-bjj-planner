// Whole-database traversals do not belong in smoke tests or every deployment.
throw Error('WHOLE_DATABASE_QA_PROCEDURE_DISABLED: verify only documents in the audited cleanup manifest');
