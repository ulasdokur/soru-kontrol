-- Soru Kontrol — hoca inceleme sistemi
-- Tasarım notu: hoca hesabı YOK. Erişim tek yol: kod + SECURITY DEFINER RPC.
-- Tablolara anon/authenticated doğrudan erişemez (RLS açık, politika yok).

create extension if not exists pgcrypto;

create table public.hoca (
  id          uuid primary key default gen_random_uuid(),
  ad          text not null,
  kod         text not null unique,          -- 8 karakter, hocaya WhatsApp'tan gider
  rol         text not null default 'hoca',  -- hoca | yonetici
  aktif       boolean not null default true,
  eklendi     timestamptz not null default now()
);

create table public.soru (
  id          text primary key,              -- MAT.5.1.1-01
  kod         text not null,                 -- MAT.5.1.1
  cikti       text,                          -- öğrenme çıktısı metni
  kart_html   text not null,                 -- render.kartlar() çıktısı
  veri        jsonb not null default '{}',
  tur         text not null default 'uretim',-- uretim | meb (bilinen doğru) | bozuk (tuzak)
  beklenen    text,                          -- tuzaklar için: hocanın vermesi gereken karar
  eklendi     timestamptz not null default now()
);

create table public.atama (
  id          bigserial primary key,
  hoca_id     uuid not null references public.hoca(id) on delete cascade,
  soru_id     text not null references public.soru(id) on delete cascade,
  tur         text not null default 'kalibrasyon', -- kalibrasyon | parti
  sira        int  not null,                 -- her hocada farklı sıra (yorgunluk dağılsın)
  unique (hoca_id, soru_id)
);

create table public.inceleme (
  hoca_id     uuid not null references public.hoca(id) on delete cascade,
  soru_id     text not null references public.soru(id) on delete cascade,
  durum       text,                          -- uygun | supheli | hatali
  kusurlar    text[] not null default '{}',
  aciklama    text not null default '',
  sure_sn     int,
  guncellendi timestamptz not null default now(),
  primary key (hoca_id, soru_id)
);

create table public.giris_log (
  id       bigserial primary key,
  kod_on   text,                             -- kodun ilk 3 harfi (kaba kuvveti görmek için)
  basarili boolean not null,
  an       timestamptz not null default now()
);

alter table public.hoca      enable row level security;
alter table public.soru      enable row level security;
alter table public.atama     enable row level security;
alter table public.inceleme  enable row level security;
alter table public.giris_log enable row level security;
-- bilerek politika yok: tablolara dışarıdan erişim kapalı, her şey RPC üzerinden.

-- ── RPC'ler ────────────────────────────────────────────────────────────────

create or replace function public.giris(p_kod text)
returns json language plpgsql security definer set search_path = public as $$
declare h public.hoca; toplam int; biten int;
begin
  select * into h from public.hoca where kod = upper(trim(p_kod)) and aktif;
  insert into public.giris_log(kod_on, basarili) values (left(upper(trim(p_kod)),3), h.id is not null);
  if h.id is null then return json_build_object('ok', false); end if;
  select count(*) into toplam from public.atama a where a.hoca_id = h.id;
  select count(*) into biten  from public.inceleme i
    join public.atama a on a.hoca_id = i.hoca_id and a.soru_id = i.soru_id
    where i.hoca_id = h.id and i.durum is not null;
  return json_build_object('ok', true, 'ad', h.ad, 'rol', h.rol, 'toplam', toplam, 'biten', biten);
end $$;

create or replace function public.sorularim(p_kod text)
returns table (soru_id text, sira int, kart_html text, durum text, kusurlar text[], aciklama text)
language plpgsql security definer set search_path = public as $$
declare h_id uuid;
begin
  select id into h_id from public.hoca where kod = upper(trim(p_kod)) and aktif;
  if h_id is null then return; end if;
  return query
    select s.id, a.sira, s.kart_html, i.durum, coalesce(i.kusurlar,'{}'), coalesce(i.aciklama,'')
    from public.atama a
    join public.soru s on s.id = a.soru_id
    left join public.inceleme i on i.hoca_id = a.hoca_id and i.soru_id = a.soru_id
    where a.hoca_id = h_id
    order by a.sira;
end $$;

create or replace function public.isaretle(
  p_kod text, p_soru text, p_durum text, p_kusurlar text[], p_aciklama text, p_sure int default null)
returns json language plpgsql security definer set search_path = public as $$
declare h_id uuid;
begin
  select id into h_id from public.hoca where kod = upper(trim(p_kod)) and aktif;
  if h_id is null then return json_build_object('ok', false, 'hata', 'kod'); end if;
  if not exists (select 1 from public.atama where hoca_id = h_id and soru_id = p_soru) then
    return json_build_object('ok', false, 'hata', 'atanmamis');
  end if;
  if p_durum is not null and p_durum not in ('uygun','supheli','hatali') then
    return json_build_object('ok', false, 'hata', 'durum');
  end if;
  insert into public.inceleme(hoca_id, soru_id, durum, kusurlar, aciklama, sure_sn)
  values (h_id, p_soru, nullif(p_durum,''), coalesce(p_kusurlar,'{}'), coalesce(left(p_aciklama, 2000),''), p_sure)
  on conflict (hoca_id, soru_id) do update
    set durum = excluded.durum, kusurlar = excluded.kusurlar,
        aciklama = excluded.aciklama, sure_sn = coalesce(excluded.sure_sn, inceleme.sure_sn),
        guncellendi = now();
  return json_build_object('ok', true);
end $$;

revoke all on function public.giris(text)      from public, anon, authenticated;
revoke all on function public.sorularim(text)  from public, anon, authenticated;
revoke all on function public.isaretle(text,text,text,text[],text,int) from public, anon, authenticated;
grant execute on function public.giris(text)     to anon;
grant execute on function public.sorularim(text) to anon;
grant execute on function public.isaretle(text,text,text,text[],text,int) to anon;
