-- "Company owner": runs the companies they're given with full control (users, settings, shops, money,
-- salaries, reports, backups), but can't see or open any other company, can't add companies, and
-- can't change the roles every company shares. Unlike the Owner role, access is limited to the
-- companies ticked on the user.
INSERT INTO "roles" ("name", "description", "permissions", "is_owner", "is_system")
	SELECT 'Company owner',
		'Full control of the companies ticked for them, and nothing outside them. Cannot add companies or change roles.',
		'["vouchers.create","vouchers.edit","vouchers.editOld","vouchers.cancel","vouchers.delete","vouchers.restore","masters.edit","masters.delete","money.view","money.edit","staff.manage","reports.sales","reports.all","accounting.view","accounting.edit","see.purchasePrice","see.profit","see.stockValue","see.partyBalance","see.partyContact","locations.all","settings.edit","users.manage","audit.view","backups.manage"]'::jsonb,
		false,
		true
	WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE lower("name") = 'company owner');
