-- Synthetic identities only. Runner wraps fixtures in a transaction and rolls back.
insert into auth.users(id,email,email_confirmed_at) values
('00000000-0000-4000-8000-000000000001','owner-a@example.test',now()),
('00000000-0000-4000-8000-000000000002','manager@example.test',now()),
('00000000-0000-4000-8000-000000000003','setter@example.test',now()),
('00000000-0000-4000-8000-000000000004','closer@example.test',now()),
('00000000-0000-4000-8000-000000000005','reader@example.test',now()),
('00000000-0000-4000-8000-000000000006','inactive@example.test',now()),
('00000000-0000-4000-8000-000000000007','owner-b@example.test',now()),
('00000000-0000-4000-8000-000000000008','invited@example.test',now()),
('00000000-0000-4000-8000-000000000009','unconfirmed@example.test',null);
insert into crm.workspaces(id,name) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Workspace A'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Workspace B');
insert into crm.memberships(id,workspace_id,user_id,role,is_owner,status,deactivated_at) values
('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001','admin',true,'active',null),
('10000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000002','manager',false,'active',null),
('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000003','setter',false,'active',null),
('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000004','closer',false,'active',null),
('10000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000005','read_only',false,'active',null),
('10000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000006','setter',false,'inactive',now()),
('10000000-0000-4000-8000-000000000007','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-4000-8000-000000000007','admin',true,'active',null);
insert into crm.teams(id,workspace_id,name,created_by_membership_id) values
('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Team A','10000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Team B','10000000-0000-4000-8000-000000000001');
insert into crm.team_memberships(workspace_id,team_id,membership_id,is_manager,created_by_membership_id) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',true,'10000000-0000-4000-8000-000000000001'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',false,'10000000-0000-4000-8000-000000000001'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',false,'10000000-0000-4000-8000-000000000001');
insert into private.invitations(workspace_id,intended_email,role,token_digest,expires_at,created_by_membership_id) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invited@example.test','setter',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'),now()+interval '1 day','10000000-0000-4000-8000-000000000001'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','unconfirmed@example.test','setter',encode(sha256(convert_to(repeat('b',64),'UTF8')),'hex'),now()+interval '1 day','10000000-0000-4000-8000-000000000001');
