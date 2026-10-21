// Páginas: Accesos y grupos (barra en dos zonas) y Novedades de la versión.
import { h, esc } from '../shared/dom.js';
import { iconHTML, fluentUrl } from '../shared/icon-view.js';
import { P, api, ap, patch, activeWs } from './ctx.js';
import { page, section, card, toggle, button, toast, gl } from './ui.js';

export const WINDOW_MODES = [
  ['reserve', 'No tapar ventanas', 'Reserva su espacio: las ventanas maximizadas terminan justo arriba del dock. Recomendado.'],
  ['dodge', 'Esconderse', 'Se aparta cuando una ventana lo toca y vuelve al llevar el mouse al borde.'],
  ['desktop', 'Al fondo, en el escritorio', 'Queda detrás de tus ventanas, como un icono del escritorio. Vuelve a verse al mostrar el escritorio (Win + D).'],
  ['top', 'Siempre encima', 'Queda sobre todas las ventanas, como antes.'],
];

// Tarjetas para elegir qué hace el dock con las ventanas abiertas.
export function windowPicks() {
  const cur = P.config.position.windows;
  const box = h('div.picks');
  for (const [v, t, d] of WINDOW_MODES) {
    const p = h('div.pick' + (cur === v ? '.on' : ''), { html: `<b>${esc(t)}</b><small>${esc(d)}</small>` });
    p.addEventListener('click', () => patch({ position: { windows: v } }));
    box.append(p);
  }
  return box;
}

// ---------- Armar la barra: favoritos | grupos ----------

let preview = null;
let loading = false;
const opts = { favorites: true, desktop: true, arrange: true };

function loadPreview(force = false) {
  if (loading || (preview && !force)) return;
  loading = true;
  api
    .planPreview()
    .then((p) => {
      preview = p;
      opts.favorites = true;
      opts.desktop = true;
    })
    .catch((e) => (preview = { error: e.message, mostUsed: { items: [], source: 'none' }, desktop: { groups: [], count: 0 } }))
    .finally(() => {
      loading = false;
      P.rerender();
    });
}

function icons(items, max = 8) {
  return h('div.plan-icons', ...items.slice(0, max).map((it) => h('span', { title: it.name, html: iconHTML(it, ap()) })));
}

function planRow(icon, title, desc, body, key, enabled) {
  if (!enabled) opts[key] = false;
  const row = h('div.plan-row' + (enabled ? '' : '.off'),
    h('div.plan-head',
      h('div.cicon', { html: gl(icon) }),
      h('div.ctext', h('div.ctitle', { text: title }), desc ? h('div.cdesc', { text: desc }) : null),
      enabled ? toggle(opts[key], (v) => (opts[key] = v)) : null
    ),
    body
  );
  return row;
}

export function planBlock() {
  loadPreview();
  const box = h('div.plan');
  if (!preview) {
    box.append(h('div.plan-loading', { html: `<span class="spin">${gl('loader-circle')}</span> Buscando tus programas y accesos directos…` }));
    return box;
  }
  const used = preview.mostUsed || { items: [], source: 'none' };
  const desk = preview.desktop || { groups: [], count: 0 };
  const src = used.source === 'windows' ? 'Según el tiempo que usas cada programa en Windows (se calcula en tu equipo).' : used.source === 'lanzadera' ? 'Según lo que abres desde Lanzadera.' : 'Todavía no hay datos de uso: Lanzadera aprenderá a medida que abras programas.';
  box.append(planRow('star', 'Primera zona: tus programas más usados', src, used.items.length ? icons(used.items) : null, 'favorites', used.items.length > 0));

  const groups = desk.groups.length
    ? h('div.plan-groups',
        ...desk.groups.map((g) =>
          h('div.plan-group',
            h('div.pg-icons', { html: g.items.slice(0, 4).map((it) => `<span>${iconHTML(it, ap())}</span>`).join('') }),
            h('b', { text: g.name }),
            h('small', { text: g.items.length === 1 ? '1 acceso' : `${g.items.length} accesos` })
          )
        )
      )
    : null;
  const deskDesc = desk.count ? `${desk.count} accesos directos de tu escritorio, ordenados por tema. No se borra nada del escritorio.` : 'No encontramos accesos directos en tu escritorio.';
  box.append(planRow('layout-grid', 'Segunda zona: grupos con tus accesos', deskDesc, groups, 'desktop', desk.groups.length > 0));
  box.append(planRow('columns-2', 'Ordenar la barra en dos zonas', 'Primero tus programas, después tus grupos y al final carpetas y herramientas, separados por una línea.', null, 'arrange', true));
  box.append(
    h('div.plan-actions',
      button('Volver a buscar', () => loadPreview(true), { icon: 'refresh-cw' }),
      button('Aplicar a mi barra', async () => {
        try {
          const ws = activeWs();
          const r = await api.planApply(ws.id, opts);
          const parts = [];
          if (r.added) parts.push(r.added === 1 ? '1 programa' : `${r.added} programas`);
          if (r.groups) parts.push(r.groups === 1 ? '1 grupo' : `${r.groups} grupos`);
          toast(parts.length ? `Listo: ${parts.join(' y ')} en tu barra` : 'Listo: barra ordenada');
        } catch (e) {
          toast(e.message, true);
        }
      }, { primary: true, icon: 'check' })
    )
  );
  return box;
}

