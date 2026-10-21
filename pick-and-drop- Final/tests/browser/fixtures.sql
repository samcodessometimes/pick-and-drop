-- Extra test data for the real-browser tests. Run after tests/api/fixtures.sql and db/dev/demo_seed.sql.
-- Test-only. Never run against a real project.
-- merchant-goodies@test (b1) becomes the staff login for every demo merchant, like the dev link script does for the real merchant account.
insert into merchant_staff (merchant_id, user_id)
  select id, '00000000-0000-4000-8000-0000000000b1' from merchants where slug like 'demo-%' on conflict do nothing;
-- rider@test (c1) is Demo Rider 001 (linked in api fixtures). rider-other@test (c2) is deliberately NOT linked to any rider.
