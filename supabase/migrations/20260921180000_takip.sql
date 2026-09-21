-- Yönetici takip ekranı: rol='yonetici' olan kod tüm işaretleri görür.
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
        select k.ad, k.kod, k.rol,
               (select count(*) from public.atama a where a.hoca_id = k.id) as atanan,
               (select count(*) from public.inceleme i where i.hoca_id = k.id and i.durum is not null) as biten,
               (select max(i.guncellendi) from public.inceleme i where i.hoca_id = k.id) as son,
               (select round(avg(i.sure_sn)) from public.inceleme i where i.hoca_id = k.id and i.sure_sn between 3 and 900) as ort_sure
        from public.hoca k where k.rol = 'hoca' or k.id = h.id
      ) x), '[]'::json),
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

-- Not zorunluluğu sunucuda da uygulanır: uygun dışındaki kararlarda gerekçe şart.
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
  if p_durum in ('supheli','hatali') and coalesce(length(trim(p_aciklama)),0) < 3 then
    return json_build_object('ok', false, 'hata', 'not_gerekli');
  end if;
  insert into public.inceleme(hoca_id, soru_id, durum, kusurlar, aciklama, sure_sn)
  values (h_id, p_soru, nullif(p_durum,''), coalesce(p_kusurlar,'{}'), coalesce(left(p_aciklama, 2000),''), p_sure)
  on conflict (hoca_id, soru_id) do update
    set durum = excluded.durum, kusurlar = excluded.kusurlar,
        aciklama = excluded.aciklama, sure_sn = coalesce(excluded.sure_sn, inceleme.sure_sn),
        guncellendi = now();
  return json_build_object('ok', true);
end $$;
revoke all on function public.isaretle(text,text,text,text[],text,int) from public, anon, authenticated;
grant execute on function public.isaretle(text,text,text,text[],text,int) to anon;