const fl = (code) => `<img class="ico-img fluent" src="${fluentUrl(code)}" alt="">`;

export function accesosPage() {
  return page(
    'Accesos y grupos',
    'Arma tu barra en dos zonas: primero lo que más usas y después tus accesos directos agrupados.',
    planBlock(),
    ...section('Agrupar a mano',
      card({ icon: 'mouse-pointer-2', title: 'Arrastra un icono sobre otro', desc: 'Mantenlo un momento encima: se crea un grupo con los dos. Para sumar más, suéltalos sobre el grupo.' }),
      card({ icon: 'mouse-pointer-click', title: 'Clic derecho › Agrupar', desc: 'Mueve un programa a un grupo existente o crea uno nuevo con él.' }),
      card({ icon: 'file-input', title: 'Suelta accesos directos sobre un grupo', desc: 'Desde el escritorio o el Explorador, arrastra uno o varios accesos sobre el grupo.' })
    )
  );
}

// ---------- Novedades ----------

export function novedadesPage() {
  const feats = [
    ['1fa9f', 'No tapa tus ventanas', 'El dock reserva su espacio: lo que abras termina justo arriba de la barra.'],
    ['1f4c8', 'Métricas en el escritorio', 'El monitor de rendimiento ahora es un panel del escritorio, fuera de la barra.'],
    ['1f5c2-fe0f', 'Agrupa a tu manera', 'Arrastra un icono sobre otro y mantenlo un momento: se crea un grupo.'],
    ['2b50', 'Dos zonas', 'Primero lo que más usas, después tus grupos de accesos directos.'],
    ['1f7e2', 'Programas abiertos', 'Un punto marca lo que está abierto; un clic te lleva a su ventana.'],
    ['1f5c3-fe0f', 'Tu escritorio, ordenado', 'Tus accesos directos del escritorio, agrupados por tema en la barra.'],
  ];
  return h('div.welcome.news',
    h('h1', { text: `Novedades de Lanzadera ${P.env.version}` }),
    h('p.lead', { text: 'Hicimos los cambios que pediste. Revisa estas opciones y aplica lo que te guste.' }),
    h('div.features', ...feats.map(([c, t, d]) => h('div.feature', h('span.fi', { html: fl(c) }), h('div', h('b', { text: t }), h('span', { text: d }))))),
    h('h2.news-h', { text: 'Con ventanas abiertas, el dock…' }),
    windowPicks(),
    h('h2.news-h', { text: 'Arma tu barra' }),
    planBlock(),
    h('div.actions',
      button('Ver toda la configuración', () => {
        patch({ seenVersion: P.env.version });
        P.navigate('/inicio');
      }),
      button('Listo', () => {
        patch({ seenVersion: P.env.version });
        api.closeWindow();
      }, { primary: true, icon: 'check' })
    )
  );
}
