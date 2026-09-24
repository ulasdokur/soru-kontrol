-- Hoca ücretleri: hak ediş bitmiş inceleme sayısından hesaplanır, ödeme ayrı kaydedilir.
-- "Bakiye" = hak ediş − ödenen. Ödeme yapılmadan bakiye kapanmaz (yanlış "ödendi" izlenimi olmasın).

alter table public.hoca add column if not exists soru_ucret numeric(10,2) not null default 2;

create table if not exists public.odeme (
  id        bigserial primary key,
  hoca_id   uuid not null references public.hoca(id) on delete cascade,
  tutar     numeric(10,2) not null,          -- + ödeme, − düzeltme
  aciklama  text not null default '',
  an        timestamptz not null default now()
);
alter table public.odeme enable row level security;   -- politika yok: yalnız RPC ve servis anahtarı

-- takip(): hocaların ücret durumunu da döndürür
create or replace function public.takip(p_kod text)
returns json language plpgsql security definer set search_path = public as $$
declare h public.hoca;
begin
  select * into h from public.hoca where kod = upper(trim(p_kod)) and aktif;
  if h.id is null or h.rol <> 'yonetici' then
    return json_build_object('ok', false);
  end if;
  return json_build_object(
    'ok', true,
    'ad', h.ad,
    'hocalar', coalesce((
      select json_agg(x order by x.ad) from (
        select k.ad, k.kod, k.rol, k.soru_ucret,
               (select count(*) from public.atama a where a.hoca_id = k.id) as atanan,
               (select count(*) from public.inceleme i where i.hoca_id = k.id and i.durum is not null) as biten,
               (select max(i.guncellendi) from public.inceleme i where i.hoca_id = k.id) as son,
               (select round(avg(i.sure_sn)) from public.inceleme i where i.hoca_id = k.id and i.sure_sn between 3 and 900) as ort_sure,
               (select count(*) from public.inceleme i where i.hoca_id = k.id and i.durum is not null) * k.soru_ucret as hakedis,
               coalesce((select sum(o.tutar) from public.odeme o where o.hoca_id = k.id), 0) as odenen
        from public.hoca k where k.rol = 'hoca' or k.id = h.id
      ) x), '[]'::json),
    'odemeler', coalesce((
      select json_agg(z order by z.an desc) from (
        select k.ad as hoca, o.tutar, o.aciklama, o.an
        from public.odeme o join public.hoca k on k.id = o.hoca_id
      ) z), '[]'::json),
    'isaretler', coalesce((
      select json_agg(y order by y.guncellendi desc) from (
        select k.ad as hoca, i.soru_id, s.kod as kazanim, i.durum, i.kusurlar, i.aciklama, i.guncellendi
        from public.inceleme i
        join public.hoca k on k.id = i.hoca_id
        join public.soru s on s.id = i.soru_id
        where i.durum is not null
      ) y), '[]'::json)
  );
end $$;

revoke all on function public.takip(text) from public, anon, authenticated;
grant execute on function public.takip(text) to anon;
