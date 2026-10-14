-- "Delete staff and partners" is new. The Owner role has every permission already; of the built-in
-- roles only "Company owner" gets it (Accountant and Billing staff don't).
UPDATE "roles" SET "permissions" = "permissions" || '["people.delete"]'::jsonb
	WHERE lower("name") = 'company owner' AND "is_system" AND NOT ("permissions" ? 'people.delete');
