-- Run once in Supabase SQL editor. All writes go through the trusted Express backend.
create extension if not exists pgcrypto;
create table if not exists public.vehicles (
 id uuid primary key default gen_random_uuid(), name text not null,
 category text not null check(category in ('5 Seater','7 Seater','Tempo Traveller')),
 ac boolean not null default true, seats integer not null check(seats between 1 and 30),
 description text not null default '', active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.bookings (
 id uuid primary key default gen_random_uuid(), reference text not null unique,
 access_token_hash text not null unique,
 customer_name text not null, phone text not null,
 pickup text not null, destination text not null,
 start_date date not null, end_date date not null,
 trip_type text not null check(trip_type in ('One Way','Round Trip')),
 passengers integer not null check(passengers between 1 and 30),
 vehicle_id uuid not null references public.vehicles(id),
 notes text not null default '',
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 created_at timestamptz not null default now(),
 check(end_date >= start_date)
);
create table if not exists public.vehicle_blocks (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id),
 start_date date not null, end_date date not null, reason text not null default 'Unavailable',
 check(end_date >= start_date)
);
create index if not exists bookings_dates_idx on public.bookings(vehicle_id,start_date,end_date,status);
create index if not exists blocks_dates_idx on public.vehicle_blocks(vehicle_id,start_date,end_date);
-- Deny all direct browser database access. Service role bypasses RLS.
alter table public.vehicles enable row level security;
alter table public.bookings enable row level security;
alter table public.vehicle_blocks enable row level security;
revoke all on public.vehicles, public.bookings, public.vehicle_blocks from anon, authenticated;
-- Atomic approval: lock vehicle row so concurrent approvals cannot double-book.
create or replace function public.owner_decide_booking(p_id uuid, p_status text)
returns void language plpgsql security invoker set search_path=public as $$
declare b public.bookings%rowtype;
begin
 if p_status not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
 select * into b from public.bookings where id=p_id for update;
 if not found then raise exception 'Booking not found'; end if;
 if b.status <> 'pending' then raise exception 'Only pending requests can be decided'; end if;
 perform 1 from public.vehicles where id=b.vehicle_id and active=true for update;
 if not found then raise exception 'Vehicle inactive'; end if;
 if p_status='approved' then
  if exists(select 1 from public.bookings x where x.vehicle_id=b.vehicle_id and x.id<>b.id and x.status='approved' and x.start_date<=b.end_date and x.end_date>=b.start_date)
  or exists(select 1 from public.vehicle_blocks x where x.vehicle_id=b.vehicle_id and x.start_date<=b.end_date and x.end_date>=b.start_date) then
   raise exception 'Vehicle unavailable for requested dates';
  end if;
 end if;
 update public.bookings set status=p_status where id=p_id;
end $$;
-- Block creation uses same vehicle lock and refuses overlap with confirmed bookings.
create or replace function public.owner_block_vehicle(p_vehicle uuid,p_start date,p_end date,p_reason text)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_end<p_start then raise exception 'Invalid dates'; end if;
 perform 1 from public.vehicles where id=p_vehicle for update;
 if not found then raise exception 'Vehicle not found'; end if;
 if exists(select 1 from public.bookings where vehicle_id=p_vehicle and status='approved' and start_date<=p_end and end_date>=p_start) then
  raise exception 'Confirmed booking overlaps block';
 end if;
 insert into public.vehicle_blocks(vehicle_id,start_date,end_date,reason) values(p_vehicle,p_start,p_end,coalesce(nullif(p_reason,''),'Unavailable'));
end $$;
insert into public.vehicles(name,category,ac,seats,description)
select v.name,v.category,v.ac,v.seats,v.description from (values
 ('Comfort Sedan','5 Seater',true,4,'Suitable for smaller families and outstation travel'),
 ('Family SUV','7 Seater',true,6,'Spacious option for family journeys'),
 ('Group Traveller','Tempo Traveller',true,12,'For larger groups; confirm actual vehicle with owner')
) as v(name,category,ac,seats,description)
where not exists (select 1 from public.vehicles);
