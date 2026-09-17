-- Fingerprint of the books, used to prove a backup restores to the same data.
-- :cutoff is a timestamp; rows created after it are ignored so live and restored copies compare fairly.
select json_build_object(
  'vouchers',        (select count(*) from vouchers where created_at <= :'cutoff'),
  'voucher_lines',   (select count(*) from voucher_lines l join vouchers v on v.id = l.voucher_id where v.created_at <= :'cutoff'),
  'parties',         (select count(*) from parties where created_at <= :'cutoff'),
  'items',           (select count(*) from items where created_at <= :'cutoff'),
  'sales_total',     (select coalesce(sum(total_paise), 0) from vouchers where type = 'sale_invoice' and status = 'active' and created_at <= :'cutoff'),
  'purchase_total',  (select coalesce(sum(total_paise), 0) from vouchers where type = 'purchase_bill' and status = 'active' and created_at <= :'cutoff'),
  'party_balance',   (select coalesce(sum(pl.amount_paise), 0) from party_ledger pl left join vouchers v on v.id = pl.voucher_id where v.id is null or v.created_at <= :'cutoff'),
  'money_balance',   (select coalesce(sum(ml.amount_paise), 0) from money_ledger ml left join vouchers v on v.id = ml.voucher_id where v.id is null or v.created_at <= :'cutoff'),
  'stock_qty',       (select coalesce(sum(sl.qty_milli), 0) from stock_ledger sl left join vouchers v on v.id = sl.voucher_id where v.id is null or v.created_at <= :'cutoff')
);
